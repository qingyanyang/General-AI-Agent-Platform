"""Directory listing and email invitations."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import require_permissions
from app.core.auth import AuthenticatedUser
from app.core.database import get_db
from app.core.permissions import PERM_AGENT_ACCESS_MANAGE
from app.schemas.agent_execution import ExecutionOut, ExecutionSummaryOut, ExecutionUsageOut
from app.schemas.users import (
    AccessSourceOut,
    DirectoryUserOut,
    EffectiveAccessListOut,
    EffectiveAccessOut,
    InvitationCreate,
    RoleLiteral,
    UserDetailOut,
    UserListOut,
    UserMembershipOut,
    UserUpdate,
)
from app.services import agent_executions as execution_service
from app.services import user_admin
from app.services.auth0_management import (
    Auth0NotConfigured,
    open_auth0_directory,
)
from app.services.groups import GroupNotFound

router = APIRouter(prefix="/users", tags=["users"])


def _directory_or_503():
    try:
        return open_auth0_directory()
    except Auth0NotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=exc.message,
        ) from exc


@router.get("", response_model=UserListOut)
def list_users(
    caller: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENT_ACCESS_MANAGE))],
    db: Annotated[Session, Depends(get_db)],
    q: Annotated[str | None, Query()] = None,
    cursor: Annotated[str | None, Query()] = None,
    role: Annotated[RoleLiteral | None, Query()] = None,
    exclude_group_id: Annotated[uuid.UUID | None, Query()] = None,
) -> UserListOut:
    page = user_admin.list_users(
        db, query=q, cursor=cursor, permissions=caller.permissions,
        role=role, exclude_group_id=exclude_group_id,
    )
    return UserListOut(
        items=[DirectoryUserOut.model_validate(item) for item in page.items],
        next_cursor=page.next_cursor,
    )


@router.post("/invitations", response_model=DirectoryUserOut, status_code=status.HTTP_201_CREATED)
def invite_user(
    body: InvitationCreate,
    caller: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENT_ACCESS_MANAGE))],
    db: Annotated[Session, Depends(get_db)],
) -> DirectoryUserOut:
    directory = _directory_or_503()
    try:
        row = user_admin.invite_user(
            db,
            directory=directory,
            caller_user_id=caller.user_id,
            permissions=caller.permissions,
            email=body.email,
            role=body.role,
            group_id=body.group_id,
        )
    except user_admin.UserAdminError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    except GroupNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found") from None
    finally:
        directory.close()
    return DirectoryUserOut.model_validate(row)


@router.get("/{user_id}", response_model=UserDetailOut)
def get_user(
    user_id: str,
    caller: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENT_ACCESS_MANAGE))],
    db: Annotated[Session, Depends(get_db)],
) -> UserDetailOut:
    try:
        row = user_admin.get_visible_user(db, user_id, permissions=caller.permissions)
    except user_admin.UserAdminError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    memberships = [
        UserMembershipOut(
            group_id=item.group_id,
            group_name=item.group_name,
            designation=item.designation if item.designation in {"member", "leader"} else "member",
        )
        for item in user_admin.memberships_for(db, user_id)
    ]
    base = DirectoryUserOut.model_validate(row)
    return UserDetailOut(**base.model_dump(), memberships=memberships)


@router.patch("/{user_id}", response_model=DirectoryUserOut)
def update_user(
    user_id: str,
    body: UserUpdate,
    caller: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENT_ACCESS_MANAGE))],
    db: Annotated[Session, Depends(get_db)],
) -> DirectoryUserOut:
    directory = _directory_or_503() if body.role is not None else None
    try:
        row = user_admin.update_user(
            db,
            directory=directory,
            permissions=caller.permissions,
            user_id=user_id,
            role=body.role,
            status=body.status,
        )
    except user_admin.UserAdminError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    finally:
        if directory is not None:
            directory.close()
    return DirectoryUserOut.model_validate(row)


@router.get("/{user_id}/access", response_model=EffectiveAccessListOut)
def list_user_access(
    user_id: str,
    caller: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENT_ACCESS_MANAGE))],
    db: Annotated[Session, Depends(get_db)],
) -> EffectiveAccessListOut:
    try:
        user_admin.get_visible_user(db, user_id, permissions=caller.permissions)
        items = user_admin.effective_access_for_user(db, user_id)
    except user_admin.UserAdminError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    return EffectiveAccessListOut(
        items=[
            EffectiveAccessOut(
                agent_id=item.agent_id,
                agent_name=item.agent_name,
                can_use=item.can_use,
                can_edit_prompt=item.can_edit_prompt,
                sources=[
                    AccessSourceOut(kind=source.kind, group_id=source.group_id, name=source.name)  # type: ignore[arg-type]
                    for source in item.sources
                ],
            )
            for item in items
        ],
    )


@router.get("/{user_id}/executions", response_model=ExecutionUsageOut)
def list_user_executions(
    user_id: str,
    caller: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENT_ACCESS_MANAGE))],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: Annotated[str | None, Query()] = None,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    agent_id: Annotated[str | None, Query()] = None,
    started_from: Annotated[datetime | None, Query(alias="from")] = None,
    started_to: Annotated[datetime | None, Query(alias="to")] = None,
) -> ExecutionUsageOut:
    try:
        user_admin.get_visible_user(db, user_id, permissions=caller.permissions)
    except user_admin.UserAdminError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    allowed = {"running", "awaiting_approval", "succeeded", "failed", "cancelled"}
    if status_filter is not None and status_filter not in allowed:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown status")
    cleaned_agent = agent_id.strip() if agent_id else None
    page = execution_service.list_owned_executions(
        db,
        user_id=user_id,
        limit=limit,
        cursor=cursor,
        status_filter=status_filter,
        agent_id=cleaned_agent,
        started_from=started_from,
        started_to=started_to,
    )
    counts = execution_service.summarize_executions(
        db,
        user_id=user_id,
        status_filter=status_filter,
        agent_id=cleaned_agent,
        started_from=started_from,
        started_to=started_to,
    )
    return ExecutionUsageOut(
        items=[ExecutionOut.model_validate(item) for item in page.items],
        next_cursor=page.next_cursor,
        summary=ExecutionSummaryOut(total=sum(counts.values()), by_status=counts),
    )
