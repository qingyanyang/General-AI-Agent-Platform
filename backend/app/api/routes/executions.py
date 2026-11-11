"""Agent execution history list/get APIs (#21)."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import require_permissions
from app.core.auth import AuthenticatedUser
from app.core.database import get_db
from app.core.permissions import PERM_AGENTS_READ
from app.schemas.agent_execution import (
    ExecutionListOut,
    ExecutionOut,
    ExecutionStatusFilter,
)
from app.schemas.chat_session import AGENT_ID_MAX_LENGTH
from app.services import agent_executions as execution_service

router = APIRouter(prefix="/executions", tags=["executions"])


@router.get("", response_model=ExecutionListOut)
def list_executions(
    user: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENTS_READ))],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: Annotated[str | None, Query()] = None,
    status_filter: Annotated[
        ExecutionStatusFilter | None,
        Query(alias="status"),
    ] = None,
    agent_id: Annotated[str | None, Query(max_length=AGENT_ID_MAX_LENGTH)] = None,
    session_id: Annotated[uuid.UUID | None, Query()] = None,
) -> ExecutionListOut:
    """List the caller's own executions. Requires platform ``agents:read``."""
    page = execution_service.list_owned_executions(
        db,
        user_id=user.user_id,
        limit=limit,
        cursor=cursor,
        status_filter=status_filter.value if status_filter is not None else None,
        agent_id=agent_id.strip() if agent_id is not None else None,
        session_id=session_id,
    )
    return ExecutionListOut(
        items=[ExecutionOut.model_validate(item) for item in page.items],
        next_cursor=page.next_cursor,
    )


@router.get("/{execution_id}", response_model=ExecutionOut)
def get_execution(
    execution_id: uuid.UUID,
    user: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENTS_READ))],
    db: Annotated[Session, Depends(get_db)],
) -> ExecutionOut:
    """Get one owned execution. Other users' ids return 404."""
    row = execution_service.get_owned_execution(
        db,
        user_id=user.user_id,
        execution_id=execution_id,
    )
    return ExecutionOut.model_validate(row)
