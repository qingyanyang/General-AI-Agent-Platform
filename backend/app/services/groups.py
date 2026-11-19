"""Groups and Member/Leader designations.

FastAPI-free: raise domain exceptions; the API layer maps them to HTTP.
Only ``agent-access:manage`` may change memberships. Leaders may read a
group's roster. Members may read groups they belong to. Agent grants are
not consulted.
"""

from __future__ import annotations

import base64
import binascii
import uuid
from collections.abc import Collection
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import Select, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.auth import USER_ID_MAX_LENGTH
from app.core.permissions import PERM_AGENT_ACCESS_MANAGE
from app.models.directory_user import DirectoryUser
from app.models.group import Group, GroupDesignation, GroupMembership
from app.schemas.groups import GROUP_NAME_MAX_LENGTH

_CURSOR_SEP = "|"


class GroupNotFound(Exception):
    """Group is missing or must not be confirmed to the caller."""


class MembershipNotFound(Exception):
    """Membership row is missing."""


class DirectoryUserNotFound(Exception):
    """Target subject is not in the local directory."""


class GroupAccessDenied(Exception):
    """Caller can see the group but lacks the required action."""


class GroupValidationError(Exception):
    """Payload failed domain validation."""


class GroupNameConflict(Exception):
    """Group name is already taken."""


@dataclass(frozen=True)
class GroupListItem:
    group: Group
    designation: str | None


@dataclass(frozen=True)
class GroupPage:
    items: list[GroupListItem]
    next_cursor: str | None


@dataclass(frozen=True)
class MembershipPage:
    items: list[GroupMembership]
    next_cursor: str | None


def _utcnow() -> datetime:
    return datetime.now(UTC)


def caller_is_manager(permissions: Collection[str]) -> bool:
    return PERM_AGENT_ACCESS_MANAGE in permissions


def validate_membership_user_id(user_id: str) -> str:
    """Accept the opaque Auth0 subject as-is (no strip/normalize)."""
    if not isinstance(user_id, str) or not user_id:
        raise GroupValidationError("user_id must be a non-empty string")
    if len(user_id) > USER_ID_MAX_LENGTH:
        raise GroupValidationError(
            f"user_id must be at most {USER_ID_MAX_LENGTH} characters",
        )
    return user_id


def validate_designation(designation: str) -> str:
    if designation not in {GroupDesignation.MEMBER.value, GroupDesignation.LEADER.value}:
        raise GroupValidationError("designation must be 'member' or 'leader'")
    return designation


def validate_group_name(name: str) -> str:
    if not isinstance(name, str):
        raise GroupValidationError("name must be a non-empty string")
    stripped = name.strip()
    if not stripped:
        raise GroupValidationError("name must be a non-empty string")
    if len(stripped) > GROUP_NAME_MAX_LENGTH:
        raise GroupValidationError(
            f"name must be at most {GROUP_NAME_MAX_LENGTH} characters",
        )
    return stripped


def get_group(db: Session, group_id: uuid.UUID) -> Group | None:
    return db.get(Group, group_id)


def get_membership(
    db: Session,
    *,
    group_id: uuid.UUID,
    user_id: str,
) -> GroupMembership | None:
    return db.get(GroupMembership, {"group_id": group_id, "user_id": user_id})


def create_group(
    db: Session,
    *,
    name: str,
    description: str | None,
) -> Group:
    name = validate_group_name(name)
    now = _utcnow()
    group = Group(
        id=uuid.uuid4(),
        name=name,
        description=description,
        created_at=now,
        updated_at=now,
    )
    db.add(group)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise GroupNameConflict("Group name already exists") from exc
    db.refresh(group)
    return group


def encode_group_cursor(created_at: datetime, group_id: uuid.UUID) -> str:
    raw = f"{created_at.isoformat()}{_CURSOR_SEP}{group_id}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def decode_group_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        stamp_text, id_text = raw.split(_CURSOR_SEP, 1)
        stamped = datetime.fromisoformat(stamp_text)
        if stamped.tzinfo is None:
            stamped = stamped.replace(tzinfo=UTC)
        return stamped, uuid.UUID(id_text)
    except (ValueError, binascii.Error, UnicodeError) as exc:
        raise GroupValidationError("Malformed pagination cursor") from exc


def encode_membership_cursor(created_at: datetime, user_id: str) -> str:
    raw = f"{created_at.isoformat()}{_CURSOR_SEP}{user_id}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def decode_membership_cursor(cursor: str) -> tuple[datetime, str]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        stamp_text, user_id = raw.split(_CURSOR_SEP, 1)
        stamped = datetime.fromisoformat(stamp_text)
        if stamped.tzinfo is None:
            stamped = stamped.replace(tzinfo=UTC)
        if not user_id:
            raise ValueError("empty user_id")
        return stamped, user_id
    except (ValueError, binascii.Error, UnicodeError) as exc:
        raise GroupValidationError("Malformed pagination cursor") from exc


def list_groups_for_caller(
    db: Session,
    *,
    caller_user_id: str,
    permissions: Collection[str],
    limit: int,
    cursor: str | None,
) -> GroupPage:
    if caller_is_manager(permissions):
        stmt: Select[tuple[Group]] = select(Group).order_by(
            Group.created_at.desc(),
            Group.id.desc(),
        )
        if cursor is not None:
            cursor_created, cursor_id = decode_group_cursor(cursor)
            stmt = stmt.where(
                (Group.created_at < cursor_created)
                | ((Group.created_at == cursor_created) & (Group.id < cursor_id)),
            )
        rows = list(db.scalars(stmt.limit(limit + 1)).all())
        next_cursor: str | None = None
        if len(rows) > limit:
            last = rows[limit - 1]
            next_cursor = encode_group_cursor(last.created_at, last.id)
            rows = rows[:limit]
        memberships: dict[uuid.UUID, str] = {}
        if rows:
            memberships = {
                row.group_id: row.designation
                for row in db.scalars(
                    select(GroupMembership).where(
                        GroupMembership.user_id == caller_user_id,
                        GroupMembership.group_id.in_([group.id for group in rows]),
                    ),
                ).all()
            }
        return GroupPage(
            items=[
                GroupListItem(group=group, designation=memberships.get(group.id)) for group in rows
            ],
            next_cursor=next_cursor,
        )

    stmt_join: Select[tuple[Group, str]] = (
        select(Group, GroupMembership.designation)
        .join(
            GroupMembership,
            GroupMembership.group_id == Group.id,
        )
        .where(GroupMembership.user_id == caller_user_id)
        .order_by(Group.created_at.desc(), Group.id.desc())
    )
    if cursor is not None:
        cursor_created, cursor_id = decode_group_cursor(cursor)
        stmt_join = stmt_join.where(
            (Group.created_at < cursor_created)
            | ((Group.created_at == cursor_created) & (Group.id < cursor_id)),
        )
    joined = list(db.execute(stmt_join.limit(limit + 1)).all())
    next_cursor = None
    if len(joined) > limit:
        last_group, _ = joined[limit - 1]
        next_cursor = encode_group_cursor(last_group.created_at, last_group.id)
        joined = joined[:limit]
    return GroupPage(
        items=[
            GroupListItem(group=group, designation=designation) for group, designation in joined
        ],
        next_cursor=next_cursor,
    )


def get_group_for_caller(
    db: Session,
    *,
    group_id: uuid.UUID,
    caller_user_id: str,
    permissions: Collection[str],
) -> GroupListItem:
    group = get_group(db, group_id)
    if group is None:
        raise GroupNotFound
    membership = get_membership(db, group_id=group_id, user_id=caller_user_id)
    if membership is None and not caller_is_manager(permissions):
        raise GroupNotFound
    return GroupListItem(
        group=group,
        designation=None if membership is None else membership.designation,
    )


def list_memberships_for_caller(
    db: Session,
    *,
    group_id: uuid.UUID,
    caller_user_id: str,
    permissions: Collection[str],
    limit: int,
    cursor: str | None,
) -> MembershipPage:
    group = get_group(db, group_id)
    if group is None:
        raise GroupNotFound
    membership = get_membership(db, group_id=group_id, user_id=caller_user_id)
    is_manager = caller_is_manager(permissions)
    if membership is None and not is_manager:
        raise GroupNotFound
    if not is_manager and (
        membership is None or membership.designation != GroupDesignation.LEADER.value
    ):
        raise GroupAccessDenied

    stmt: Select[tuple[GroupMembership]] = (
        select(GroupMembership)
        .where(GroupMembership.group_id == group_id)
        .order_by(GroupMembership.created_at.desc(), GroupMembership.user_id.desc())
    )
    if cursor is not None:
        cursor_created, cursor_user_id = decode_membership_cursor(cursor)
        stmt = stmt.where(
            (GroupMembership.created_at < cursor_created)
            | (
                (GroupMembership.created_at == cursor_created)
                & (GroupMembership.user_id < cursor_user_id)
            ),
        )
    rows = list(db.scalars(stmt.limit(limit + 1)).all())
    next_cursor: str | None = None
    if len(rows) > limit:
        last = rows[limit - 1]
        next_cursor = encode_membership_cursor(last.created_at, last.user_id)
        rows = rows[:limit]
    return MembershipPage(items=rows, next_cursor=next_cursor)


def _require_membership_write_access(
    db: Session,
    *,
    group_id: uuid.UUID,
    caller_user_id: str,
    permissions: Collection[str],
) -> Group:
    """Visibility first, then manage permission.

    Non-members without manage get ``GroupNotFound`` so the group id is not
    confirmed. Members or Leaders without manage get ``GroupAccessDenied``.
    """
    group = get_group(db, group_id)
    if group is None:
        raise GroupNotFound
    if caller_is_manager(permissions):
        return group
    membership = get_membership(db, group_id=group_id, user_id=caller_user_id)
    if membership is None:
        raise GroupNotFound
    raise GroupAccessDenied


def _insert_for_dialect(db: Session):
    bind = db.get_bind()
    if bind.dialect.name == "postgresql":
        return pg_insert(GroupMembership)
    return sqlite_insert(GroupMembership)


def upsert_membership(
    db: Session,
    *,
    group_id: uuid.UUID,
    caller_user_id: str,
    permissions: Collection[str],
    user_id: str,
    designation: str,
) -> GroupMembership:
    _require_membership_write_access(
        db,
        group_id=group_id,
        caller_user_id=caller_user_id,
        permissions=permissions,
    )
    user_id = validate_membership_user_id(user_id)
    designation = validate_designation(designation)
    if db.get(DirectoryUser, user_id) is None:
        raise DirectoryUserNotFound

    now = _utcnow()
    insert = _insert_for_dialect(db)
    stmt = insert.values(
        group_id=group_id,
        user_id=user_id,
        designation=designation,
        created_at=now,
        updated_at=now,
    ).on_conflict_do_update(
        index_elements=["group_id", "user_id"],
        set_={
            "designation": designation,
            "updated_at": now,
        },
    )
    db.execute(stmt)
    db.commit()
    membership = get_membership(db, group_id=group_id, user_id=user_id)
    if membership is None:
        raise RuntimeError("membership missing after upsert")
    return membership


def delete_membership(
    db: Session,
    *,
    group_id: uuid.UUID,
    caller_user_id: str,
    permissions: Collection[str],
    user_id: str,
) -> None:
    _require_membership_write_access(
        db,
        group_id=group_id,
        caller_user_id=caller_user_id,
        permissions=permissions,
    )
    user_id = validate_membership_user_id(user_id)
    membership = get_membership(db, group_id=group_id, user_id=user_id)
    if membership is None:
        raise MembershipNotFound
    db.delete(membership)
    db.commit()
