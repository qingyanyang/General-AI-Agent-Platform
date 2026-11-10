"""Per-user agent capability grants (#17).

FastAPI-free: raise ``AgentAccessDenied`` for missing capabilities; the API layer
maps that to HTTP 403. Platform Admin does not bypass grants.
"""

from __future__ import annotations

import base64
import binascii
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import Select, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.core.auth import USER_ID_MAX_LENGTH
from app.models.agent_access_grant import AgentAccessGrant
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


def user_has_capability(
    db: Session,
    *,
    user_id: str,
    agent_id: str,
    capability: AgentCapability,
) -> bool:
    grant = get_grant(db, user_id=user_id, agent_id=agent_id)
    if grant is None:
        return False
    if capability is AgentCapability.VIEW:
        return grant.can_view
    if capability is AgentCapability.CONFIGURE:
        return grant.can_configure
    if capability is AgentCapability.EXECUTE:
        return grant.can_execute
    raise AssertionError(f"unhandled capability: {capability!r}")


def ensure_agent_capability(
    db: Session,
    *,
    user_id: str,
    agent_id: str,
    capability: AgentCapability,
) -> None:
    if not user_has_capability(
        db,
        user_id=user_id,
        agent_id=agent_id,
        capability=capability,
    ):
        raise AgentAccessDenied


def viewable_agent_ids(db: Session, *, user_id: str) -> set[str]:
    rows = db.scalars(
        select(AgentAccessGrant.agent_id).where(
            AgentAccessGrant.user_id == user_id,
            AgentAccessGrant.can_view.is_(True),
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
    """Replace the grant for (user_id, agent_id). All-false deletes the row."""
    user_id = validate_grant_user_id(user_id)
    agent_id = validate_grant_agent_id(agent_id)

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
