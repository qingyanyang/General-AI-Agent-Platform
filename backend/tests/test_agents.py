"""Agent graph routing, limits, errors, and API tests (mocked LLM)."""

from __future__ import annotations

import asyncio

import pytest
from app.agents.errors import AgentExecutionError, AgentNotConfiguredError
from app.agents.runtime import AgentMessageView, AgentResult, run_agent
from app.core.config import Settings, get_settings
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage
from pytest import MonkeyPatch

from tests.fakes import ScriptedChatModel


def _settings_without_llm_keys() -> Settings:
    return Settings(
        _env_file=None,
        llm_provider="openai",
        llm_api_key=None,
        deepseek_api_key=None,
    )


def _tool_call_message(*, a: float = 2, b: float = 3) -> AIMessage:
    return AIMessage(
        content="",
        tool_calls=[
            {
                "name": "add",
                "args": {"a": a, "b": b},
                "id": "call_add_1",
                "type": "tool_call",
            }
        ],
    )


def test_agent_routes_to_tools_then_finishes() -> None:
    llm = ScriptedChatModel(
        script=[
            _tool_call_message(a=2, b=3),
            AIMessage(content="The sum is 5."),
        ]
    )

    result = asyncio.run(run_agent("What is 2 + 3?", llm=llm))

    assert result.reply == "The sum is 5."
    roles = [item.role for item in result.messages]
    assert roles[0] == "user"
    assert "tool" in roles
    assert roles[-1] == "assistant"


def test_agent_finishes_without_tools() -> None:
    llm = ScriptedChatModel(script=[AIMessage(content="Hello!")])

    result = asyncio.run(run_agent("Hi", llm=llm))

    assert result.reply == "Hello!"
    assert [item.role for item in result.messages] == ["user", "assistant"]


def test_agent_recursion_limit_raises(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_RECURSION_LIMIT", "2")
    get_settings.cache_clear()

    llm = ScriptedChatModel(
        script=[
            _tool_call_message(),
            _tool_call_message(),
            _tool_call_message(),
            _tool_call_message(),
        ]
    )

    with pytest.raises(AgentExecutionError, match="recursion limit"):
        asyncio.run(run_agent("loop", llm=llm))

    get_settings.cache_clear()


def test_agent_llm_failure_mapped_to_generic_message() -> None:
    class ExplodingModel(ScriptedChatModel):
        def _next_message(self) -> AIMessage:
            raise RuntimeError("secret upstream detail")

    with pytest.raises(AgentExecutionError, match="^Agent execution failed$") as exc_info:
        asyncio.run(run_agent("hi", llm=ExplodingModel(script=[])))

    assert "secret" not in str(exc_info.value)


def test_agent_value_error_is_execution_failure_not_misconfigured() -> None:
    class ValueErrorModel(ScriptedChatModel):
        def _next_message(self) -> AIMessage:
            raise ValueError("invalid model response shape")

    with pytest.raises(AgentExecutionError, match="^Agent execution failed$"):
        asyncio.run(run_agent("hi", llm=ValueErrorModel(script=[])))


def test_agent_requires_api_key_when_no_llm_injected(
    monkeypatch: MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.agents.runtime.get_settings", _settings_without_llm_keys)

    with pytest.raises(AgentNotConfiguredError):
        asyncio.run(run_agent("hi"))


def test_agents_run_api_success(client: TestClient, monkeypatch: MonkeyPatch) -> None:
    async def fake_run(message: str, *, llm=None) -> AgentResult:
        return AgentResult(
            reply="ok",
            execution_id="11111111-1111-4111-8111-111111111111",
            messages=[
                AgentMessageView(role="user", content=message),
                AgentMessageView(role="assistant", content="ok"),
            ],
        )

    monkeypatch.setattr("app.api.routes.agents.run_agent", fake_run)

    response = client.post("/agents/run", json={"message": "hello"})

    assert response.status_code == 200
    body = response.json()
    assert body["reply"] == "ok"
    assert body["execution_id"] == "11111111-1111-4111-8111-111111111111"
    assert body["messages"][0]["role"] == "user"
    assert body["messages"][-1]["content"] == "ok"


def test_agents_run_api_missing_key_returns_503(
    client: TestClient,
    monkeypatch: MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.agents.runtime.get_settings", _settings_without_llm_keys)

    response = client.post("/agents/run", json={"message": "hello"})

    assert response.status_code == 503
    assert "API key" in response.json()["detail"]


def test_agents_run_api_execution_error_returns_502(
    client: TestClient,
    monkeypatch: MonkeyPatch,
) -> None:
    async def fake_run(message: str, *, llm=None) -> AgentResult:
        raise AgentExecutionError("upstream failed")

    monkeypatch.setattr("app.api.routes.agents.run_agent", fake_run)

    response = client.post("/agents/run", json={"message": "hello"})

    assert response.status_code == 502
    assert response.json()["detail"] == "upstream failed"
