"""Agent catalog persistence and queries (#19)."""

from __future__ import annotations

import base64
import binascii
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import Select, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.auth import USER_ID_MAX_LENGTH
from app.models.agent import Agent, AgentStatus
from app.models.agent_access_grant import AgentAccessGrant
from app.schemas.agent import AgentStatusFilter
from app.schemas.chat_session import AGENT_ID_MAX_LENGTH
from app.services import agent_access as access_service

INACTIVE_AGENT_DETAIL = "Agent is inactive"
DEFAULT_AGENT_ID = "default"
_CURSOR_SEP = "|"


class AgentNotFoundError(Exception):
    """Agent id does not exist."""


class AgentInactiveError(Exception):
    """Agent exists but is inactive; new executions are blocked."""


class AgentConflictError(Exception):
    """Agent id already exists."""


class AgentValidationError(Exception):
    """Invalid agent payload or pagination cursor."""


@dataclass(frozen=True)
class AgentPage:
    items: list[Agent]
    next_cursor: str | None


def _utcnow() -> datetime:
    return datetime.now(UTC)


def validate_agent_id(agent_id: str) -> str:
    """Match session/grant agent_id rules: strip, non-empty, max length."""
    if not isinstance(agent_id, str):
        raise AgentValidationError("id must be a non-empty string")
    stripped = agent_id.strip()
    if not stripped:
        raise AgentValidationError("id must be a non-empty string")
    if len(stripped) > AGENT_ID_MAX_LENGTH:
        raise AgentValidationError(
            f"id must be at most {AGENT_ID_MAX_LENGTH} characters",
        )
    return stripped


def validate_created_by(user_id: str) -> str:
    if not isinstance(user_id, str) or not user_id:
        raise AgentValidationError("created_by must be a non-empty string")
    if len(user_id) > USER_ID_MAX_LENGTH:
        raise AgentValidationError(
            f"created_by must be at most {USER_ID_MAX_LENGTH} characters",
        )
    return user_id


def get_agent(db: Session, agent_id: str) -> Agent | None:
    return db.get(Agent, validate_agent_id(agent_id))


def require_agent(db: Session, agent_id: str) -> Agent:
    agent = get_agent(db, agent_id)
    if agent is None:
        raise AgentNotFoundError
    return agent


def require_active_agent(db: Session, agent_id: str) -> Agent:
    """Raise NotFound if missing; Inactive if status is not active."""
    agent = require_agent(db, agent_id)
    if agent.status != AgentStatus.ACTIVE.value:
        raise AgentInactiveError
    return agent


def ensure_default_agent(db: Session) -> Agent:
    """Idempotent seed used by unit tests (migrations seed Postgres)."""
    existing = db.get(Agent, DEFAULT_AGENT_ID)
    if existing is not None:
        return existing
    now = _utcnow()
    agent = Agent(
        id=DEFAULT_AGENT_ID,
        name="Default",
        description=None,
        status=AgentStatus.ACTIVE.value,
        created_by="system",
        created_at=now,
        updated_at=now,
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return agent


def create_agent(
    db: Session,
    *,
    agent_id: str,
    name: str,
    description: str | None,
    created_by: str,
) -> Agent:
    """Create agent and creator grant in one transaction."""
    agent_id = validate_agent_id(agent_id)
    created_by = validate_created_by(created_by)
    if db.get(Agent, agent_id) is not None:
        raise AgentConflictError

    now = _utcnow()
    agent = Agent(
        id=agent_id,
        name=name,
        description=description,
        status=AgentStatus.ACTIVE.value,
        created_by=created_by,
        created_at=now,
        updated_at=now,
    )
    db.add(agent)
    try:
        db.flush()
        # Creator auto-grant: view + configure + execute (same transaction).
        grant = AgentAccessGrant(
            id=uuid.uuid4(),
            user_id=created_by,
            agent_id=agent_id,
            can_view=True,
            can_configure=True,
            can_execute=True,
            created_at=now,
            updated_at=now,
        )
        db.add(grant)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AgentConflictError from exc
    except Exception:
        db.rollback()
        raise
    db.refresh(agent)
    return agent


def update_agent(
    db: Session,
    *,
    agent_id: str,
    name: str | None = None,
    update_name: bool = False,
    description: str | None = None,
    update_description: bool = False,
) -> Agent:
    agent = require_agent(db, agent_id)
    if update_name:
        if name is None or not name.strip():
            raise AgentValidationError("name must be a non-empty string")
        agent.name = name.strip()
    if update_description:
        agent.description = description
    agent.updated_at = _utcnow()
    db.commit()
    db.refresh(agent)
    return agent


def deactivate_agent(db: Session, *, agent_id: str) -> Agent:
    agent = require_agent(db, agent_id)
    if agent.status != AgentStatus.INACTIVE.value:
        agent.status = AgentStatus.INACTIVE.value
        agent.updated_at = _utcnow()
        db.commit()
        db.refresh(agent)
    return agent


def encode_agent_cursor(created_at: datetime, agent_id: str) -> str:
    raw = f"{created_at.isoformat()}{_CURSOR_SEP}{agent_id}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def decode_agent_cursor(cursor: str) -> tuple[datetime, str]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        stamp_text, agent_id = raw.split(_CURSOR_SEP, 1)
        stamped = datetime.fromisoformat(stamp_text)
        if stamped.tzinfo is None:
            stamped = stamped.replace(tzinfo=UTC)
        return stamped, agent_id
    except (ValueError, binascii.Error, UnicodeError) as exc:
        raise AgentValidationError("Malformed pagination cursor") from exc


def list_agents_for_user(
    db: Session,
    *,
    user_id: str,
    status: AgentStatusFilter,
    limit: int,
    cursor: str | None,
) -> AgentPage:
    """List agents the user can view, optionally filtered by status."""
    viewable = access_service.viewable_agent_ids(db, user_id=user_id)
    if not viewable:
        return AgentPage(items=[], next_cursor=None)

    stmt: Select[tuple[Agent]] = select(Agent).where(Agent.id.in_(viewable))
    if status is AgentStatusFilter.ACTIVE:
        stmt = stmt.where(Agent.status == AgentStatus.ACTIVE.value)
    elif status is AgentStatusFilter.INACTIVE:
        stmt = stmt.where(Agent.status == AgentStatus.INACTIVE.value)

    stmt = stmt.order_by(Agent.created_at.desc(), Agent.id.desc())
    if cursor is not None:
        cursor_created, cursor_id = decode_agent_cursor(cursor)
        stmt = stmt.where(
            (Agent.created_at < cursor_created)
            | ((Agent.created_at == cursor_created) & (Agent.id < cursor_id)),
        )

    rows = list(db.scalars(stmt.limit(limit + 1)).all())
    next_cursor: str | None = None
    if len(rows) > limit:
        last = rows[limit - 1]
        next_cursor = encode_agent_cursor(last.created_at, last.id)
        rows = rows[:limit]
    return AgentPage(items=rows, next_cursor=next_cursor)
