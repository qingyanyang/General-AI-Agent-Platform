"""Server-side tool authorization (#18)."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest
from app.agents.errors import AgentExecutionError
from app.agents.runtime import StreamOutcome, run_agent, stream_agent
from app.agents.tool_policy import (
    BUILTIN_REQUIRED_PERMISSIONS,
    ToolAuthContext,
    ToolAuthorizationError,
    get_tool_auth_context,
    permitted_tool_names,
)
from app.agents.tools import ToolRegistry, create_default_registry
from app.core.permissions import PERM_AGENTS_EXECUTE, PERM_AGENTS_READ
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver
from pytest import MonkeyPatch
from sqlalchemy.orm import Session

from tests.chat_helpers import (
    REPORTING_TOOL_NAMES,
    create_session,
    default_execution_config,
    default_tool_auth,
    headers,
    with_saver,
)
from tests.fakes import ScriptedChatModel


def _forbidden_add_call() -> AIMessage:
    return AIMessage(
        content="",
        tool_calls=[
            {
                "name": "add",
                "args": {"a": 1, "b": 2},
                "id": "call_forbidden_add",
                "type": "tool_call",
            }
        ],
    )


def _use_model(monkeypatch: MonkeyPatch, model: ScriptedChatModel) -> None:
    from app.core.config import Settings

    def _settings_with_key() -> Settings:
        return Settings(_env_file=None, llm_api_key="test-key")

    monkeypatch.setattr("app.agents.runtime.get_settings", _settings_with_key)
    monkeypatch.setattr("app.agents.runtime.create_chat_model_for_agent", lambda **_kwargs: model)


def test_permitted_tools_for_default_agent() -> None:
    registry = create_default_registry()
    auth = default_tool_auth()
    assert permitted_tool_names(registry, auth) == frozenset({"add", "multiply", "echo"})


def test_permitted_tools_reporting_subset() -> None:
    registry = create_default_registry()
    auth = default_tool_auth(
        agent_id="reporting",
        allowed_tools=frozenset(REPORTING_TOOL_NAMES),
    )
    assert permitted_tool_names(registry, auth) == frozenset({"echo"})


def test_empty_allowed_tools_permits_nothing() -> None:
    registry = create_default_registry()
    auth = default_tool_auth(agent_id="unknown-agent", allowed_tools=frozenset())
    assert permitted_tool_names(registry, auth) == frozenset()


def test_missing_permissions_excludes_tools() -> None:
    registry = create_default_registry()
    auth = default_tool_auth(permissions=frozenset({PERM_AGENTS_READ}))
    assert permitted_tool_names(registry, auth) == frozenset()


def test_aexecute_allows_authorized_tool() -> None:
    registry = create_default_registry()
    result = asyncio.run(
        registry.aexecute("add", {"a": 2, "b": 3}, context=default_tool_auth()),
    )
    assert result == 5.0


def test_aexecute_denies_without_invoking_tool() -> None:
    calls: list[tuple[float, float]] = []

    @tool("add")
    def tracked_add(a: float, b: float) -> float:
        """Add two numbers."""
        calls.append((a, b))
        return a + b

    registry = ToolRegistry()
    registry.register(tracked_add, required_permissions=BUILTIN_REQUIRED_PERMISSIONS)

    with pytest.raises(ToolAuthorizationError):
        asyncio.run(
            registry.aexecute(
                "add",
                {"a": 1, "b": 2},
                context=default_tool_auth(
                    agent_id="reporting",
                    allowed_tools=frozenset(REPORTING_TOOL_NAMES),
                ),
            ),
        )
    assert calls == []


def test_aexecute_denies_missing_permissions_without_invoking_tool() -> None:
    """Allowlisted tool still denied when caller lacks required_permissions."""
    calls: list[tuple[float, float]] = []

    @tool("add")
    def tracked_add(a: float, b: float) -> float:
        """Add two numbers."""
        calls.append((a, b))
        return a + b

    registry = ToolRegistry()
    registry.register(tracked_add, required_permissions=BUILTIN_REQUIRED_PERMISSIONS)

    with pytest.raises(ToolAuthorizationError, match="missing permissions"):
        asyncio.run(
            registry.aexecute(
                "add",
                {"a": 1, "b": 2},
                context=default_tool_auth(permissions=frozenset({PERM_AGENTS_READ})),
            ),
        )
    assert calls == []


def test_aexecute_none_context_is_authorization_error_not_type_error() -> None:
    registry = create_default_registry()
    with pytest.raises(ToolAuthorizationError, match="missing context"):
        asyncio.run(registry.aexecute("add", {"a": 1, "b": 2}, context=None))


def test_forged_forbidden_tool_denied_in_run_agent() -> None:
    """Scripted model requests a tool outside the filtered binding."""
    llm = ScriptedChatModel(
        script=[
            _forbidden_add_call(),
            AIMessage(content="Denied path handled."),
        ]
    )
    result = asyncio.run(
        run_agent(
            "add please",
            tool_auth=default_tool_auth(
                agent_id="reporting",
                allowed_tools=frozenset(REPORTING_TOOL_NAMES),
            ),
            execution_config=default_execution_config(
                agent_id="reporting",
                tool_names=REPORTING_TOOL_NAMES,
            ),
            llm=llm,
        ),
    )
    tool_msg = next(item for item in result.messages if item.role == "tool")
    assert "not authorized" in tool_msg.content
    assert result.reply == "Denied path handled."


def test_forged_forbidden_tool_denied_in_stream_agent() -> None:
    llm = ScriptedChatModel(
        script=[
            _forbidden_add_call(),
            AIMessage(content="Stream denied."),
        ]
    )
    outcome = StreamOutcome()
    events: list[Any] = []

    async def _run() -> None:
        async for event in stream_agent(
            "add please",
            tool_auth=default_tool_auth(
                agent_id="reporting",
                allowed_tools=frozenset(REPORTING_TOOL_NAMES),
            ),
            execution_config=default_execution_config(
                agent_id="reporting",
                tool_names=REPORTING_TOOL_NAMES,
            ),
            llm=llm,
            outcome=outcome,
        ):
            events.append(event)

    asyncio.run(_run())
    ends = [event for event in events if event.type == "tool.end"]
    assert ends
    assert "not authorized" in ends[0].content
    assert outcome.message is not None
    assert outcome.message.content == "Stream denied."


def test_empty_permitted_set_still_denies_forged_calls() -> None:
    llm = ScriptedChatModel(
        script=[
            _forbidden_add_call(),
            AIMessage(content="Empty bind denial."),
        ]
    )
    result = asyncio.run(
        run_agent(
            "hack",
            tool_auth=default_tool_auth(
                agent_id="no-such-agent",
                allowed_tools=frozenset(),
            ),
            execution_config=default_execution_config(
                agent_id="no-such-agent",
                tool_names=(),
            ),
            llm=llm,
        ),
    )
    tool_msg = next(item for item in result.messages if item.role == "tool")
    assert "not authorized" in tool_msg.content


def test_json_session_message_denies_forbidden_tool(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    created = create_session(
        api_client,
        db_session,
        agent_id="reporting",
        tool_names=list(REPORTING_TOOL_NAMES),
    )
    with_saver(api_client)
    _use_model(
        monkeypatch,
        ScriptedChatModel(
            script=[
                _forbidden_add_call(),
                AIMessage(content="JSON denied."),
            ]
        ),
    )
    response = api_client.post(
        f"/sessions/{created['id']}/messages",
        json={"content": "please add"},
        headers=headers(),
    )
    assert response.status_code == 200
    assert response.json()["message"]["content"] == "JSON denied."

    history = api_client.get(
        f"/sessions/{created['id']}/messages",
        headers=headers(),
    ).json()["items"]
    tool_items = [item for item in history if item["role"] == "tool"]
    assert tool_items
    assert "not authorized" in tool_items[0]["content"]


def test_sse_session_message_denies_forbidden_tool(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    created = create_session(
        api_client,
        db_session,
        agent_id="reporting",
        tool_names=list(REPORTING_TOOL_NAMES),
    )
    with_saver(api_client)
    _use_model(
        monkeypatch,
        ScriptedChatModel(
            script=[
                _forbidden_add_call(),
                AIMessage(content="SSE denied."),
            ]
        ),
    )
    with api_client.stream(
        "POST",
        f"/sessions/{created['id']}/messages/stream",
        json={"content": "please add"},
        headers=headers(),
    ) as response:
        assert response.status_code == 200
        body = "".join(response.iter_text())

    events = []
    for block in body.split("\n\n"):
        if not block.strip():
            continue
        for line in block.splitlines():
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))
    ends = [event for event in events if event.get("type") == "tool.end"]
    assert ends
    assert "not authorized" in ends[0]["content"]
    assert events[-1]["type"] == "done"
    assert events[-1]["message"]["content"] == "SSE denied."


def test_agents_run_denies_forbidden_tool(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    from tests.chat_helpers import seed_agent_grant

    seed_agent_grant(
        db_session,
        "test-user",
        agent_id="reporting",
        tool_names=list(REPORTING_TOOL_NAMES),
    )
    monkeypatch.setenv("AGENT_ID", "reporting")
    from app.core.config import get_settings

    get_settings.cache_clear()
    _use_model(
        monkeypatch,
        ScriptedChatModel(
            script=[
                _forbidden_add_call(),
                AIMessage(content="Agents run denied."),
            ]
        ),
    )
    try:
        response = api_client.post(
            "/agents/run",
            json={"message": "please add"},
            headers={"X-User-Id": "test-user"},
        )
    finally:
        monkeypatch.delenv("AGENT_ID", raising=False)
        get_settings.cache_clear()

    assert response.status_code == 200
    body = response.json()
    assert body["reply"] == "Agents run denied."
    tool_msgs = [item for item in body["messages"] if item["role"] == "tool"]
    assert tool_msgs
    assert "not authorized" in tool_msgs[0]["content"]


def test_concurrent_runs_isolate_auth_context() -> None:
    """Overlapping runs with different agents must not cross-contaminate ContextVar."""
    seen: dict[str, str | None] = {}
    gate_a = asyncio.Event()
    gate_b = asyncio.Event()

    class _ProbeModel(ScriptedChatModel):
        async def _astream(self, messages, stop=None, run_manager=None, **kwargs):  # noqa: ANN001
            ctx = get_tool_auth_context()
            key = "a" if self.script and self.script[0].content == "a" else "b"
            seen[key] = None if ctx is None else ctx.agent_id
            if key == "a":
                gate_a.set()
                await gate_b.wait()
            else:
                await gate_a.wait()
                gate_b.set()
            async for chunk in super()._astream(
                messages,
                stop=stop,
                run_manager=run_manager,
                **kwargs,
            ):
                yield chunk

    async def _run() -> None:
        model_a = _ProbeModel(script=[AIMessage(content="a")])
        model_b = _ProbeModel(script=[AIMessage(content="b")])
        await asyncio.gather(
            run_agent(
                "a",
                tool_auth=default_tool_auth(user_id="user-a", agent_id="default"),
                execution_config=default_execution_config(),
                llm=model_a,
            ),
            run_agent(
                "b",
                tool_auth=default_tool_auth(
                    user_id="user-b",
                    agent_id="reporting",
                    allowed_tools=frozenset(REPORTING_TOOL_NAMES),
                ),
                execution_config=default_execution_config(
                    agent_id="reporting",
                    tool_names=REPORTING_TOOL_NAMES,
                ),
                llm=model_b,
            ),
        )

    asyncio.run(_run())
    assert seen["a"] == "default"
    assert seen["b"] == "reporting"
    assert get_tool_auth_context() is None


def test_contextvar_cleared_after_failure() -> None:
    class Boom(ScriptedChatModel):
        def _next_message(self) -> AIMessage:
            raise RuntimeError("boom")

    with pytest.raises(AgentExecutionError):
        asyncio.run(
            run_agent(
                "hi",
                tool_auth=default_tool_auth(),
                execution_config=default_execution_config(),
                llm=Boom(script=[]),
            ),
        )
    assert get_tool_auth_context() is None


def test_contextvar_cleared_after_cancellation() -> None:
    entered = asyncio.Event()

    class Blocking(ScriptedChatModel):
        async def _astream(self, messages, stop=None, run_manager=None, **kwargs):  # noqa: ANN001
            entered.set()
            await asyncio.Event().wait()
            yield  # pragma: no cover

    async def _run() -> None:
        task = asyncio.create_task(
            run_agent(
                "hi",
                tool_auth=default_tool_auth(),
                execution_config=default_execution_config(),
                llm=Blocking(script=[]),
            ),
        )
        await asyncio.wait_for(entered.wait(), timeout=3)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(_run())
    assert get_tool_auth_context() is None


def test_auth_absent_from_checkpoint_payload() -> None:
    saver = InMemorySaver()
    thread_id = "auth-privacy-thread"
    auth = ToolAuthContext(
        user_id="secret-user-id",
        permissions=frozenset({PERM_AGENTS_EXECUTE}),
        agent_id="default",
    )
    asyncio.run(
        run_agent(
            "remember this",
            tool_auth=auth,
            execution_config=default_execution_config(),
            llm=ScriptedChatModel(script=[AIMessage(content="ok")]),
            checkpointer=saver,
            thread_id=thread_id,
        ),
    )
    tuple_ = asyncio.run(saver.aget_tuple({"configurable": {"thread_id": thread_id}}))
    assert tuple_ is not None
    rendered = repr(tuple_.checkpoint) + repr(getattr(tuple_, "metadata", None))
    assert "secret-user-id" not in rendered
    assert PERM_AGENTS_EXECUTE not in rendered
    assert "permissions" not in rendered.lower() or "secret-user-id" not in rendered


def test_auth_absent_from_trace_config(monkeypatch: MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    class _Graph:
        async def ainvoke(
            self,
            state: dict[str, Any],
            config: dict[str, Any] | None = None,
        ) -> dict[str, Any]:
            captured["config"] = config
            return {"messages": [AIMessage(content="done")]}

    monkeypatch.setattr("app.agents.runtime.build_agent_graph", lambda **kwargs: _Graph())
    auth = ToolAuthContext(
        user_id="trace-user",
        permissions=frozenset({PERM_AGENTS_EXECUTE, "custom:secret"}),
        agent_id="default",
    )
    result = asyncio.run(
        run_agent(
            "hi",
            tool_auth=auth,
            execution_config=default_execution_config(),
            llm=ScriptedChatModel(script=[]),
        )
    )
    assert result.reply == "done"
    rendered = json.dumps(captured["config"], default=str)
    assert "trace-user" not in rendered
    assert "custom:secret" not in rendered
    assert "agents:execute" not in rendered
    meta = captured["config"]["metadata"]
    assert set(meta.keys()) == {"execution_id", "agent_id", "environment"}
    configurable = captured["config"].get("configurable")
    if configurable is not None:
        assert "permissions" not in configurable
        assert "user_id" not in configurable


def test_persisted_reporting_tools_are_echo_only() -> None:
    """Reporting fixture assigns echo only (replaces former code allowlist)."""
    assert REPORTING_TOOL_NAMES == ("echo",)
    assert "add" not in REPORTING_TOOL_NAMES
