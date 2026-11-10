"""Chat session persistence and ownership-scoped queries."""

from __future__ import annotations

import base64
import binascii
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.models.agent_access_grant import AgentAccessGrant
from app.models.chat_session import ChatSession
from app.schemas.chat_session import DEFAULT_SESSION_TITLE

_CURSOR_SEP = "|"


@dataclass(frozen=True)
class SessionPage:
    items: list[ChatSession]
    next_cursor: str | None


def _utcnow() -> datetime:
    return datetime.now(UTC)


def encode_cursor(last_activity_at: datetime, session_id: uuid.UUID) -> str:
    raw = f"{last_activity_at.isoformat()}{_CURSOR_SEP}{session_id}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        stamp_text, id_text = raw.split(_CURSOR_SEP, 1)
        stamped = datetime.fromisoformat(stamp_text)
        if stamped.tzinfo is None:
            stamped = stamped.replace(tzinfo=UTC)
        return stamped, uuid.UUID(id_text)
    except (ValueError, binascii.Error, UnicodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Malformed pagination cursor",
        ) from exc


def create_session(
    db: Session,
    *,
    user_id: str,
    agent_id: str,
    title: str | None,
) -> ChatSession:
    now = _utcnow()
    session = ChatSession(
        user_id=user_id,
        agent_id=agent_id,
        title=title if title is not None else DEFAULT_SESSION_TITLE,
        created_at=now,
        last_activity_at=now,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def _active_owned_query(user_id: str) -> Select[tuple[ChatSession]]:
    return select(ChatSession).where(
        ChatSession.user_id == user_id,
        ChatSession.archived_at.is_(None),
    )


def get_active_session_for_user(
    db: Session,
    *,
    user_id: str,
    session_id: uuid.UUID,
) -> ChatSession:
    session = db.scalar(
        _active_owned_query(user_id).where(ChatSession.id == session_id),
    )
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return session


def list_sessions(
    db: Session,
    *,
    user_id: str,
    limit: int,
    cursor: str | None,
    require_view_grant: bool = True,
) -> SessionPage:
    """List active owned sessions.

    When ``require_view_grant`` is true (default), only sessions whose ``agent_id``
    the user can view are included. The filter is applied in SQL before limit/cursor.
    """
    stmt = _active_owned_query(user_id)
    if require_view_grant:
        stmt = stmt.where(
            ChatSession.agent_id.in_(
                select(AgentAccessGrant.agent_id).where(
                    AgentAccessGrant.user_id == user_id,
                    AgentAccessGrant.can_view.is_(True),
                ),
            ),
        )
    stmt = stmt.order_by(
        ChatSession.last_activity_at.desc(),
        ChatSession.id.desc(),
    )
    if cursor is not None:
        cursor_activity, cursor_id = decode_cursor(cursor)
        stmt = stmt.where(
            (ChatSession.last_activity_at < cursor_activity)
            | ((ChatSession.last_activity_at == cursor_activity) & (ChatSession.id < cursor_id)),
        )

    rows = list(db.scalars(stmt.limit(limit + 1)).all())
    next_cursor: str | None = None
    if len(rows) > limit:
        last = rows[limit - 1]
        next_cursor = encode_cursor(last.last_activity_at, last.id)
        rows = rows[:limit]
    return SessionPage(items=rows, next_cursor=next_cursor)


def archive_session(
    db: Session,
    *,
    user_id: str,
    session_id: uuid.UUID,
) -> None:
    """Soft-archive. Idempotent for the owner; 404 if unknown or other user's."""
    session = db.scalar(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.user_id == user_id,
        ),
    )
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if session.archived_at is None:
        session.archived_at = _utcnow()
        db.commit()


def touch_last_activity(db: Session, session: ChatSession) -> None:
    """Bump ``last_activity_at`` and commit (not atomic with checkpoint writes)."""
    session.last_activity_at = _utcnow()
    db.commit()
    db.refresh(session)
