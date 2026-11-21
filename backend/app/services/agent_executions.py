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
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models.agent_execution import AgentExecution, AgentExecutionStatus
from app.models.execution_usage import ExecutionToolCall
from app.services.session_gates import claim_idle, release_running_gate

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
    commit: bool = True,
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
        active_duration_ms=0,
        running_since=started_at,
        started_at=started_at,
        completed_at=None,
        duration_ms=None,
        error_summary=None,
        langsmith_run_id=str(execution_id),
        usage_capture="pending",
    )
    db.add(row)
    db.flush()
    if commit:
        db.commit()
    return monotonic_start


def begin_gated_execution(
    db: Session,
    *,
    session_id: uuid.UUID,
    execution_id: uuid.UUID,
    user_id: str,
    agent_id: str,
) -> float:
    """Claim the session gate and insert the running execution, then commit both."""
    try:
        claim_idle(db, session_id=session_id, execution_id=execution_id)
        monotonic_start = start_execution(
            db,
            execution_id=execution_id,
            user_id=user_id,
            agent_id=agent_id,
            session_id=session_id,
            commit=False,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return monotonic_start


def _segment_ms(monotonic_start: float) -> int:
    return max(0, int((time.perf_counter() - monotonic_start) * 1000))


def finalize_execution(
    db: Session,
    *,
    execution_id: uuid.UUID,
    status: str,
    monotonic_start: float,
    error_summary: str | None = None,
    session_id: uuid.UUID | None = None,
) -> bool:
    """Idempotent terminal update: only rows still ``running`` are changed.

    Returns True when a row was updated. Late cleanup cannot overwrite a terminal
    status or an ``awaiting_approval`` pause. When ``session_id`` is set, the
    matching running gate is released in the same transaction.
    """
    if status in {
        AgentExecutionStatus.RUNNING.value,
        AgentExecutionStatus.AWAITING_APPROVAL.value,
    }:
        raise ValueError("finalize_execution requires a terminal status")
    completed_at = _utcnow()
    segment_ms = _segment_ms(monotonic_start)
    summary = (
        sanitize_error_summary(error_summary)
        if status == AgentExecutionStatus.FAILED.value
        else None
    )
    accrued = AgentExecution.active_duration_ms + segment_ms
    result = db.execute(
        update(AgentExecution)
        .where(
            AgentExecution.id == execution_id,
            AgentExecution.status == AgentExecutionStatus.RUNNING.value,
        )
        .values(
            status=status,
            completed_at=completed_at,
            duration_ms=accrued,
            active_duration_ms=accrued,
            running_since=None,
            error_summary=summary,
        )
    )
    updated = bool(result.rowcount)
    if updated:
        db.execute(
            update(ExecutionToolCall)
            .where(
                ExecutionToolCall.execution_id == execution_id,
                ExecutionToolCall.status == "pending",
            )
            .values(
                status="cancelled" if status == AgentExecutionStatus.CANCELLED.value else "skipped",
            ),
        )
    if updated and session_id is not None:
        release_running_gate(db, session_id=session_id, execution_id=execution_id)
    db.commit()
    return updated


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
    started_from: datetime | None = None,
    started_to: datetime | None = None,
) -> ExecutionPage:
    """List one user's executions. The route decides whose id is allowed."""
    stmt = select(AgentExecution).where(AgentExecution.user_id == user_id)
    if status_filter is not None:
        stmt = stmt.where(AgentExecution.status == status_filter)
    if agent_id is not None:
        stmt = stmt.where(AgentExecution.agent_id == agent_id)
    if session_id is not None:
        stmt = stmt.where(AgentExecution.session_id == session_id)
    if started_from is not None:
        stmt = stmt.where(AgentExecution.started_at >= started_from)
    if started_to is not None:
        stmt = stmt.where(AgentExecution.started_at <= started_to)
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


def summarize_executions(
    db: Session,
    *,
    user_id: str,
    status_filter: str | None = None,
    agent_id: str | None = None,
    started_from: datetime | None = None,
    started_to: datetime | None = None,
) -> dict[str, int]:
    stmt = select(AgentExecution.status, func.count()).where(AgentExecution.user_id == user_id)
    if status_filter is not None:
        stmt = stmt.where(AgentExecution.status == status_filter)
    if agent_id is not None:
        stmt = stmt.where(AgentExecution.agent_id == agent_id)
    if started_from is not None:
        stmt = stmt.where(AgentExecution.started_at >= started_from)
    if started_to is not None:
        stmt = stmt.where(AgentExecution.started_at <= started_to)
    return dict(db.execute(stmt.group_by(AgentExecution.status)).tuples().all())
