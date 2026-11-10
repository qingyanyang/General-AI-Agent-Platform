"""Minimal agent invoke API for testing the LangGraph runtime."""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.agents.checkpointer import thread_id_for_session
from app.agents.errors import AgentExecutionError, AgentNotConfiguredError
from app.agents.runtime import run_agent
from app.api.deps import require_permissions
from app.core.auth import AuthenticatedUser
from app.core.database import get_db
from app.core.permissions import PERM_AGENTS_EXECUTE
from app.services import chat_sessions as session_service

router = APIRouter(prefix="/agents", tags=["agents"])


class AgentRunRequest(BaseModel):
    message: str = Field(min_length=1)
    session_id: uuid.UUID | None = None


class AgentMessageOut(BaseModel):
    role: str
    content: str


class AgentRunResponse(BaseModel):
    reply: str
    execution_id: str
    messages: list[AgentMessageOut]


@contextmanager
def _db_session(request: Request) -> Session:
    """Open a DB session; honor FastAPI dependency_overrides used in tests."""
    override = request.app.dependency_overrides.get(get_db)
    generator = override() if override is not None else get_db()
    session = next(generator)
    try:
        yield session
    finally:
        generator.close()


@router.post("/run", response_model=AgentRunResponse)
async def agents_run(
    body: AgentRunRequest,
    request: Request,
    user: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENTS_EXECUTE))],
) -> AgentRunResponse:
    try:
        if body.session_id is None:
            result = await run_agent(body.message)
        else:
            checkpointer = getattr(request.app.state, "checkpointer", None)
            if checkpointer is None:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Conversation persistence is not configured",
                )
            with _db_session(request) as db:
                chat_session = session_service.get_active_session_for_user(
                    db,
                    user_id=user.user_id,
                    session_id=body.session_id,
                )
                thread_id = thread_id_for_session(chat_session.id)
            result = await run_agent(
                body.message,
                checkpointer=checkpointer,
                thread_id=thread_id,
            )
    except HTTPException:
        raise
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

    return AgentRunResponse(
        reply=result.reply,
        execution_id=result.execution_id,
        messages=[
            AgentMessageOut(role=item.role, content=item.content) for item in result.messages
        ],
    )
