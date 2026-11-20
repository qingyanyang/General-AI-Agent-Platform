"""Per-agent capability checks: legacy grants vs audience mode (Issue 4).

Modes are never OR'd. Legacy grant rows do not authorize audience-mode Agents;
group membership does not authorize legacy-mode Agents.

``agent-access:manage`` provides administrator-wide Agent scope for audience-mode
VIEW/EXECUTE/CONFIGURE. Platform action permissions are enforced at the route.
Technical configuration additionally requires ``platform:technical`` at the route.
"""

from __future__ import annotations

import base64
import binascii
import uuid
from collections.abc import Collection
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import Select, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session
from sqlalchemy.sql import ColumnElement

from app.core.auth import USER_ID_MAX_LENGTH
from app.core.permissions import PERM_AGENT_ACCESS_MANAGE
from app.models.agent import Agent, AgentAudienceMode, AgentAuthorizationMode
from app.models.agent_access_grant import AgentAccessGrant
from app.models.agent_group_assignment import AgentGroupAssignment
from app.models.group import GroupDesignation, GroupMembership
from app.schemas.chat_session import AGENT_ID_MAX_LENGTH

_CURSOR_SEP = "|"


class AgentCapability(StrEnum):
    VIEW = "view"
    CONFIGURE = "configure"
    EXECUTE = "execute"


class AgentAccessDenied(Exception):
    """Caller lacks the required per-agent capability."""


class AgentAccessValidationError(Exception):
    """Grant payload failed domain validation."""


@dataclass(frozen=True)
class GrantPage:
    items: list[AgentAccessGrant]
    next_cursor: str | None


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _has_manage(permissions: Collection[str] | None) -> bool:
    return permissions is not None and PERM_AGENT_ACCESS_MANAGE in permissions


def validate_grant_user_id(user_id: str) -> str:
    """Accept the opaque Auth0 subject as-is (no strip/normalize)."""
    if not isinstance(user_id, str) or not user_id:
        raise AgentAccessValidationError("user_id must be a non-empty string")
    if len(user_id) > USER_ID_MAX_LENGTH:
        raise AgentAccessValidationError(
            f"user_id must be at most {USER_ID_MAX_LENGTH} characters",
        )
    return user_id


def validate_grant_agent_id(agent_id: str) -> str:
    """Match session agent_id rules: strip, non-empty, max length."""
    if not isinstance(agent_id, str):
        raise AgentAccessValidationError("agent_id must be a non-empty string")
    stripped = agent_id.strip()
    if not stripped:
        raise AgentAccessValidationError("agent_id must be a non-empty string")
    if len(stripped) > AGENT_ID_MAX_LENGTH:
        raise AgentAccessValidationError(
            f"agent_id must be at most {AGENT_ID_MAX_LENGTH} characters",
        )
    return stripped


def get_grant(db: Session, *, user_id: str, agent_id: str) -> AgentAccessGrant | None:
    return db.scalar(
        select(AgentAccessGrant).where(
            AgentAccessGrant.user_id == user_id,
            AgentAccessGrant.agent_id == agent_id,
        ),
    )


def _legacy_grant_allows(grant: AgentAccessGrant | None, capability: AgentCapability) -> bool:
    if grant is None:
        return False
    if capability is AgentCapability.VIEW:
        return grant.can_view
    if capability is AgentCapability.CONFIGURE:
        return grant.can_configure
    if capability is AgentCapability.EXECUTE:
        return grant.can_execute
    raise AssertionError(f"unhandled capability: {capability!r}")


def _user_in_assigned_group(db: Session, *, user_id: str, agent_id: str) -> bool:
    return (
        db.scalar(
            select(AgentGroupAssignment.group_id)
            .join(
                GroupMembership,
                GroupMembership.group_id == AgentGroupAssignment.group_id,
            )
            .where(
                AgentGroupAssignment.agent_id == agent_id,
                GroupMembership.user_id == user_id,
            )
            .limit(1),
        )
        is not None
    )


def _audience_usage_allows(
    db: Session,
    *,
    agent: Agent,
    user_id: str,
    permissions: Collection[str] | None,
) -> bool:
    """VIEW/EXECUTE eligibility under audience mode."""
    if _has_manage(permissions):
        return True
    if agent.audience_mode == AgentAudienceMode.COMPANY.value:
        return True
    if agent.audience_mode == AgentAudienceMode.GROUPS.value:
        return _user_in_assigned_group(db, user_id=user_id, agent_id=agent.id)
    return False


def user_has_capability(
    db: Session,
    *,
    user_id: str,
    agent_id: str,
    capability: AgentCapability,
    permissions: Collection[str] | None = None,
) -> bool:
    agent = db.get(Agent, agent_id)
    if agent is None:
        return False

    mode = agent.authorization_mode
    if mode == AgentAuthorizationMode.LEGACY_GRANTS.value:
        return _legacy_grant_allows(
            get_grant(db, user_id=user_id, agent_id=agent_id),
            capability,
        )

    if mode == AgentAuthorizationMode.AUDIENCE.value:
        if capability is AgentCapability.CONFIGURE:
            return _has_manage(permissions)
        if capability in {AgentCapability.VIEW, AgentCapability.EXECUTE}:
            return _audience_usage_allows(
                db,
                agent=agent,
                user_id=user_id,
                permissions=permissions,
            )
        raise AssertionError(f"unhandled capability: {capability!r}")

    return False


def ensure_agent_capability(
    db: Session,
    *,
    user_id: str,
    agent_id: str,
    capability: AgentCapability,
    permissions: Collection[str] | None = None,
) -> None:
    if not user_has_capability(
        db,
        user_id=user_id,
        agent_id=agent_id,
        capability=capability,
        permissions=permissions,
    ):
        raise AgentAccessDenied


def _user_is_owning_group_leader(
    db: Session,
    *,
    user_id: str,
    owning_group_id: uuid.UUID,
) -> bool:
    membership = db.get(GroupMembership, (owning_group_id, user_id))
    return (
        membership is not None
        and membership.designation == GroupDesignation.LEADER.value
    )


def user_can_edit_instruction_skills(
    db: Session,
    *,
    user_id: str,
    agent_id: str,
    permissions: Collection[str] | None = None,
) -> bool:
    """True when manage or Leader of this Agent's owning group.

    Leadership in an audience-only (non-owning) group does not qualify.
    A null owning group means no Leader editing. Does not grant Chat execution.
    """
    agent = db.get(Agent, agent_id)
    if agent is None:
        return False
    return user_can_edit_instruction_skills_for_agent(
        db,
        agent=agent,
        user_id=user_id,
        permissions=permissions,
    )


def user_can_edit_instruction_skills_for_agent(
    db: Session,
    *,
    agent: Agent,
    user_id: str,
    permissions: Collection[str] | None = None,
) -> bool:
    """Same decision as ``user_can_edit_instruction_skills`` for a locked Agent row."""
    if _has_manage(permissions):
        return True
    if agent.owning_group_id is None:
        return False
    return _user_is_owning_group_leader(
        db,
        user_id=user_id,
        owning_group_id=agent.owning_group_id,
    )


def ensure_instruction_skills_edit(
    db: Session,
    *,
    user_id: str,
    agent_id: str,
    permissions: Collection[str] | None = None,
) -> None:
    if not user_can_edit_instruction_skills(
        db,
        user_id=user_id,
        agent_id=agent_id,
        permissions=permissions,
    ):
        raise AgentAccessDenied


def viewable_agent_id_clause(
    *,
    user_id: str,
    permissions: Collection[str] | None,
) -> ColumnElement[bool]:
    """SQL predicate: Agent.id is viewable for this caller (filter before pagination)."""
    legacy_ids = (
        select(AgentAccessGrant.agent_id)
        .where(
            AgentAccessGrant.user_id == user_id,
            AgentAccessGrant.can_view.is_(True),
        )
        .scalar_subquery()
    )
    membership_agent_ids = (
        select(AgentGroupAssignment.agent_id)
        .join(
            GroupMembership,
            GroupMembership.group_id == AgentGroupAssignment.group_id,
        )
        .where(GroupMembership.user_id == user_id)
        .scalar_subquery()
    )

    clauses: list[Any] = [
        # Legacy: grant view only when mode is legacy_grants.
        (
            (Agent.authorization_mode == AgentAuthorizationMode.LEGACY_GRANTS.value)
            & Agent.id.in_(legacy_ids)
        ),
        # Audience company-wide: any authenticated caller.
        (
            (Agent.authorization_mode == AgentAuthorizationMode.AUDIENCE.value)
            & (Agent.audience_mode == AgentAudienceMode.COMPANY.value)
        ),
        # Audience selected groups: membership in an assigned group.
        (
            (Agent.authorization_mode == AgentAuthorizationMode.AUDIENCE.value)
            & (Agent.audience_mode == AgentAudienceMode.GROUPS.value)
            & Agent.id.in_(membership_agent_ids)
        ),
    ]
    if _has_manage(permissions):
        # Manage: all audience-mode agents (including empty selected-group sets).
        clauses.append(Agent.authorization_mode == AgentAuthorizationMode.AUDIENCE.value)

    return or_(*clauses)


def viewable_agent_ids(
    db: Session,
    *,
    user_id: str,
    permissions: Collection[str] | None = None,
) -> set[str]:
    rows = db.scalars(
        select(Agent.id).where(
            viewable_agent_id_clause(user_id=user_id, permissions=permissions),
        ),
    ).all()
    return set(rows)


def _insert_for_dialect(db: Session):
    bind = db.get_bind()
    if bind.dialect.name == "postgresql":
        return pg_insert(AgentAccessGrant)
    return sqlite_insert(AgentAccessGrant)


def upsert_grant(
    db: Session,
    *,
    user_id: str,
    agent_id: str,
    can_view: bool,
    can_configure: bool,
    can_execute: bool,
) -> AgentAccessGrant | None:
    """Replace the grant for (user_id, agent_id). All-false deletes the row.

    The agent row must exist (active or inactive). Unknown agent_id is rejected.
    """
    user_id = validate_grant_user_id(user_id)
    agent_id = validate_grant_agent_id(agent_id)
    if db.get(Agent, agent_id) is None:
        raise AgentAccessValidationError("Unknown agent_id")

    if not can_view and not can_configure and not can_execute:
        revoke_grant(db, user_id=user_id, agent_id=agent_id, missing_ok=True)
        return None

    now = _utcnow()
    insert = _insert_for_dialect(db)
    stmt = insert.values(
        id=uuid.uuid4(),
        user_id=user_id,
        agent_id=agent_id,
        can_view=can_view,
        can_configure=can_configure,
        can_execute=can_execute,
        created_at=now,
        updated_at=now,
    ).on_conflict_do_update(
        index_elements=["user_id", "agent_id"],
        set_={
            "can_view": can_view,
            "can_configure": can_configure,
            "can_execute": can_execute,
            "updated_at": now,
        },
    )
    db.execute(stmt)
    db.commit()
    return get_grant(db, user_id=user_id, agent_id=agent_id)


def revoke_grant(
    db: Session,
    *,
    user_id: str,
    agent_id: str,
    missing_ok: bool = False,
) -> None:
    user_id = validate_grant_user_id(user_id)
    agent_id = validate_grant_agent_id(agent_id)
    grant = get_grant(db, user_id=user_id, agent_id=agent_id)
    if grant is None:
        if missing_ok:
            return
        raise LookupError("grant not found")
    db.delete(grant)
    db.commit()


def encode_grant_cursor(created_at: datetime, grant_id: uuid.UUID) -> str:
    raw = f"{created_at.isoformat()}{_CURSOR_SEP}{grant_id}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def decode_grant_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        stamp_text, id_text = raw.split(_CURSOR_SEP, 1)
        stamped = datetime.fromisoformat(stamp_text)
        if stamped.tzinfo is None:
            stamped = stamped.replace(tzinfo=UTC)
        return stamped, uuid.UUID(id_text)
    except (ValueError, binascii.Error, UnicodeError) as exc:
        raise AgentAccessValidationError("Malformed pagination cursor") from exc


def list_grants(
    db: Session,
    *,
    user_id: str | None,
    agent_id: str | None,
    limit: int,
    cursor: str | None,
) -> GrantPage:
    stmt: Select[tuple[AgentAccessGrant]] = select(AgentAccessGrant)
    if user_id is not None:
        stmt = stmt.where(AgentAccessGrant.user_id == validate_grant_user_id(user_id))
    if agent_id is not None:
        stmt = stmt.where(AgentAccessGrant.agent_id == validate_grant_agent_id(agent_id))

    stmt = stmt.order_by(
        AgentAccessGrant.created_at.desc(),
        AgentAccessGrant.id.desc(),
    )
    if cursor is not None:
        cursor_created, cursor_id = decode_grant_cursor(cursor)
        stmt = stmt.where(
            (AgentAccessGrant.created_at < cursor_created)
            | ((AgentAccessGrant.created_at == cursor_created) & (AgentAccessGrant.id < cursor_id)),
        )

    rows = list(db.scalars(stmt.limit(limit + 1)).all())
    next_cursor: str | None = None
    if len(rows) > limit:
        last = rows[limit - 1]
        next_cursor = encode_grant_cursor(last.created_at, last.id)
        rows = rows[:limit]
    return GrantPage(items=rows, next_cursor=next_cursor)
