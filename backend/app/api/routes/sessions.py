"""Chat session management API."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_id
from app.core.database import get_db
from app.schemas.chat_session import (
    ChatSessionCreate,
    ChatSessionListOut,
    ChatSessionOut,
)
from app.services import chat_sessions as session_service

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
