"""HTTP helpers for persisting agent execution metadata (#21)."""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager, contextmanager

from fastapi import HTTPException, Request, status
from sqlalchemy.orm import Session

from app.agents.usage import UsageRecorder, active_usage
from app.core.database import get_db
from app.models.agent_execution import AgentExecutionStatus
from app.services import agent_executions as execution_service
from app.services.session_gates import (
    SessionBusyError,
    pause_for_approval,
    resume_gated_run,
    touch_lease,
)

logger = logging.getLogger(__name__)

_FINALIZE_ATTEMPTS = 3
_HEARTBEAT_SECONDS = 15.0


@contextmanager
def request_db_session(request: Request) -> Iterator[Session]:
    """Open a short-lived DB session; honor FastAPI dependency_overrides used in tests."""
    override = request.app.dependency_overrides.get(get_db)
    generator = override() if override is not None else get_db()
    session = next(generator)
    try:
        yield session
    finally:
        generator.close()


@asynccontextmanager
async def capture_execution_usage(
    request: Request, execution_id: uuid.UUID, *, provider: str, model: str, resumed: bool = False,
) -> AsyncIterator[None]:
    recorder = UsageRecorder(
        lambda: request_db_session(request), execution_id=execution_id,
        provider=provider, model=model,
    )
    token = active_usage.set(recorder)
    try:
        await recorder.begin(resumed=resumed)
        yield
    finally:
        active_usage.reset(token)
        await recorder.finish()


def start_execution_or_503(
    request: Request,
    *,
    execution_id: uuid.UUID,
    user_id: str,
    agent_id: str,
    session_id: uuid.UUID | None,
) -> float:
    """Insert ``running`` before the model runs. DB failure → HTTP 503."""
    try:
        with request_db_session(request) as db:
            try:
                return execution_service.start_execution(
                    db,
                    execution_id=execution_id,
                    user_id=user_id,
                    agent_id=agent_id,
                    session_id=session_id,
                )
            except Exception:
                db.rollback()
                raise
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to persist running execution %s", execution_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Failed to record agent execution",
        ) from exc


def begin_gated_run_or_http(
    request: Request,
    *,
    execution_id: uuid.UUID,
    user_id: str,
    agent_id: str,
    session_id: uuid.UUID,
) -> float:
    """Claim the session gate and insert the execution. Busy → 409, DB failure → 503."""
    try:
        with request_db_session(request) as db:
            return execution_service.begin_gated_execution(
                db,
                session_id=session_id,
                execution_id=execution_id,
                user_id=user_id,
                agent_id=agent_id,
            )
    except SessionBusyError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=exc.detail,
        ) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to claim session %s for execution %s", session_id, execution_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Failed to record agent execution",
        ) from exc


def resume_gated_run_or_http(
    request: Request,
    *,
    session_id: uuid.UUID,
    execution_id: uuid.UUID,
    checkpoint_id: str,
    interrupt_id: str,
    tool_call_id: str,
) -> float:
    """Move ``awaiting_approval`` back to ``running``. Mismatch → 409."""
    try:
        with request_db_session(request) as db:
            return resume_gated_run(
                db,
                session_id=session_id,
                execution_id=execution_id,
                checkpoint_id=checkpoint_id,
                interrupt_id=interrupt_id,
                tool_call_id=tool_call_id,
            )
    except SessionBusyError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=exc.detail,
        ) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to resume session %s execution %s", session_id, execution_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Failed to record agent execution",
        ) from exc


def finalize_execution_best_effort(
    request: Request,
    *,
    execution_id: uuid.UUID,
    status: str,
    monotonic_start: float,
    error_summary: str | None = None,
    session_id: uuid.UUID | None = None,
    attempts: int | None = None,
) -> None:
    """Idempotent terminal update in a fresh session. Failures are logged and swallowed.

    Successful runs retry the same conditional transaction up to three times.
    After that the gate is left unchanged and the HTTP response stays successful.
    Failed and cancelled runs try once. Passing ``session_id`` releases a running gate
    in that same transaction.
    """
    total = attempts
    if total is None:
        total = _FINALIZE_ATTEMPTS if status == SUCCEEDED else 1
    last_error: Exception | None = None
    for _ in range(total):
        try:
            with request_db_session(request) as db:
                try:
                    execution_service.finalize_execution(
                        db,
                        execution_id=execution_id,
                        status=status,
                        monotonic_start=monotonic_start,
                        error_summary=error_summary,
                        session_id=session_id,
                    )
                except Exception:
                    db.rollback()
                    raise
            return
        except Exception as exc:  # noqa: BLE001 — history must not fail a successful turn
            last_error = exc
            logger.exception(
                "Failed to finalize agent execution %s as %s",
                execution_id,
                status,
            )
    if session_id is not None and status == SUCCEEDED:
        logger.error(
            "Left session %s gate blocked after execution %s succeeded: %s",
            session_id,
            execution_id,
            last_error,
        )


def pause_for_approval_bounded(
    request: Request,
    *,
    session_id: uuid.UUID,
    execution_id: uuid.UUID,
    monotonic_start: float,
    checkpoint_id: str,
    interrupt_id: str,
    tool_call_id: str,
) -> None:
    """Persist the pause. After three failures, log and leave the gate unchanged."""
    last_error: Exception | None = None
    for _ in range(_FINALIZE_ATTEMPTS):
        try:
            with request_db_session(request) as db:
                pause_for_approval(
                    db,
                    session_id=session_id,
                    execution_id=execution_id,
                    monotonic_start=monotonic_start,
                    checkpoint_id=checkpoint_id,
                    interrupt_id=interrupt_id,
                    tool_call_id=tool_call_id,
                )
            return
        except Exception as exc:  # noqa: BLE001 — a paused graph still returns 202
            last_error = exc
            logger.exception(
                "Failed to pause execution %s for session %s",
                execution_id,
                session_id,
            )
    logger.error(
        "Left session %s gate blocked after execution %s paused: %s",
        session_id,
        execution_id,
        last_error,
    )


def start_lease_heartbeat(
    request: Request,
    *,
    session_id: uuid.UUID,
    execution_id: uuid.UUID,
) -> asyncio.Task[None]:
    """Diagnostic heartbeat. A failure does not fail the run or release the gate."""

    async def _beat() -> None:
        while True:
            await asyncio.sleep(_HEARTBEAT_SECONDS)
            try:
                with request_db_session(request) as db:
                    touch_lease(db, session_id=session_id, execution_id=execution_id)
            except Exception:  # noqa: BLE001 — heartbeat is diagnostic only
                logger.exception(
                    "Lease heartbeat failed for session %s execution %s",
                    session_id,
                    execution_id,
                )

    return asyncio.create_task(_beat())


async def stop_lease_heartbeat(task: asyncio.Task[None] | None) -> None:
    if task is None:
        return
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)


SUCCEEDED = AgentExecutionStatus.SUCCEEDED.value
FAILED = AgentExecutionStatus.FAILED.value
CANCELLED = AgentExecutionStatus.CANCELLED.value
