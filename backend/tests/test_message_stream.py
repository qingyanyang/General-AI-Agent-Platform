"""SSE chat streaming: deltas, tools, errors, cancellation, and chunk merge."""

from __future__ import annotations

import asyncio
import json
import socket
import struct
import threading
import time
from collections.abc import AsyncIterator

import httpx
import pytest
import uvicorn
from app.agents.runtime import StreamOutcome, run_agent, stream_agent
from app.agents.tools.registry import ToolRegistry
from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.main import app
from app.services.chat_sessions import touch_last_activity
from fastapi.testclient import TestClient
from langchain_core.callbacks import AsyncCallbackManagerForLLMRun
from langchain_core.messages import AIMessage, BaseMessage, ToolMessage
from langchain_core.outputs import ChatGenerationChunk
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import PrivateAttr
from pytest import MonkeyPatch
from sqlalchemy.orm import Session, sessionmaker

from tests.chat_helpers import (
    OTHER,
    USER,
    create_session,
    default_tool_auth,
    headers,
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


def _settings_without_key() -> Settings:
    return Settings(
        _env_file=None,
        llm_provider="openai",
        llm_api_key=None,
        deepseek_api_key=None,
    )


def _tool_call_message(*, content: str = "", a: float = 2, b: float = 3) -> AIMessage:
    return AIMessage(
        content=content,
        tool_calls=[
            {
                "name": "add",
                "args": {"a": a, "b": b},
                "id": "call_add_1",
                "type": "tool_call",
            }
        ],
    )


def _parse_sse(body: str) -> list[dict]:
    events: list[dict] = []
    event_name: str | None = None
    for line in body.splitlines():
        if line.startswith("event:"):
            event_name = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            payload = json.loads(line.split(":", 1)[1].strip())
            assert payload["type"] == event_name
            events.append(payload)
    return events


def _use_model(monkeypatch: MonkeyPatch, model: ScriptedChatModel) -> None:
    monkeypatch.setattr("app.agents.runtime.get_settings", _settings_with_key)
    monkeypatch.setattr("app.agents.graph.create_chat_model", lambda: model)


def _stream(api_client: TestClient, session_id: str, content: str = "hi") -> tuple[int, str, str]:
    with api_client.stream(
        "POST",
        f"/sessions/{session_id}/messages/stream",
        json={"content": content},
        headers=headers(),
    ) as response:
        return (
            response.status_code,
            response.headers.get("content-type", ""),
            response.read().decode(),
        )


class BlockingChatModel(ScriptedChatModel):
    """Blocks inside the graph iterator until cancelled or released."""

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


def test_streamed_chunks_merge_text_and_tool_arguments() -> None:
    text_result = asyncio.run(
        run_agent(
            "Hi",
            tool_auth=default_tool_auth(),
            llm=ScriptedChatModel(script=[AIMessage(content="Hello!")]),
        ),
    )
    assert text_result.reply == "Hello!"
    assert [item.role for item in text_result.messages] == ["user", "assistant"]
    assert text_result.messages[-1].content == "Hello!"

    tool_result = asyncio.run(
        run_agent(
            "What is 2 + 3?",
            tool_auth=default_tool_auth(),
            llm=ScriptedChatModel(
                script=[
                    _tool_call_message(),
                    AIMessage(content="The sum is 5."),
                ]
            ),
        ),
    )
    assert tool_result.reply == "The sum is 5."
    roles = [item.role for item in tool_result.messages]
    assert "tool" in roles
    assert roles[-1] == "assistant"


def test_no_tool_deltas_match_final_reply(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    created = create_session(api_client, db_session)
    with_saver(api_client)
    before = created["last_activity_at"]
    _use_model(monkeypatch, ScriptedChatModel(script=[AIMessage(content="Hello!")]))

    status_code, content_type, body = _stream(api_client, created["id"])

    assert status_code == 200
    assert content_type.startswith("text/event-stream")
    events = _parse_sse(body)
    deltas = [event["content"] for event in events if event["type"] == "message.delta"]
    assert len(deltas) >= 2
    assert "".join(deltas) == "Hello!"
    assert events[-1]["type"] == "done"
    assert events[-1]["message"] == {"role": "assistant", "content": "Hello!"}
    session = api_client.get(f"/sessions/{created['id']}", headers=headers()).json()
    assert session["last_activity_at"] >= before


def test_tool_deltas_are_not_the_final_reply(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    created = create_session(api_client, db_session)
    with_saver(api_client)
    _use_model(
        monkeypatch,
        ScriptedChatModel(
            script=[
                _tool_call_message(content="Let me add."),
                AIMessage(content="The sum is 5."),
            ]
        ),
    )

    status_code, _content_type, body = _stream(api_client, created["id"], "What is 2 + 3?")

    assert status_code == 200
    events = _parse_sse(body)
    types = [event["type"] for event in events]
    start = types.index("tool.start")
    end = types.index("tool.end")
    done = types.index("done")
    assert start < end < done
    assert events[start]["name"] == "add"
    assert events[start]["tool_call_id"] == "call_add_1"
    assert events[end]["name"] == "add"
    assert events[end]["tool_call_id"] == "call_add_1"
    assert "5" in events[end]["content"]
    deltas = [event["content"] for event in events if event["type"] == "message.delta"]
    assert "Let me add." in "".join(deltas)
    assert "".join(deltas) != events[done]["message"]["content"]
    assert events[done]["message"]["content"] == "The sum is 5."
    assert "5.0" not in deltas


def test_graph_failure_emits_error_without_done(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    created = create_session(api_client, db_session)
    with_saver(api_client)

    class Boom(ScriptedChatModel):
        def _stream(self, messages, stop=None, run_manager=None, **kwargs):  # noqa: ANN001
            raise RuntimeError("upstream boom")

    _use_model(monkeypatch, Boom(script=[]))
    status_code, _content_type, body = _stream(api_client, created["id"])
    events = _parse_sse(body)
    assert status_code == 200
    assert [event["type"] for event in events] == ["error"]
    assert events[0]["message"] == "Agent execution failed"
    assert events[0]["execution_id"]


def test_validation_precedes_missing_checkpointer(
    api_client: TestClient, db_session: Session
) -> None:
    created = create_session(api_client, db_session)
    api_client.app.state.checkpointer = None
    missing_header = api_client.post(
        f"/sessions/{created['id']}/messages/stream",
        json={"content": "hi"},
    )
    assert missing_header.status_code == 422
    blank = api_client.post(
        f"/sessions/{created['id']}/messages/stream",
        json={"content": "   "},
        headers=headers(),
    )
    assert blank.status_code == 422


def test_missing_checkpointer_returns_503_before_ownership(api_client: TestClient) -> None:
    api_client.app.state.checkpointer = None
    response = api_client.post(
        "/sessions/00000000-0000-4000-8000-000000000000/messages/stream",
        json={"content": "hi"},
        headers=headers(),
    )
    assert response.status_code == 503
    assert "persistence" in response.json()["detail"].lower()


def test_other_user_returns_404_before_llm_check(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    created = create_session(api_client, db_session)
    with_saver(api_client)
    monkeypatch.setattr("app.agents.runtime.get_settings", _settings_without_key)
    response = api_client.post(
        f"/sessions/{created['id']}/messages/stream",
        json={"content": "hi"},
        headers=headers(OTHER),
    )
    assert response.status_code == 404


def test_missing_llm_after_ownership_returns_503(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    created = create_session(api_client, db_session)
    with_saver(api_client)
    monkeypatch.setattr("app.agents.runtime.get_settings", _settings_without_key)
    response = api_client.post(
        f"/sessions/{created['id']}/messages/stream",
        json={"content": "hi"},
        headers=headers(),
    )
    assert response.status_code == 503
    assert "API key" in response.json()["detail"]


def test_activity_is_updated_before_done(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    created = create_session(api_client, db_session)
    with_saver(api_client)
    _use_model(monkeypatch, ScriptedChatModel(script=[AIMessage(content="Hello!")]))
    started = threading.Event()
    release = threading.Event()

    def blocking_touch(db, session) -> None:  # noqa: ANN001
        started.set()
        assert release.wait(timeout=3)
        touch_last_activity(db, session)

    monkeypatch.setattr(
        "app.api.routes.sessions.session_service.touch_last_activity",
        blocking_touch,
    )
    lines: list[str] = []

    def consume() -> None:
        with api_client.stream(
            "POST",
            f"/sessions/{created['id']}/messages/stream",
            json={"content": "hi"},
            headers=headers(),
        ) as response:
            assert response.status_code == 200
            for line in response.iter_lines():
                lines.append(line)

    reader = threading.Thread(target=consume)
    reader.start()
    assert started.wait(3)
    assert not any(line.startswith("event: done") for line in lines)
    release.set()
    reader.join(3)
    assert not reader.is_alive()
    events = _parse_sse("\n".join(lines))
    assert events[-1]["type"] == "done"


def test_activity_failure_still_emits_done(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    created = create_session(api_client, db_session)
    with_saver(api_client)
    _use_model(monkeypatch, ScriptedChatModel(script=[AIMessage(content="Hello!")]))

    def boom_touch(db, session) -> None:  # noqa: ANN001
        raise RuntimeError("db write failed")

    monkeypatch.setattr(
        "app.api.routes.sessions.session_service.touch_last_activity",
        boom_touch,
    )
    status_code, _content_type, body = _stream(api_client, created["id"])
    events = _parse_sse(body)
    assert status_code == 200
    assert events[-1]["type"] == "done"
    assert events[-1]["message"]["content"] == "Hello!"


def test_cancel_producer_task_propagates_without_error_event() -> None:
    model = BlockingChatModel(script=[AIMessage(content="Hello!")])
    events: list = []

    async def scenario() -> None:
        async def producer() -> None:
            async for event in stream_agent(
                "hi",
                tool_auth=default_tool_auth(),
                llm=model,
            ):
                events.append(event)

        task = asyncio.create_task(producer())
        assert await asyncio.to_thread(model._entered.wait, 3)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(scenario())
    assert model._cancelled.is_set()
    assert not any(event.type == "error" for event in events)


class _RecordingChatModel(ScriptedChatModel):
    """Records each model input so a later turn can be checked for tool calls."""

    _seen: list[list[BaseMessage]] = PrivateAttr(default_factory=list)

    def _stream(self, messages, stop=None, run_manager=None, **kwargs):  # noqa: ANN001
        self._seen.append(list(messages))
        return super()._stream(messages, stop=stop, run_manager=run_manager, **kwargs)


def _unanswered_tool_call_ids(messages: list[BaseMessage]) -> list[str]:
    answered = {
        message.tool_call_id
        for message in messages
        if isinstance(message, ToolMessage) and message.tool_call_id
    }
    missing: list[str] = []
    for message in messages:
        if not isinstance(message, AIMessage):
            continue
        for tool_call in message.tool_calls:
            call_id = str(tool_call.get("id") or "")
            if call_id not in answered:
                missing.append(call_id)
    return missing


def test_cancel_during_tool_execution_keeps_next_turn_valid(
    monkeypatch: MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.agents.runtime.get_settings", _settings_with_key)
    entered = asyncio.Event()

    async def _block_until_cancelled(
        self,
        name: str,
        args: dict,
        *,
        context=None,  # noqa: ANN001
    ) -> None:
        entered.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(ToolRegistry, "aexecute", _block_until_cancelled)
    model = _RecordingChatModel(
        script=[
            _tool_call_message(content="Let me add."),
            AIMessage(content="Next reply"),
        ]
    )
    saver = InMemorySaver()
    first_events: list = []

    async def scenario() -> None:
        async def producer() -> None:
            async for event in stream_agent(
                "2+3",
                tool_auth=default_tool_auth(),
                llm=model,
                checkpointer=saver,
                thread_id="thread-1",
            ):
                first_events.append(event)

        task = asyncio.create_task(producer())
        assert await asyncio.wait_for(entered.wait(), timeout=3)
        task.cancel()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

        outcome = StreamOutcome()
        async for _event in stream_agent(
            "next question",
            tool_auth=default_tool_auth(),
            llm=model,
            checkpointer=saver,
            thread_id="thread-1",
            outcome=outcome,
        ):
            pass
        assert outcome.failed is False
        assert outcome.message is not None
        assert outcome.message.content == "Next reply"

    asyncio.run(scenario())
    assert not any(event.type == "error" for event in first_events)
    assert any(event.type == "tool.start" for event in first_events)
    assert model._seen
    follow_up = model._seen[-1]
    assert _unanswered_tool_call_ids(follow_up) == []
    assert any(
        isinstance(message, ToolMessage)
        and message.tool_call_id == "call_add_1"
        and message.content == "Tool execution cancelled"
        for message in follow_up
    )


def test_http_disconnect_cancels_producer(
    db_engine,
    monkeypatch: MonkeyPatch,
) -> None:
    model = BlockingChatModel(script=[AIMessage(content="Hello!")])
    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    get_settings.cache_clear()
    monkeypatch.setattr("app.agents.runtime.get_settings", _settings_with_key)
    monkeypatch.setattr("app.agents.graph.create_chat_model", lambda: model)

    factory = sessionmaker(bind=db_engine, autoflush=False, autocommit=False)

    def _override_db():
        session = factory()
        try:
            yield session
        finally:
            session.close()

    from app.api.deps import get_current_user

    from tests.auth_helpers import stub_get_current_user
    from tests.chat_helpers import seed_agent_grant

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
            status_line = received.split(b"\r\n", 1)[0]
            assert b" 200 " in status_line
            assert model._entered.wait(3)
        finally:
            # RST the TCP connection so Uvicorn observes a real disconnect.
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
            sock.close()
        assert model._cancelled.wait(3)
    finally:
        server.should_exit = True
        server.force_exit = True
        thread.join(timeout=5)
        app.dependency_overrides.clear()
        app.state.checkpointer = None
        get_settings.cache_clear()
