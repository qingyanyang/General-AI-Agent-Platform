"""Agent execution history (#21): persistence, APIs, cancellation, idempotency."""

from __future__ import annotations

import asyncio
import socket
import struct
import threading
import time
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import httpx
import pytest
import uvicorn
from app.agents.errors import AgentExecutionError
from app.agents.runtime import AgentResult, run_agent
from app.api.deps import get_current_user
from app.core.auth import AuthenticatedUser
from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.permissions import PERM_AGENTS_EXECUTE, PERM_AGENTS_READ
from app.main import app
from app.models.agent import Agent, AgentStatus
from app.models.agent_execution import AgentExecution, AgentExecutionStatus
from app.schemas.chat_message import ChatMessageOut
from app.services import agent_executions as execution_service
from fastapi import Request
from fastapi.testclient import TestClient
from langchain_core.callbacks import AsyncCallbackManagerForLLMRun
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGenerationChunk
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import PrivateAttr
from pytest import MonkeyPatch
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from tests.auth_helpers import stub_get_current_user
from tests.chat_helpers import (
    OTHER,
    USER,
    create_session,
    default_execution_config,
    default_tool_auth,
    headers,
    seed_agent_grant,
    with_saver,
)
from tests.fakes import ScriptedChatModel


def _settings_with_key() -> Settings:
    return Settings(
        _env_file=None,
        llm_provider="openai",
        llm_api_key="test-key",
        langsmith_tracing=False,
        langsmith_api_key=None,
    )


def _use_model(monkeypatch: MonkeyPatch, model: ScriptedChatModel) -> None:
    monkeypatch.setattr("app.agents.runtime.get_settings", _settings_with_key)
    monkeypatch.setattr(
        "app.agents.runtime.create_chat_model_for_agent",
        lambda **_kwargs: model,
    )


def _count_executions(db: Session) -> int:
    return int(db.scalar(select(func.count()).select_from(AgentExecution)) or 0)


def _get_execution(db: Session, execution_id: str | uuid.UUID) -> AgentExecution | None:
    db.expire_all()
    return db.get(AgentExecution, uuid.UUID(str(execution_id)))


def test_sanitize_error_summary_rejects_arbitrary_strings() -> None:
    assert (
        execution_service.sanitize_error_summary("Agent execution failed")
        == "Agent execution failed"
    )
    assert (
        execution_service.sanitize_error_summary("secret api_key=sk-live-xxx in traceback")
        == "Agent execution failed"
    )
    assert execution_service.sanitize_error_summary(None) is None


def test_finalize_idempotent_does_not_overwrite_terminal(db_session: Session) -> None:
    execution_id = uuid.uuid4()
    start = execution_service.start_execution(
        db_session,
        execution_id=execution_id,
        user_id=USER,
        agent_id="default",
        session_id=None,
    )
    assert execution_service.finalize_execution(
        db_session,
        execution_id=execution_id,
        status=AgentExecutionStatus.SUCCEEDED.value,
        monotonic_start=start,
    )
    row = _get_execution(db_session, execution_id)
    assert row is not None
    assert row.status == AgentExecutionStatus.SUCCEEDED.value
    assert row.completed_at is not None
    assert row.duration_ms is not None

    assert not execution_service.finalize_execution(
        db_session,
        execution_id=execution_id,
        status=AgentExecutionStatus.CANCELLED.value,
        monotonic_start=start,
        error_summary="ignored",
    )
    row = _get_execution(db_session, execution_id)
    assert row is not None
    assert row.status == AgentExecutionStatus.SUCCEEDED.value
    assert row.error_summary is None


def test_agents_run_persists_succeeded(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    seed_agent_grant(db_session, USER)
    _use_model(monkeypatch, ScriptedChatModel(script=[AIMessage(content="ok")]))
    response = api_client.post(
        "/agents/run",
        json={"message": "hi"},
        headers=headers(),
    )
    assert response.status_code == 200, response.text
    execution_id = response.json()["execution_id"]
    row = _get_execution(db_session, execution_id)
    assert row is not None
    assert row.status == AgentExecutionStatus.SUCCEEDED.value
    assert row.user_id == USER
    assert row.session_id is None
    assert row.langsmith_run_id == execution_id
    assert row.completed_at is not None
    assert row.duration_ms is not None
    assert row.error_summary is None


def test_post_message_persists_succeeded(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    created = create_session(api_client, db_session)
    with_saver(api_client)
    _use_model(monkeypatch, ScriptedChatModel(script=[AIMessage(content="ok")]))
    response = api_client.post(
        f"/sessions/{created['id']}/messages",
        json={"content": "hi"},
        headers=headers(),
    )
    assert response.status_code == 200, response.text
    execution_id = response.json()["execution_id"]
    row = _get_execution(db_session, execution_id)
    assert row is not None
    assert row.status == AgentExecutionStatus.SUCCEEDED.value
    assert str(row.session_id) == created["id"]


def test_failed_initial_insert_returns_503_and_never_invokes_model(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    seed_agent_grant(db_session, USER)
    called = {"run": False}

    async def _boom(*_args, **_kwargs):
        called["run"] = True
        raise AssertionError("model must not be invoked")

    monkeypatch.setattr(
        "app.api.execution_records.execution_service.start_execution",
        lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("db down")),
    )
    monkeypatch.setattr("app.api.routes.agents.run_agent", _boom)
    response = api_client.post(
        "/agents/run",
        json={"message": "hi"},
        headers=headers(),
    )
    assert response.status_code == 503
    assert called["run"] is False
    assert _count_executions(db_session) == 0


def test_finalization_failure_preserves_successful_response(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    seed_agent_grant(db_session, USER)
    _use_model(monkeypatch, ScriptedChatModel(script=[AIMessage(content="ok")]))

    def _fail_finalize(*_args, **_kwargs):
        raise RuntimeError("finalize boom")

    monkeypatch.setattr(
        "app.api.execution_records.execution_service.finalize_execution",
        _fail_finalize,
    )
    response = api_client.post(
        "/agents/run",
        json={"message": "hi"},
        headers=headers(),
    )
    assert response.status_code == 200, response.text
    execution_id = response.json()["execution_id"]
    row = _get_execution(db_session, execution_id)
    assert row is not None
    assert row.status == AgentExecutionStatus.RUNNING.value
    assert row.completed_at is None


def test_forced_failure_persists_sanitized_summary(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    seed_agent_grant(db_session, USER)

    async def _fail(*_args, **_kwargs):
        raise AgentExecutionError(
            "secret provider dump",
            execution_id=str(_kwargs.get("execution_id") or "x"),
        )

    # Ensure start uses a known id path: patch run_agent after start.
    monkeypatch.setattr("app.api.routes.agents.run_agent", _fail)
    response = api_client.post(
        "/agents/run",
        json={"message": "hi"},
        headers=headers(),
    )
    assert response.status_code == 502
    assert _count_executions(db_session) == 1
    row = db_session.scalars(select(AgentExecution)).one()
    assert row.status == AgentExecutionStatus.FAILED.value
    assert row.error_summary == "Agent execution failed"
    assert "secret" not in (row.error_summary or "")


def test_rejected_auth_creates_no_row(api_client: TestClient, db_session: Session) -> None:
    response = api_client.post("/agents/run", json={"message": "hi"})
    assert response.status_code == 422
    assert _count_executions(db_session) == 0


def test_rejected_grant_creates_no_row(
    api_client: TestClient,
    db_session: Session,
) -> None:
    # Agent exists but caller has no execute grant.
    seed_agent_grant(db_session, OTHER, can_execute=True)
    response = api_client.post(
        "/agents/run",
        json={"message": "hi"},
        headers=headers(USER),
    )
    assert response.status_code in {403, 404}
    assert _count_executions(db_session) == 0


def test_inactive_agent_creates_no_row(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(db_session, USER)
    agent = db_session.get(Agent, "default")
    assert agent is not None
    agent.status = AgentStatus.INACTIVE.value
    db_session.commit()
    response = api_client.post(
        "/agents/run",
        json={"message": "hi"},
        headers=headers(),
    )
    assert response.status_code == 409
    assert _count_executions(db_session) == 0


async def _fake_run_agent(message: str, **kwargs: object) -> AgentResult:
    execution_id = str(kwargs.get("execution_id") or uuid.uuid4())
    return AgentResult(reply="ok", messages=[], execution_id=execution_id)


def test_list_and_get_owner_only(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    seed_agent_grant(db_session, USER)
    seed_agent_grant(db_session, OTHER)
    monkeypatch.setattr("app.api.routes.agents.run_agent", _fake_run_agent)
    mine = api_client.post(
        "/agents/run",
        json={"message": "hi"},
        headers=headers(USER),
    )
    assert mine.status_code == 200
    theirs = api_client.post(
        "/agents/run",
        json={"message": "hi"},
        headers=headers(OTHER),
    )
    assert theirs.status_code == 200
    my_id = mine.json()["execution_id"]
    their_id = theirs.json()["execution_id"]

    listed = api_client.get("/executions", headers=headers(USER))
    assert listed.status_code == 200
    ids = {item["id"] for item in listed.json()["items"]}
    assert my_id in ids
    assert their_id not in ids

    assert api_client.get(f"/executions/{my_id}", headers=headers(USER)).status_code == 200
    assert api_client.get(f"/executions/{their_id}", headers=headers(USER)).status_code == 404


def test_list_requires_agents_read_permission(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    seed_agent_grant(db_session, USER, can_view=False, can_execute=True)
    monkeypatch.setattr("app.api.routes.agents.run_agent", _fake_run_agent)
    run = api_client.post("/agents/run", json={"message": "hi"}, headers=headers(USER))
    assert run.status_code == 200
    execution_id = run.json()["execution_id"]

    def _execute_only(request: Request) -> AuthenticatedUser:
        return AuthenticatedUser(
            user_id=request.headers.get("x-user-id", USER),
            permissions=frozenset({PERM_AGENTS_EXECUTE}),
        )

    api_client.app.dependency_overrides[get_current_user] = _execute_only
    try:
        denied = api_client.get("/executions", headers=headers(USER))
        assert denied.status_code == 403, denied.text
    finally:
        api_client.app.dependency_overrides[get_current_user] = stub_get_current_user

    def _read_only(request: Request) -> AuthenticatedUser:
        return AuthenticatedUser(
            user_id=request.headers.get("x-user-id", USER),
            permissions=frozenset({PERM_AGENTS_READ}),
        )

    api_client.app.dependency_overrides[get_current_user] = _read_only
    try:
        allowed = api_client.get("/executions", headers=headers(USER))
        assert allowed.status_code == 200, allowed.text
        assert any(item["id"] == execution_id for item in allowed.json()["items"])
    finally:
        api_client.app.dependency_overrides[get_current_user] = stub_get_current_user


def test_list_pagination_and_filters(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(db_session, USER)
    now = datetime.now(UTC)
    ids: list[uuid.UUID] = []
    for index in range(3):
        execution_id = uuid.uuid4()
        ids.append(execution_id)
        db_session.add(
            AgentExecution(
                id=execution_id,
                user_id=USER,
                agent_id="default",
                session_id=None,
                status=(
                    AgentExecutionStatus.SUCCEEDED.value
                    if index < 2
                    else AgentExecutionStatus.FAILED.value
                ),
                started_at=now - timedelta(seconds=index),
                completed_at=now,
                duration_ms=10,
                error_summary=None,
                langsmith_run_id=str(execution_id),
            )
        )
    db_session.commit()

    page1 = api_client.get(
        "/executions",
        params={"limit": 2, "status": "succeeded"},
        headers=headers(USER),
    )
    assert page1.status_code == 200
    body = page1.json()
    assert len(body["items"]) == 2
    assert body["next_cursor"] is None or isinstance(body["next_cursor"], str)

    failed = api_client.get(
        "/executions",
        params={"status": "failed"},
        headers=headers(USER),
    )
    assert failed.status_code == 200
    assert len(failed.json()["items"]) == 1
    assert failed.json()["items"][0]["status"] == "failed"


def test_stream_success_persists_succeeded(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    created = create_session(api_client, db_session)
    with_saver(api_client)
    _use_model(monkeypatch, ScriptedChatModel(script=[AIMessage(content="Hello!")]))
    with api_client.stream(
        "POST",
        f"/sessions/{created['id']}/messages/stream",
        json={"content": "hi"},
        headers=headers(),
    ) as response:
        assert response.status_code == 200
        body = response.read().decode()
    assert "event: done" in body
    row = db_session.scalars(select(AgentExecution)).one()
    assert row.status == AgentExecutionStatus.SUCCEEDED.value


def test_stream_failure_persists_failed(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    created = create_session(api_client, db_session)
    with_saver(api_client)

    class _Boom(ScriptedChatModel):
        async def _astream(self, *args, **kwargs):  # noqa: ANN002, ANN003
            raise RuntimeError("provider secret")
            yield  # pragma: no cover

    _use_model(monkeypatch, _Boom(script=[]))
    with api_client.stream(
        "POST",
        f"/sessions/{created['id']}/messages/stream",
        json={"content": "hi"},
        headers=headers(),
    ) as response:
        assert response.status_code == 200
        body = response.read().decode()
    assert "event: error" in body
    row = db_session.scalars(select(AgentExecution)).one()
    assert row.status == AgentExecutionStatus.FAILED.value
    assert row.error_summary == "Agent execution failed"


def test_json_cancellation_finalizes_cancelled(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    seed_agent_grant(db_session, USER)
    entered = threading.Event()

    async def _block(*_args, **_kwargs):
        entered.set()
        await asyncio.Event().wait()

    monkeypatch.setattr("app.api.routes.agents.run_agent", _block)

    async def _call_and_cancel() -> None:
        # Drive the ASGI app directly so we can cancel the request task.
        from httpx import ASGITransport, AsyncClient

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            task = asyncio.create_task(
                client.post(
                    "/agents/run",
                    json={"message": "hi"},
                    headers=headers(USER),
                )
            )
            deadline = time.time() + 3
            while not entered.is_set():
                if time.time() > deadline:
                    raise AssertionError("run_agent did not start")
                await asyncio.sleep(0.01)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task

    asyncio.run(_call_and_cancel())
    # Give finally a moment if needed; finalize is sync in finally.
    row = db_session.scalars(select(AgentExecution)).one()
    assert row.status == AgentExecutionStatus.CANCELLED.value


class BlockingChatModel(ScriptedChatModel):
    _entered: threading.Event = PrivateAttr(default_factory=threading.Event)
    _release: threading.Event = PrivateAttr(default_factory=threading.Event)
    _cancelled: threading.Event = PrivateAttr(default_factory=threading.Event)

    async def _astream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: AsyncCallbackManagerForLLMRun | None = None,
        **kwargs: object,
    ) -> AsyncIterator[ChatGenerationChunk]:
        self._entered.set()
        try:
            while not self._release.is_set():
                await asyncio.sleep(0.01)
        except asyncio.CancelledError:
            self._cancelled.set()
            raise
        async for chunk in super()._astream(
            messages,
            stop=stop,
            run_manager=run_manager,
            **kwargs,
        ):
            yield chunk


def test_http_disconnect_before_chunk_finalizes_cancelled(
    db_engine,
    monkeypatch: MonkeyPatch,
) -> None:
    """Real TCP disconnect; assert DB status after cleanup (not just closed buffer)."""
    model = BlockingChatModel(script=[AIMessage(content="Hello!")])
    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    get_settings.cache_clear()
    monkeypatch.setattr("app.agents.runtime.get_settings", _settings_with_key)
    monkeypatch.setattr(
        "app.agents.runtime.create_chat_model_for_agent",
        lambda **_kwargs: model,
    )

    factory = sessionmaker(bind=db_engine, autoflush=False, autocommit=False)

    def _override_db():
        session = factory()
        try:
            yield session
        finally:
            session.close()

    seed_session = factory()
    try:
        seed_agent_grant(seed_session, USER)
    finally:
        seed_session.close()

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = stub_get_current_user
    config = uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    execution_id: str | None = None
    try:
        deadline = time.time() + 5
        while not server.started:
            if time.time() > deadline:
                raise AssertionError("uvicorn did not start")
            time.sleep(0.05)
        app.state.checkpointer = InMemorySaver()
        sockets = server.servers[0].sockets
        assert sockets is not None
        port = sockets[0].getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        with httpx.Client(timeout=5) as client:
            created = client.post(
                f"{base}/sessions",
                json={"agent_id": "default"},
                headers=headers(USER),
            )
            assert created.status_code == 201
            session_id = created.json()["id"]
        payload = b'{"content":"hi"}'
        request = (
            f"POST /sessions/{session_id}/messages/stream HTTP/1.1\r\n"
            f"Host: 127.0.0.1:{port}\r\n"
            "Content-Type: application/json\r\n"
            f"X-User-Id: {USER}\r\n"
            f"Content-Length: {len(payload)}\r\n"
            "Connection: close\r\n"
            "\r\n"
        ).encode() + payload
        sock = socket.create_connection(("127.0.0.1", port))
        try:
            sock.sendall(request)
            sock.settimeout(3)
            received = b""
            while b"\r\n\r\n" not in received:
                chunk = sock.recv(4096)
                assert chunk
                received += chunk
            assert b" 200 " in received.split(b"\r\n", 1)[0]
            assert model._entered.wait(3)
        finally:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
            sock.close()
        assert model._cancelled.wait(3)
        # Wait until cleanup finalizes the row.
        verify = factory()
        try:
            deadline = time.time() + 5
            row = None
            while time.time() < deadline:
                verify.expire_all()
                row = verify.scalars(select(AgentExecution)).first()
                if row is not None and row.status != AgentExecutionStatus.RUNNING.value:
                    break
                time.sleep(0.05)
            assert row is not None
            assert row.status == AgentExecutionStatus.CANCELLED.value
            execution_id = str(row.id)
        finally:
            verify.close()
    finally:
        server.should_exit = True
        server.force_exit = True
        thread.join(timeout=5)
        app.dependency_overrides.clear()
        app.state.checkpointer = None
        get_settings.cache_clear()
    assert execution_id is not None


def test_optional_execution_id_on_run_agent() -> None:
    fixed = uuid.uuid4()
    result = asyncio.run(
        run_agent(
            "Hi",
            tool_auth=default_tool_auth(),
            execution_config=default_execution_config(),
            llm=ScriptedChatModel(script=[AIMessage(content="Hello!")]),
            execution_id=fixed,
        ),
    )
    assert result.execution_id == str(fixed)


def test_post_message_fake_still_accepts_execution_id_kwarg(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    """Existing monkeypatches that ignore kwargs must keep working."""
    created = create_session(api_client, db_session)
    with_saver(api_client)
    captured: dict = {}

    async def fake_post(*, content: str, **kwargs):
        captured["execution_id"] = kwargs.get("execution_id")
        return str(kwargs["execution_id"]), ChatMessageOut(role="assistant", content="ok")

    monkeypatch.setattr(
        "app.api.routes.sessions.message_service.post_user_message",
        fake_post,
    )
    response = api_client.post(
        f"/sessions/{created['id']}/messages",
        json={"content": "hi"},
        headers=headers(),
    )
    assert response.status_code == 200
    assert captured["execution_id"] is not None
    row = _get_execution(db_session, response.json()["execution_id"])
    assert row is not None
    assert row.status == AgentExecutionStatus.SUCCEEDED.value
