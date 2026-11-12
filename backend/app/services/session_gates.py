"""Database claim for one in-flight session run (#24)."""

from __future__ import annotations

import time
import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models.agent_execution import AgentExecution, AgentExecutionStatus
from app.models.session_run_gate import SessionRunGate

IDLE = "idle"
RUNNING = "running"
AWAITING = "awaiting_approval"

_WORKERS_REQUIRED = (
    "Stop or confirm termination of every worker that could still own the run "
    "before changing the gate"
)


class SessionBusyError(Exception):
    """The gate is not in the state this transition requires."""

    def __init__(self, detail: str = "Session already has an active run") -> None:
        self.detail = detail
        super().__init__(detail)


class WorkersNotConfirmedError(Exception):
    """Operator recovery was attempted without confirming the worker is gone."""

    def __init__(self) -> None:
        super().__init__(_WORKERS_REQUIRED)


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _insert_gate(db: Session, session_id: uuid.UUID) -> None:
    """Insert the lock row if missing. Two creators cannot both observe absence."""
    values = {"session_id": session_id, "state": IDLE}
    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        statement = (
            pg_insert(SessionRunGate)
            .values(**values)
            .on_conflict_do_nothing(index_elements=["session_id"])
        )
    else:
        statement = SessionRunGate.__table__.insert().prefix_with("OR IGNORE").values(**values)
    db.execute(statement)
    db.flush()


def claim_idle(
    db: Session,
    *,
    session_id: uuid.UUID,
    execution_id: uuid.UUID,
) -> None:
    """Move ``idle → running`` for this execution. Caller inserts the execution and commits."""
    _insert_gate(db, session_id)
    now = _utcnow()
    claimed = db.execute(
        update(SessionRunGate)
        .where(SessionRunGate.session_id == session_id, SessionRunGate.state == IDLE)
        .values(
            state=RUNNING,
            execution_id=execution_id,
            checkpoint_id=None,
            interrupt_id=None,
            tool_call_id=None,
            running_since=now,
            lease_heartbeat_at=now,
        )
    )
    if claimed.rowcount != 1:
        raise SessionBusyError()


def pause_for_approval(
    db: Session,
    *,
    session_id: uuid.UUID,
    execution_id: uuid.UUID,
    monotonic_start: float,
    checkpoint_id: str,
    interrupt_id: str,
    tool_call_id: str,
) -> None:
    """Move the running execution and its gate to ``awaiting_approval`` together."""
    segment_ms = max(0, int((time.perf_counter() - monotonic_start) * 1000))
    accrued = AgentExecution.active_duration_ms + segment_ms
    execution = db.execute(
        update(AgentExecution)
        .where(
            AgentExecution.id == execution_id,
            AgentExecution.status == AgentExecutionStatus.RUNNING.value,
        )
        .values(
            status=AgentExecutionStatus.AWAITING_APPROVAL.value,
            active_duration_ms=accrued,
            running_since=None,
        )
    )
    gate = db.execute(
        update(SessionRunGate)
        .where(
            SessionRunGate.session_id == session_id,
            SessionRunGate.execution_id == execution_id,
            SessionRunGate.state == RUNNING,
        )
        .values(
            state=AWAITING,
            checkpoint_id=checkpoint_id,
            interrupt_id=interrupt_id,
            tool_call_id=tool_call_id,
            running_since=None,
        )
    )
    if execution.rowcount != 1 or gate.rowcount != 1:
        db.rollback()
        raise SessionBusyError("Approval pause did not match the running execution")
    db.commit()


def resume_gated_run(
    db: Session,
    *,
    session_id: uuid.UUID,
    execution_id: uuid.UUID,
    checkpoint_id: str,
    interrupt_id: str,
    tool_call_id: str,
) -> float:
    """Claim the pending approval. Returns a new monotonic segment start."""
    now = _utcnow()
    gate = db.execute(
        update(SessionRunGate)
        .where(
            SessionRunGate.session_id == session_id,
            SessionRunGate.state == AWAITING,
            SessionRunGate.execution_id == execution_id,
            SessionRunGate.checkpoint_id == checkpoint_id,
            SessionRunGate.interrupt_id == interrupt_id,
            SessionRunGate.tool_call_id == tool_call_id,
        )
        .values(state=RUNNING, running_since=now, lease_heartbeat_at=now)
    )
    execution = db.execute(
        update(AgentExecution)
        .where(
            AgentExecution.id == execution_id,
            AgentExecution.status == AgentExecutionStatus.AWAITING_APPROVAL.value,
        )
        .values(status=AgentExecutionStatus.RUNNING.value, running_since=now)
    )
    if gate.rowcount != 1 or execution.rowcount != 1:
        db.rollback()
        raise SessionBusyError("Approval does not match the pending call")
    db.commit()
    return time.perf_counter()


def release_running_gate(
    db: Session,
    *,
    session_id: uuid.UUID,
    execution_id: uuid.UUID,
) -> bool:
    """Idle the gate only while this execution still owns ``running``. Does not commit."""
    result = db.execute(
        update(SessionRunGate)
        .where(
            SessionRunGate.session_id == session_id,
            SessionRunGate.execution_id == execution_id,
            SessionRunGate.state == RUNNING,
        )
        .values(
            state=IDLE,
            execution_id=None,
            checkpoint_id=None,
            interrupt_id=None,
            tool_call_id=None,
            running_since=None,
            lease_heartbeat_at=None,
        )
    )
    return result.rowcount == 1


def touch_lease(
    db: Session,
    *,
    session_id: uuid.UUID,
    execution_id: uuid.UUID,
) -> None:
    now = _utcnow()
    db.execute(
        update(SessionRunGate)
        .where(
            SessionRunGate.session_id == session_id,
            SessionRunGate.execution_id == execution_id,
            SessionRunGate.state == RUNNING,
        )
        .values(lease_heartbeat_at=now)
    )
    db.commit()


def recover_stuck_run(
    db: Session,
    *,
    session_id: uuid.UUID,
    execution_id: uuid.UUID,
    workers_stopped: bool,
    checkpoint_id: str | None = None,
    interrupt_id: str | None = None,
    tool_call_id: str | None = None,
) -> None:
    """Repair a gate left ``running`` after a crash. Does not add crash time.

    ``workers_stopped`` must mean every worker that could still own the run has
    been stopped or otherwise confirmed gone. A stale heartbeat is not enough.
    """
    if not workers_stopped:
        raise WorkersNotConfirmedError()
    row = db.scalar(
        select(SessionRunGate).where(SessionRunGate.session_id == session_id).with_for_update()
    )
    if row is None or row.state != RUNNING or row.execution_id != execution_id:
        raise SessionBusyError("Stuck-run recovery does not match the running gate")
    execution = db.get(AgentExecution, execution_id)
    if execution is None or execution.status != AgentExecutionStatus.RUNNING.value:
        raise SessionBusyError("Stuck-run recovery does not match the running execution")
    if interrupt_id and tool_call_id and checkpoint_id:
        execution.status = AgentExecutionStatus.AWAITING_APPROVAL.value
        execution.running_since = None
        row.state = AWAITING
        row.checkpoint_id = checkpoint_id
        row.interrupt_id = interrupt_id
        row.tool_call_id = tool_call_id
        row.running_since = None
    else:
        execution.status = AgentExecutionStatus.FAILED.value
        execution.completed_at = _utcnow()
        execution.running_since = None
        execution.duration_ms = execution.active_duration_ms
        execution.error_summary = "Agent execution failed"
        row.state = IDLE
        row.execution_id = None
        row.checkpoint_id = None
        row.interrupt_id = None
        row.tool_call_id = None
        row.running_since = None
        row.lease_heartbeat_at = None
    db.commit()
