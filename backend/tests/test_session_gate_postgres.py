"""PostgreSQL session-gate concurrency and restart recovery (#24).

Uses TEST_DATABASE_URL only. Skipped when unset. Never falls back to the
application DATABASE_URL or CHECKPOINT_TEST_DATABASE_URL.
"""

from __future__ import annotations

import threading
import uuid

import pytest
from app.models.agent_execution import AgentExecution, AgentExecutionStatus
from app.models.base import Base, postgres_schema_name
from app.models.session_run_gate import SessionRunGate
from app.services.agent_executions import begin_gated_execution
from app.services.session_gates import (
    AWAITING,
    IDLE,
    SessionBusyError,
    WorkersNotConfirmedError,
    recover_stuck_run,
)
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from tests.conftest import business_database_url

pytestmark = pytest.mark.business_db


def _engine_url() -> str:
    url = business_database_url()
    if not url:
        pytest.skip("TEST_DATABASE_URL not set")
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url.removeprefix("postgresql://")
    return url


@pytest.fixture
def business_session() -> Session:
    engine = create_engine(_engine_url(), poolclass=NullPool)
    schema = postgres_schema_name()
    with engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = factory()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def _cleanup(session: Session, session_ids: list[uuid.UUID]) -> None:
    if not session_ids:
        return
    session.rollback()
    session.query(AgentExecution).filter(AgentExecution.session_id.in_(session_ids)).delete(
        synchronize_session=False
    )
    session.query(SessionRunGate).filter(SessionRunGate.session_id.in_(session_ids)).delete(
        synchronize_session=False
    )
    session.commit()


def test_concurrent_claims_create_one_gate_and_one_winner(business_session: Session) -> None:
    session_id = uuid.uuid4()
    barrier = threading.Barrier(2)
    outcomes: list[str] = []
    lock = threading.Lock()

    def _claim(execution_id: uuid.UUID) -> None:
        worker = Session(business_session.get_bind())
        try:
            barrier.wait(timeout=10)
            try:
                begin_gated_execution(
                    worker,
                    session_id=session_id,
                    execution_id=execution_id,
                    user_id="worker",
                    agent_id="default",
                )
                result = "ok"
            except SessionBusyError:
                result = "busy"
            except Exception as exc:  # noqa: BLE001 — report the race failure in the assertion
                result = f"error:{type(exc).__name__}:{exc}"
        finally:
            worker.close()
        with lock:
            outcomes.append(result)

    first = uuid.uuid4()
    second = uuid.uuid4()
    threads = [
        threading.Thread(target=_claim, args=(first,)),
        threading.Thread(target=_claim, args=(second,)),
    ]
    try:
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=20)
        assert outcomes.count("ok") == 1, outcomes
        assert outcomes.count("busy") == 1, outcomes
        business_session.rollback()
        gates = business_session.query(SessionRunGate).filter_by(session_id=session_id).all()
        assert len(gates) == 1
        assert gates[0].state != IDLE
    finally:
        _cleanup(business_session, [session_id])


def test_restart_leaves_running_gate_until_workers_are_confirmed_stopped(
    business_session: Session,
) -> None:
    session_id = uuid.uuid4()
    execution_id = uuid.uuid4()
    try:
        begin_gated_execution(
            business_session,
            session_id=session_id,
            execution_id=execution_id,
            user_id="worker",
            agent_id="default",
        )
        with pytest.raises(SessionBusyError):
            begin_gated_execution(
                business_session,
                session_id=session_id,
                execution_id=uuid.uuid4(),
                user_id="worker",
                agent_id="default",
            )
        with pytest.raises(WorkersNotConfirmedError):
            recover_stuck_run(
                business_session,
                session_id=session_id,
                execution_id=execution_id,
                workers_stopped=False,
                checkpoint_id="checkpoint-1",
                interrupt_id="interrupt-1",
                tool_call_id="call-1",
            )
        business_session.expire_all()
        before = business_session.get(AgentExecution, execution_id)
        assert before is not None
        assert before.status == AgentExecutionStatus.RUNNING.value
        recorded = before.active_duration_ms
        recover_stuck_run(
            business_session,
            session_id=session_id,
            execution_id=execution_id,
            workers_stopped=True,
            checkpoint_id="checkpoint-1",
            interrupt_id="interrupt-1",
            tool_call_id="call-1",
        )
        business_session.expire_all()
        execution = business_session.get(AgentExecution, execution_id)
        gate = business_session.get(SessionRunGate, session_id)
        assert execution is not None
        assert execution.status == AgentExecutionStatus.AWAITING_APPROVAL.value
        assert execution.active_duration_ms == recorded
        assert execution.duration_ms is None
        assert gate is not None and gate.state == AWAITING
    finally:
        _cleanup(business_session, [session_id])
