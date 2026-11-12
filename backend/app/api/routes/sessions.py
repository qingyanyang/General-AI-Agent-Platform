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
from app.agents.runtime import StreamOutcome
from app.api.deps import require_permissions
from app.api.execution import execution_bundle
from app.api.execution_records import (
    CANCELLED,
    FAILED,
    SUCCEEDED,
    finalize_execution_best_effort,
    start_execution_or_503,
)
from app.core.auth import AuthenticatedUser
from app.core.database import get_db
from app.core.permissions import PERM_AGENTS_EXECUTE, PERM_AGENTS_READ
from app.models.agent import Agent, AgentStatus
from app.models.chat_session import ChatSession
from app.schemas.chat_message import (
    ChatMessageCreate,
    ChatMessageCreateResult,
    ChatMessageListOut,
    StreamDone,
    StreamError,
    StreamEvent,
    format_sse,
)
from app.schemas.chat_session import (
    ChatSessionCreate,
    ChatSessionListOut,
    ChatSessionOut,
)
from app.services import agent_access as access_service
from app.services import agent_executions as execution_service
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


def _require_agent(db: Session, agent_id: str) -> Agent:
    """Missing/invalid agent → 404."""
    try:
        return agent_service.require_agent(db, agent_id)
    except (agent_service.AgentNotFoundError, agent_service.AgentValidationError) as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Agent not found",
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


def _ensure_executable_agent(
    db: Session,
    *,
    user_id: str,
    agent_id: str,
) -> Agent:
    """404 missing → 403 no execute → 409 inactive."""
    agent = _require_agent(db, agent_id)
    _ensure_capability(
        db,
        user_id=user_id,
        agent_id=agent_id,
        capability=access_service.AgentCapability.EXECUTE,
    )
    if agent.status != AgentStatus.ACTIVE.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=agent_service.INACTIVE_AGENT_DETAIL,
        )
    return agent


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
    _ensure_executable_agent(db, user_id=user.user_id, agent_id=body.agent_id)
    # Create does not need an execution snapshot; only active+execute gates.
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
        agent = _ensure_executable_agent(
            db,
            user_id=user.user_id,
            agent_id=chat_session.agent_id,
        )
        owned_session_id = chat_session.id
        agent_id = agent.id
        execution_config, tool_auth = execution_bundle(
            agent,
            user_id=user.user_id,
            permissions=user.permissions,
        )

    execution_uuid = uuid.uuid4()
    monotonic_start = start_execution_or_503(
        request,
        execution_id=execution_uuid,
        user_id=user.user_id,
        agent_id=agent_id,
        session_id=owned_session_id,
    )
    # Default to failed so an unexpected exception still leaves a terminal row.
    terminal_status = FAILED
    error_summary: str | None = execution_service.sanitize_error_summary(
        "Agent execution failed",
    )
    try:
        execution_id, message = await message_service.post_user_message(
            content=body.content,
            checkpointer=checkpointer,
            session_id=owned_session_id,
            tool_auth=tool_auth,
            execution_config=execution_config,
            execution_id=execution_uuid,
        )
        terminal_status = SUCCEEDED
        error_summary = None
    except asyncio.CancelledError:
        terminal_status = CANCELLED
        error_summary = None
        raise
    except AgentNotConfiguredError as exc:
        terminal_status = FAILED
        error_summary = execution_service.sanitize_error_summary(str(exc))
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except AgentExecutionError as exc:
        terminal_status = FAILED
        error_summary = execution_service.sanitize_error_summary(str(exc))
        detail: str | dict[str, str] = str(exc)
        if exc.execution_id is not None:
            detail = {"message": str(exc), "execution_id": exc.execution_id}
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=detail,
        ) from exc
    finally:
        finalize_execution_best_effort(
            request,
            execution_id=execution_uuid,
            status=terminal_status,
            monotonic_start=monotonic_start,
            error_summary=error_summary,
        )

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
        agent = _ensure_executable_agent(
            db,
            user_id=user.user_id,
            agent_id=chat_session.agent_id,
        )
        owned_session_id = chat_session.id
        agent_id = agent.id
        # Preflight before StreamingResponse so config failures are HTTP 503.
        execution_config, tool_auth = execution_bundle(
            agent,
            user_id=user.user_id,
            permissions=user.permissions,
        )

    execution_uuid = uuid.uuid4()
    # Persist running before returning StreamingResponse so insert failures stay HTTP 503.
    monotonic_start = start_execution_or_503(
        request,
        execution_id=execution_uuid,
        user_id=user.user_id,
        agent_id=agent_id,
        session_id=owned_session_id,
    )
    outcome = StreamOutcome()

    async def _events():
        queue: asyncio.Queue[StreamEvent | None] = asyncio.Queue()
        stream_error_summary: str | None = None

        async def _produce() -> None:
            try:
                async for event in message_service.stream_user_message(
                    content=body.content,
                    checkpointer=checkpointer,
                    session_id=owned_session_id,
                    tool_auth=tool_auth,
                    execution_config=execution_config,
                    outcome=outcome,
                    execution_id=execution_uuid,
                ):
                    queue.put_nowait(event)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 — map setup failures before stream_agent's try
                logger.exception("Agent stream producer failed")
                outcome.failed = True
                if not outcome.execution_id:
                    outcome.execution_id = str(execution_uuid)
                queue.put_nowait(
                    StreamError(
                        execution_id=outcome.execution_id,
                        message="Agent execution failed",
                    ),
                )
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
                if isinstance(item, StreamError):
                    stream_error_summary = item.message
                yield format_sse(item)
            # Completion boundary: graph success → succeeded even if client
            # disconnects during finalization or delivery of done.
            if outcome.message is not None and not outcome.failed:
                if not disconnected.is_set():
                    _touch_session_activity(request, owned_session_id)
                    await asyncio.sleep(0)
                    if not disconnected.is_set():
                        # SSE done payload is the current-turn assistant message only.
                        yield format_sse(
                            StreamDone(
                                execution_id=outcome.execution_id,
                                message=outcome.message,
                            ),
                        )
        finally:
            # Derive terminal status from outcome so cancel during delivery cannot
            # overwrite a successful graph completion with cancelled.
            producer_failed = (
                producer.done() and not producer.cancelled() and producer.exception() is not None
            )
            if outcome.message is not None and not outcome.failed:
                terminal_status = SUCCEEDED
                terminal_error = None
            elif outcome.failed or producer_failed:
                terminal_status = FAILED
                terminal_error = execution_service.sanitize_error_summary(
                    stream_error_summary or "Agent execution failed",
                )
            else:
                terminal_status = CANCELLED
                terminal_error = None
            finalize_execution_best_effort(
                request,
                execution_id=execution_uuid,
                status=terminal_status,
                monotonic_start=monotonic_start,
                error_summary=terminal_error,
            )
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
