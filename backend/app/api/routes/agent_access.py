"""Admin APIs for per-user agent access grants (#17)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.api.deps import require_permissions
from app.core.auth import AuthenticatedUser
from app.core.database import get_db
from app.core.permissions import PERM_AGENT_ACCESS_MANAGE
from app.schemas.agent_access import (
    AgentAccessGrantListOut,
    AgentAccessGrantOut,
    AgentAccessGrantUpsert,
)
from app.services import agent_access as access_service

router = APIRouter(prefix="/agent-access", tags=["agent-access"])


def _map_validation(exc: access_service.AgentAccessValidationError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=str(exc),
    )


@router.put("/grants", response_model=AgentAccessGrantOut | None)
def upsert_grant(
    body: AgentAccessGrantUpsert,
    caller: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENT_ACCESS_MANAGE))],
    db: Annotated[Session, Depends(get_db)],
) -> AgentAccessGrantOut | Response:
    del caller
    try:
        grant = access_service.upsert_grant(
            db,
            user_id=body.user_id,
            agent_id=body.agent_id,
            can_view=body.can_view,
            can_configure=body.can_configure,
            can_execute=body.can_execute,
        )
    except access_service.AgentAccessValidationError as exc:
        raise _map_validation(exc) from exc
    if grant is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    return AgentAccessGrantOut.model_validate(grant)


@router.get("/grants", response_model=AgentAccessGrantListOut)
def list_grants(
    caller: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENT_ACCESS_MANAGE))],
    db: Annotated[Session, Depends(get_db)],
    user_id: Annotated[str | None, Query()] = None,
    agent_id: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: Annotated[str | None, Query()] = None,
) -> AgentAccessGrantListOut:
    del caller
    try:
        page = access_service.list_grants(
            db,
            user_id=user_id,
            agent_id=agent_id,
            limit=limit,
            cursor=cursor,
        )
    except access_service.AgentAccessValidationError as exc:
        raise _map_validation(exc) from exc
    return AgentAccessGrantListOut(
        items=[AgentAccessGrantOut.model_validate(item) for item in page.items],
        next_cursor=page.next_cursor,
    )


@router.delete("/grants", status_code=status.HTTP_204_NO_CONTENT)
def revoke_grant(
    caller: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENT_ACCESS_MANAGE))],
    db: Annotated[Session, Depends(get_db)],
    user_id: Annotated[str, Query(min_length=1, max_length=512)],
    agent_id: Annotated[str, Query(min_length=1, max_length=64)],
) -> Response:
    del caller
    try:
        access_service.revoke_grant(db, user_id=user_id, agent_id=agent_id)
    except access_service.AgentAccessValidationError as exc:
        raise _map_validation(exc) from exc
    except LookupError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Grant not found",
        ) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)
