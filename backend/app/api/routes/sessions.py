"""Chat session management and message APIs."""

from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.orm import Session

from app.agents.checkpointer import thread_id_for_session
from app.agents.errors import AgentExecutionError, AgentNotConfiguredError
from app.api.deps import get_current_user_id
from app.core.database import get_db
from app.schemas.chat_message import (
    ChatMessageCreate,
    ChatMessageCreateResult,
    ChatMessageListOut,
)
from app.schemas.chat_session import (
    ChatSessionCreate,
    ChatSessionListOut,
    ChatSessionOut,
)
from app.services import chat_messages as message_service
from app.services import chat_sessions as session_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.post("", response_model=ChatSessionOut, status_code=status.HTTP_201_CREATED)
def create_session(
    body: ChatSessionCreate,
    user_id: Annotated[str, Depends(get_current_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> ChatSessionOut:
    session = session_service.create_session(
        db,
        user_id=user_id,
        agent_id=body.agent_id,
        title=body.title,
    )
    return ChatSessionOut.model_validate(session)


@router.get("", response_model=ChatSessionListOut)
def list_sessions(
    user_id: Annotated[str, Depends(get_current_user_id)],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: Annotated[str | None, Query()] = None,
) -> ChatSessionListOut:
    page = session_service.list_sessions(
        db,
        user_id=user_id,
        limit=limit,
        cursor=cursor,
    )
    return ChatSessionListOut(
        items=[ChatSessionOut.model_validate(item) for item in page.items],
        next_cursor=page.next_cursor,
    )


@router.get("/{session_id}", response_model=ChatSessionOut)
def get_session(
    session_id: uuid.UUID,
    user_id: Annotated[str, Depends(get_current_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> ChatSessionOut:
    session = session_service.get_active_session_for_user(
        db,
        user_id=user_id,
        session_id=session_id,
    )
    return ChatSessionOut.model_validate(session)


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(
    session_id: uuid.UUID,
    user_id: Annotated[str, Depends(get_current_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    session_service.archive_session(db, user_id=user_id, session_id=session_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
    user_id: Annotated[str, Depends(get_current_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> ChatMessageListOut:
    checkpointer = _require_checkpointer(request)
    chat_session = session_service.get_active_session_for_user(
        db,
        user_id=user_id,
        session_id=session_id,
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
    user_id: Annotated[str, Depends(get_current_user_id)],
    db: Annotated[Session, Depends(get_db)],
) -> ChatMessageCreateResult:
    checkpointer = _require_checkpointer(request)
    chat_session = session_service.get_active_session_for_user(
        db,
        user_id=user_id,
        session_id=session_id,
    )
    try:
        execution_id, message = await message_service.post_user_message(
            content=body.content,
            checkpointer=checkpointer,
            chat_session=chat_session,
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

    try:
        session_service.touch_last_activity(db, chat_session)
    except Exception:  # noqa: BLE001 — metadata must not fail a successful turn
        db.rollback()
        logger.exception(
            "Failed to update last_activity_at for session %s after successful message",
            chat_session.id,
        )

    return ChatMessageCreateResult(execution_id=execution_id, message=message)
