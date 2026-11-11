"""Start/finalize and list agent execution metadata (#21)."""

from __future__ import annotations

import base64
import binascii
import logging
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models.agent_execution import AgentExecution, AgentExecutionStatus

logger = logging.getLogger(__name__)

_CURSOR_SEP = "|"

# Public API messages only — never persist raw exceptions, tool output, or prompts.
_PUBLIC_ERROR_SUMMARIES = frozenset(
    {
        "Agent stopped: recursion limit exceeded (possible tool-calling loop)",
        "Agent execution failed",
        "LLM API key is not configured; cannot run the agent",
        "Conversation persistence is not configured",
    }
)
_GENERIC_FAILURE_SUMMARY = "Agent execution failed"


@dataclass(frozen=True)
class ExecutionPage:
    items: list[AgentExecution]
    next_cursor: str | None


def _utcnow() -> datetime:
    return datetime.now(UTC)


def sanitize_error_summary(message: str | None) -> str | None:
    """Persist only known-safe public strings; map anything else to a generic summary."""
    if message is None:
        return None
    text = message.strip()
    if not text:
        return None
    if text in _PUBLIC_ERROR_SUMMARIES:
        return text
    return _GENERIC_FAILURE_SUMMARY


def start_execution(
    db: Session,
    *,
    execution_id: uuid.UUID,
    user_id: str,
    agent_id: str,
    session_id: uuid.UUID | None,
) -> float:
    """Insert a ``running`` row. Returns monotonic start for ``duration_ms``.

    ``completed_at``, ``duration_ms``, and ``error_summary`` stay null while running.
    Raises on DB failure so the caller can return HTTP 503 before invoking the model.
    """
    started_at = _utcnow()
    monotonic_start = time.perf_counter()
    row = AgentExecution(
        id=execution_id,
        user_id=user_id,
        agent_id=agent_id,
        session_id=session_id,
        status=AgentExecutionStatus.RUNNING.value,
        started_at=started_at,
        completed_at=None,
        duration_ms=None,
        error_summary=None,
        langsmith_run_id=str(execution_id),
    )
    db.add(row)
    db.commit()
    return monotonic_start


def finalize_execution(
    db: Session,
    *,
    execution_id: uuid.UUID,
    status: str,
    monotonic_start: float,
    error_summary: str | None = None,
) -> bool:
    """Idempotent terminal update: only rows still ``running`` are changed.

    Returns True when a row was updated. Late cleanup cannot overwrite a terminal status.
    """
    if status == AgentExecutionStatus.RUNNING.value:
        raise ValueError("finalize_execution requires a terminal status")
    completed_at = _utcnow()
    duration_ms = max(0, int((time.perf_counter() - monotonic_start) * 1000))
    summary = (
        sanitize_error_summary(error_summary)
        if status == AgentExecutionStatus.FAILED.value
        else None
    )
    result = db.execute(
        update(AgentExecution)
        .where(
            AgentExecution.id == execution_id,
            AgentExecution.status == AgentExecutionStatus.RUNNING.value,
        )
        .values(
            status=status,
            completed_at=completed_at,
            duration_ms=duration_ms,
            error_summary=summary,
        )
    )
    db.commit()
    return bool(result.rowcount)


def encode_cursor(started_at: datetime, execution_id: uuid.UUID) -> str:
    raw = f"{started_at.isoformat()}{_CURSOR_SEP}{execution_id}"
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


def get_owned_execution(
    db: Session,
    *,
    user_id: str,
    execution_id: uuid.UUID,
) -> AgentExecution:
    row = db.scalar(
        select(AgentExecution).where(
            AgentExecution.id == execution_id,
            AgentExecution.user_id == user_id,
        ),
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Execution not found",
        )
    return row


def list_owned_executions(
    db: Session,
    *,
    user_id: str,
    limit: int,
    cursor: str | None = None,
    status_filter: str | None = None,
    agent_id: str | None = None,
    session_id: uuid.UUID | None = None,
) -> ExecutionPage:
    """List the caller's executions only (requires platform ``agents:read`` at the route)."""
    stmt = select(AgentExecution).where(AgentExecution.user_id == user_id)
    if status_filter is not None:
        stmt = stmt.where(AgentExecution.status == status_filter)
    if agent_id is not None:
        stmt = stmt.where(AgentExecution.agent_id == agent_id)
    if session_id is not None:
        stmt = stmt.where(AgentExecution.session_id == session_id)
    stmt = stmt.order_by(
        AgentExecution.started_at.desc(),
        AgentExecution.id.desc(),
    )
    if cursor is not None:
        cursor_started, cursor_id = decode_cursor(cursor)
        stmt = stmt.where(
            (AgentExecution.started_at < cursor_started)
            | ((AgentExecution.started_at == cursor_started) & (AgentExecution.id < cursor_id)),
        )

    rows = list(db.scalars(stmt.limit(limit + 1)).all())
    next_cursor: str | None = None
    if len(rows) > limit:
        last = rows[limit - 1]
        next_cursor = encode_cursor(last.started_at, last.id)
        rows = rows[:limit]
    return ExecutionPage(items=rows, next_cursor=next_cursor)
