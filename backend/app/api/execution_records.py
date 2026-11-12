"""HTTP helpers for persisting agent execution metadata (#21)."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Iterator
from contextlib import contextmanager

from fastapi import HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.agent_execution import AgentExecutionStatus
from app.services import agent_executions as execution_service

logger = logging.getLogger(__name__)


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


def finalize_execution_best_effort(
    request: Request,
    *,
    execution_id: uuid.UUID,
    status: str,
    monotonic_start: float,
    error_summary: str | None = None,
) -> None:
    """Idempotent terminal update in a fresh session. Failures are logged and swallowed.

    Sync and cancellation-safe: callers should invoke this from ``finally`` without
    awaiting, so a pending task cancel cannot skip the write.
    """
    try:
        with request_db_session(request) as db:
            try:
                execution_service.finalize_execution(
                    db,
                    execution_id=execution_id,
                    status=status,
                    monotonic_start=monotonic_start,
                    error_summary=error_summary,
                )
            except Exception:
                db.rollback()
                raise
    except Exception:  # noqa: BLE001 — history must not fail a successful turn
        logger.exception(
            "Failed to finalize agent execution %s as %s",
            execution_id,
            status,
        )


SUCCEEDED = AgentExecutionStatus.SUCCEEDED.value
FAILED = AgentExecutionStatus.FAILED.value
CANCELLED = AgentExecutionStatus.CANCELLED.value
