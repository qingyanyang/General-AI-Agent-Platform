"""Chat session management and message APIs."""

from __future__ import annotations

import asyncio
import logging
import uuid
from contextlib import contextmanager
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.agents.checkpointer import thread_id_for_session
from app.agents.errors import AgentExecutionError, AgentNotConfiguredError
from app.agents.runtime import StreamOutcome, ensure_llm_configured
from app.agents.tool_policy import ToolAuthContext
from app.api.deps import require_permissions
from app.core.auth import AuthenticatedUser
from app.core.database import get_db
from app.core.permissions import PERM_AGENTS_EXECUTE, PERM_AGENTS_READ
from app.models.chat_session import ChatSession
from app.schemas.chat_message import (
    ChatMessageCreate,
    ChatMessageCreateResult,
    ChatMessageListOut,
    StreamDone,
    StreamEvent,
    format_sse,
)
from app.schemas.chat_session import (
    ChatSessionCreate,
    ChatSessionListOut,
    ChatSessionOut,
)
from app.services import agent_access as access_service
from app.services import agents as agent_service
from app.services import chat_messages as message_service
from app.services import chat_sessions as session_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sessions", tags=["sessions"])

_AGENT_ACCESS_DENIED = "Agent access denied"


def _deny_agent_access() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=_AGENT_ACCESS_DENIED,
    )


def _ensure_active_agent(db: Session, agent_id: str) -> None:
    """Block new executions when the agent is missing or inactive."""
    try:
        agent_service.require_active_agent(db, agent_id)
    except agent_service.AgentNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Agent not found",
        ) from exc
    except agent_service.AgentInactiveError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=agent_service.INACTIVE_AGENT_DETAIL,
        ) from exc


def _ensure_capability(
    db: Session,
    *,
    user_id: str,
    agent_id: str,
    capability: access_service.AgentCapability,
) -> None:
    try:
        access_service.ensure_agent_capability(
            db,
            user_id=user_id,
            agent_id=agent_id,
            capability=capability,
        )
    except access_service.AgentAccessDenied as exc:
        raise _deny_agent_access() from exc


@contextmanager
def _db_session(request: Request) -> Session:
    """Open a short-lived DB session; honor FastAPI dependency_overrides used in tests."""
    override = request.app.dependency_overrides.get(get_db)
    generator = override() if override is not None else get_db()
    session = next(generator)
    try:
        yield session
    finally:
        generator.close()


@router.post("", response_model=ChatSessionOut, status_code=status.HTTP_201_CREATED)
def create_session(
    body: ChatSessionCreate,
    user: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENTS_EXECUTE))],
    db: Annotated[Session, Depends(get_db)],
) -> ChatSessionOut:
    _ensure_active_agent(db, body.agent_id)
    _ensure_capability(
        db,
        user_id=user.user_id,
        agent_id=body.agent_id,
        capability=access_service.AgentCapability.EXECUTE,
    )
    session = session_service.create_session(
        db,
        user_id=user.user_id,
        agent_id=body.agent_id,
        title=body.title,
    )
    return ChatSessionOut.model_validate(session)


@router.get("", response_model=ChatSessionListOut)
def list_sessions(
    user: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENTS_READ))],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: Annotated[str | None, Query()] = None,
) -> ChatSessionListOut:
    page = session_service.list_sessions(
        db,
        user_id=user.user_id,
        limit=limit,
        cursor=cursor,
        require_view_grant=True,
    )
    return ChatSessionListOut(
        items=[ChatSessionOut.model_validate(item) for item in page.items],
        next_cursor=page.next_cursor,
    )


@router.get("/{session_id}", response_model=ChatSessionOut)
def get_session(
    session_id: uuid.UUID,
    user: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENTS_READ))],
    db: Annotated[Session, Depends(get_db)],
) -> ChatSessionOut:
    session = session_service.get_active_session_for_user(
        db,
        user_id=user.user_id,
        session_id=session_id,
    )
    _ensure_capability(
        db,
        user_id=user.user_id,
        agent_id=session.agent_id,
        capability=access_service.AgentCapability.VIEW,
    )
    return ChatSessionOut.model_validate(session)


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(
    session_id: uuid.UUID,
    user: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENTS_EXECUTE))],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    # Ownership only — no agent grant required (idempotent archive for owners).
    session_service.archive_session(db, user_id=user.user_id, session_id=session_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _touch_session_activity(request: Request, session_id: uuid.UUID) -> None:
    """Best-effort last_activity update. Failures are logged and do not raise."""
    try:
        with _db_session(request) as db:
            try:
                session = db.get(ChatSession, session_id)
                if session is not None:
                    session_service.touch_last_activity(db, session)
            except Exception:
                db.rollback()
                raise
    except Exception:  # noqa: BLE001 — metadata must not fail a successful turn
        logger.exception(
            "Failed to update last_activity_at for session %s after successful message",
            session_id,
        )


def _require_checkpointer(request: Request):
    checkpointer = getattr(request.app.state, "checkpointer", None)
    if checkpointer is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Conversation persistence is not configured",
        )
    return checkpointer


@router.get("/{session_id}/messages", response_model=ChatMessageListOut)
async def list_messages(
    session_id: uuid.UUID,
    request: Request,
    user: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENTS_READ))],
    db: Annotated[Session, Depends(get_db)],
) -> ChatMessageListOut:
    checkpointer = _require_checkpointer(request)
    chat_session = session_service.get_active_session_for_user(
        db,
        user_id=user.user_id,
        session_id=session_id,
    )
    _ensure_capability(
        db,
        user_id=user.user_id,
        agent_id=chat_session.agent_id,
        capability=access_service.AgentCapability.VIEW,
    )
    items = await message_service.load_session_messages(
        checkpointer=checkpointer,
        thread_id=thread_id_for_session(chat_session.id),
    )
    return ChatMessageListOut(items=items)


@router.post("/{session_id}/messages", response_model=ChatMessageCreateResult)
async def create_message(
    session_id: uuid.UUID,
    body: ChatMessageCreate,
    request: Request,
    user: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENTS_EXECUTE))],
) -> ChatMessageCreateResult:
    checkpointer = _require_checkpointer(request)
    # Short-lived DB scope for ownership + grant — do not hold across LLM work.
    with _db_session(request) as db:
        chat_session = session_service.get_active_session_for_user(
            db,
            user_id=user.user_id,
            session_id=session_id,
        )
        _ensure_active_agent(db, chat_session.agent_id)
        _ensure_capability(
            db,
            user_id=user.user_id,
            agent_id=chat_session.agent_id,
            capability=access_service.AgentCapability.EXECUTE,
        )
        owned_session_id = chat_session.id
        tool_auth = ToolAuthContext(
            user_id=user.user_id,
            permissions=user.permissions,
            agent_id=chat_session.agent_id,
        )

    try:
        execution_id, message = await message_service.post_user_message(
            content=body.content,
            checkpointer=checkpointer,
            session_id=owned_session_id,
            tool_auth=tool_auth,
        )
    except AgentNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except AgentExecutionError as exc:
        detail: str | dict[str, str] = str(exc)
        if exc.execution_id is not None:
            detail = {"message": str(exc), "execution_id": exc.execution_id}
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=detail,
        ) from exc

    _touch_session_activity(request, owned_session_id)
    # Execute-only responses already return only the current-turn assistant message.
    return ChatMessageCreateResult(execution_id=execution_id, message=message)


async def _cancel_when_disconnected(
    request: Request,
    producer: asyncio.Task[None],
    disconnected: asyncio.Event,
) -> None:
    """Cancel the producer task that owns the graph iterator.

    This task is the only reader of the ASGI receive channel, so cancellation
    does not wait for the next model chunk. The producer closes the iterator
    in ``finally``; this watcher never calls ``aclose()``.
    """
    try:
        while not producer.done():
            message = await request.receive()
            if message["type"] == "http.disconnect":
                disconnected.set()
                producer.cancel()
                return
    except asyncio.CancelledError:
        raise


@router.post("/{session_id}/messages/stream")
async def stream_message(
    session_id: uuid.UUID,
    body: ChatMessageCreate,
    request: Request,
    user: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENTS_EXECUTE))],
) -> StreamingResponse:
    checkpointer = _require_checkpointer(request)
    with _db_session(request) as db:
        chat_session = session_service.get_active_session_for_user(
            db,
            user_id=user.user_id,
            session_id=session_id,
        )
        _ensure_active_agent(db, chat_session.agent_id)
        _ensure_capability(
            db,
            user_id=user.user_id,
            agent_id=chat_session.agent_id,
            capability=access_service.AgentCapability.EXECUTE,
        )
        owned_session_id = chat_session.id
        tool_auth = ToolAuthContext(
            user_id=user.user_id,
            permissions=user.permissions,
            agent_id=chat_session.agent_id,
        )
    try:
        ensure_llm_configured()
    except AgentNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    outcome = StreamOutcome()

    async def _events():
        queue: asyncio.Queue[StreamEvent | None] = asyncio.Queue()

        async def _produce() -> None:
            try:
                async for event in message_service.stream_user_message(
                    content=body.content,
                    checkpointer=checkpointer,
                    session_id=owned_session_id,
                    tool_auth=tool_auth,
                    outcome=outcome,
                ):
                    queue.put_nowait(event)
            except asyncio.CancelledError:
                raise
            finally:
                queue.put_nowait(None)

        producer = asyncio.create_task(_produce())
        disconnected = asyncio.Event()
        watcher = asyncio.create_task(
            _cancel_when_disconnected(request, producer, disconnected),
        )
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield format_sse(item)
            if outcome.failed or outcome.message is None or disconnected.is_set():
                return
            _touch_session_activity(request, owned_session_id)
            await asyncio.sleep(0)
            if disconnected.is_set():
                return
            # SSE done payload is the current-turn assistant message only.
            yield format_sse(
                StreamDone(execution_id=outcome.execution_id, message=outcome.message),
            )
        finally:
            watcher.cancel()
            if not producer.done():
                producer.cancel()
            await asyncio.gather(producer, watcher, return_exceptions=True)

    return StreamingResponse(
        _events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
