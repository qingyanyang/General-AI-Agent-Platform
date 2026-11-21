"""Group and membership APIs."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_permissions
from app.core.auth import AuthenticatedUser
from app.core.database import get_db
from app.core.permissions import PERM_AGENT_ACCESS_MANAGE
from app.schemas.groups import (
    GroupAgentAssign,
    GroupAgentListOut,
    GroupAgentOut,
    GroupCreate,
    GroupDetailOut,
    GroupListItemOut,
    GroupListOut,
    GroupOut,
    MembershipListOut,
    MembershipOut,
    MembershipUpsert,
)
from app.models.directory_user import DirectoryUser
from app.services import groups as groups_service

router = APIRouter(prefix="/groups", tags=["groups"])


def _map_validation(exc: groups_service.GroupValidationError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=str(exc),
    )


@router.post("", response_model=GroupOut, status_code=status.HTTP_201_CREATED)
def create_group(
    body: GroupCreate,
    caller: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENT_ACCESS_MANAGE))],
    db: Annotated[Session, Depends(get_db)],
) -> GroupOut:
    del caller
    try:
        group = groups_service.create_group(
            db,
            name=body.name,
            description=body.description,
        )
    except groups_service.GroupValidationError as exc:
        raise _map_validation(exc) from exc
    except groups_service.GroupNameConflict as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    return GroupOut.model_validate(group)


@router.patch("/{group_id}", response_model=GroupDetailOut)
def update_group(
    group_id: uuid.UUID,
    body: GroupCreate,
    caller: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENT_ACCESS_MANAGE))],
    db: Annotated[Session, Depends(get_db)],
) -> GroupDetailOut:
    try:
        groups_service.update_group(
            db,
            group_id=group_id,
            name=body.name,
            description=body.description,
        )
        item = groups_service.get_group_for_caller(
            db,
            group_id=group_id,
            caller_user_id=caller.user_id,
            permissions=caller.permissions,
        )
    except groups_service.GroupNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found") from None
    except groups_service.GroupValidationError as exc:
        raise _map_validation(exc) from exc
    except groups_service.GroupNameConflict as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return GroupDetailOut(
        id=item.group.id,
        name=item.group.name,
        description=item.group.description,
        created_at=item.group.created_at,
        updated_at=item.group.updated_at,
        designation=item.designation,  # type: ignore[arg-type]
        member_count=item.member_count,
        agent_count=item.agent_count,
    )


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group(
    group_id: uuid.UUID,
    caller: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENT_ACCESS_MANAGE))],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    del caller
    try:
        groups_service.delete_group(db, group_id=group_id)
    except groups_service.GroupNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found") from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("", response_model=GroupListOut)
def list_groups(
    caller: Annotated[AuthenticatedUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: Annotated[str | None, Query()] = None,
) -> GroupListOut:
    try:
        page = groups_service.list_groups_for_caller(
            db,
            caller_user_id=caller.user_id,
            limit=limit,
            cursor=cursor,
        )
    except groups_service.GroupValidationError as exc:
        raise _map_validation(exc) from exc
    return GroupListOut(
        items=[
            GroupListItemOut(
                id=item.group.id,
                name=item.group.name,
                description=item.group.description,
                created_at=item.group.created_at,
                updated_at=item.group.updated_at,
                designation=item.designation,  # type: ignore[arg-type]
                member_count=item.member_count,
                agent_count=item.agent_count,
            )
            for item in page.items
        ],
        next_cursor=page.next_cursor,
    )


@router.get("/{group_id}", response_model=GroupDetailOut)
def get_group(
    group_id: uuid.UUID,
    caller: Annotated[AuthenticatedUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> GroupDetailOut:
    try:
        item = groups_service.get_group_for_caller(
            db,
            group_id=group_id,
            caller_user_id=caller.user_id,
            permissions=caller.permissions,
        )
    except groups_service.GroupNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found",
        ) from None
    return GroupDetailOut(
        id=item.group.id,
        name=item.group.name,
        description=item.group.description,
        created_at=item.group.created_at,
        updated_at=item.group.updated_at,
        designation=item.designation,  # type: ignore[arg-type]
        member_count=item.member_count,
        agent_count=item.agent_count,
    )


def _with_directory_names(db: Session, memberships: list) -> list[MembershipOut]:
    user_ids = [item.user_id for item in memberships]
    people = {
        row.user_id: row
        for row in db.query(DirectoryUser).filter(DirectoryUser.user_id.in_(user_ids)).all()
    } if user_ids else {}
    items: list[MembershipOut] = []
    for item in memberships:
        person = people.get(item.user_id)
        shown = MembershipOut.model_validate(item)
        if person is not None:
            shown = shown.model_copy(
                update={"display_name": person.display_name, "email": person.email},
            )
        items.append(shown)
    return items


@router.get("/{group_id}/agents", response_model=GroupAgentListOut)
def list_group_agents(
    group_id: uuid.UUID,
    caller: Annotated[AuthenticatedUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> GroupAgentListOut:
    try:
        items = groups_service.list_group_agents_for_caller(
            db,
            group_id=group_id,
            caller_user_id=caller.user_id,
            permissions=caller.permissions,
        )
    except groups_service.GroupNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found",
        ) from None
    return GroupAgentListOut(
        items=[
            GroupAgentOut(
                agent_id=item.agent_id,
                agent_name=item.agent_name,
                is_owning=item.is_owning,
            )
            for item in items
        ],
    )


@router.post("/{group_id}/agents", status_code=status.HTTP_204_NO_CONTENT)
def assign_group_agent(
    group_id: uuid.UUID,
    body: GroupAgentAssign,
    caller: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENT_ACCESS_MANAGE))],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    del caller
    try:
        groups_service.assign_group_agent(db, group_id=group_id, agent_id=body.agent_id)
    except groups_service.GroupNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found") from None
    except groups_service.GroupValidationError as exc:
        raise _map_validation(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{group_id}/agents/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
def unassign_group_agent(
    group_id: uuid.UUID,
    agent_id: str,
    caller: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENT_ACCESS_MANAGE))],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    del caller
    try:
        groups_service.unassign_group_agent(db, group_id=group_id, agent_id=agent_id)
    except groups_service.GroupNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found") from None
    except groups_service.GroupValidationError as exc:
        raise _map_validation(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{group_id}/memberships", response_model=MembershipListOut)
def list_memberships(
    group_id: uuid.UUID,
    caller: Annotated[AuthenticatedUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: Annotated[str | None, Query()] = None,
) -> MembershipListOut:
    try:
        page = groups_service.list_memberships_for_caller(
            db,
            group_id=group_id,
            caller_user_id=caller.user_id,
            permissions=caller.permissions,
            limit=limit,
            cursor=cursor,
        )
    except groups_service.GroupNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found",
        ) from None
    except groups_service.GroupValidationError as exc:
        raise _map_validation(exc) from exc
    return MembershipListOut(
        items=_with_directory_names(db, page.items),
        next_cursor=page.next_cursor,
    )


@router.put("/{group_id}/memberships", response_model=MembershipOut)
def upsert_membership(
    group_id: uuid.UUID,
    body: MembershipUpsert,
    caller: Annotated[AuthenticatedUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> MembershipOut:
    try:
        membership = groups_service.upsert_membership(
            db,
            group_id=group_id,
            caller_user_id=caller.user_id,
            permissions=caller.permissions,
            user_id=body.user_id,
            designation=body.designation,
        )
    except groups_service.GroupNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found",
        ) from None
    except groups_service.GroupAccessDenied:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied",
        ) from None
    except groups_service.DirectoryUserNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Directory user not found",
        ) from None
    except groups_service.GroupValidationError as exc:
        raise _map_validation(exc) from exc
    return MembershipOut.model_validate(membership)


@router.delete("/{group_id}/memberships/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_membership(
    group_id: uuid.UUID,
    user_id: str,
    caller: Annotated[AuthenticatedUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    try:
        groups_service.delete_membership(
            db,
            group_id=group_id,
            caller_user_id=caller.user_id,
            permissions=caller.permissions,
            user_id=user_id,
        )
    except groups_service.GroupNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found",
        ) from None
    except groups_service.GroupAccessDenied:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied",
        ) from None
    except groups_service.MembershipNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Membership not found",
        ) from None
    except groups_service.GroupValidationError as exc:
        raise _map_validation(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
