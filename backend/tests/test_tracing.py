"""LangSmith tracing stays optional and keeps secrets out of trace metadata."""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import pytest
from app.agents.errors import AgentExecutionError
from app.agents.runtime import run_agent
from app.agents.tracing import tracing_project_name
from app.core.config import Settings
from langchain_core.messages import AIMessage, HumanMessage
from pytest import LogCaptureFixture, MonkeyPatch

from tests.chat_helpers import default_execution_config, default_tool_auth
from tests.fakes import ScriptedChatModel


def _settings(
    *,
    environment: str = "development",
    agent_id: str = "default",
    langsmith_tracing: bool = False,
    langsmith_api_key: str | None = None,
    langsmith_project: str | None = None,
    llm_api_key: str | None = None,
) -> Settings:
    return Settings(
        _env_file=None,
        environment=environment,
        agent_id=agent_id,
        langsmith_tracing=langsmith_tracing,
        langsmith_api_key=langsmith_api_key,
        langsmith_project=langsmith_project,
        llm_api_key=llm_api_key,
        database_url="postgresql://user:s3cret-db@localhost/app",
    )


def test_tracing_project_name_follows_environment() -> None:
    development = _settings(environment="development")
    production = _settings(environment="production")
    override = _settings(environment="production", langsmith_project="shared-name")

    assert tracing_project_name(development) == "agent-platform-development"
    assert tracing_project_name(production) == "agent-platform-production"
    assert tracing_project_name(override) == "shared-name"


def test_run_records_execution_id_without_secrets_in_metadata(
    monkeypatch: MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}
    settings = _settings(
        environment="production",
        agent_id="estimator",
        langsmith_tracing=True,
        langsmith_api_key="ls-secret-key",
        langsmith_project="billing-prod",
        llm_api_key="sk-live-secret",
    )

    class _Graph:
        async def ainvoke(
            self,
            state: dict[str, Any],
            config: dict[str, Any] | None = None,
        ) -> dict[str, Any]:
            captured["config"] = config
            captured["tracing"] = os.environ.get("LANGSMITH_TRACING_V2")
            captured["project"] = os.environ.get("LANGSMITH_PROJECT")
            return {
                "messages": [
                    HumanMessage(content="hi"),
                    AIMessage(content="done"),
                ]
            }

    def _forbid_real_chat_model(**_kwargs: object) -> object:
        raise AssertionError(
            "create_chat_model_for_agent must not run; pass llm= in this unit test",
        )

    monkeypatch.setattr("app.agents.runtime.get_settings", lambda: settings)
    monkeypatch.setattr("app.agents.runtime.build_agent_graph", lambda **kwargs: _Graph())
    monkeypatch.setattr(
        "app.agents.runtime.create_chat_model_for_agent",
        _forbid_real_chat_model,
    )
    monkeypatch.setenv("LANGSMITH_PROJECT", "ambient-project")

    # Inject llm so run_agent never builds a real ChatOpenAI (no ambient API keys).
    result = asyncio.run(
        run_agent(
            "account number 999 and ls-secret-key",
            tool_auth=default_tool_auth(),
            execution_config=default_execution_config(),
            llm=ScriptedChatModel(script=[]),
        )
    )

    config = captured["config"]
    assert result.reply == "done"
    assert str(config["run_id"]) == result.execution_id
    assert config["metadata"] == {
        "execution_id": result.execution_id,
        "agent_id": "estimator",
        "environment": "production",
    }
    rendered = str(config)
    assert "ls-secret-key" not in rendered
    assert "sk-live-secret" not in rendered
    assert "s3cret-db" not in rendered
    assert "account number" not in rendered
    assert captured["tracing"] == "true"
    assert captured["project"] == "billing-prod"
    assert os.environ["LANGSMITH_PROJECT"] == "ambient-project"


def test_agent_runs_when_tracing_disabled(monkeypatch: MonkeyPatch) -> None:
    settings = _settings(langsmith_tracing=False, langsmith_api_key=None)
    monkeypatch.setattr("app.agents.runtime.get_settings", lambda: settings)
    llm = ScriptedChatModel(script=[AIMessage(content="Hello!")])

    result = asyncio.run(
        run_agent(
            "Hi",
            tool_auth=default_tool_auth(),
            execution_config=default_execution_config(),
            llm=llm,
        )
    )

    assert result.reply == "Hello!"
    assert result.execution_id


def test_agent_runs_when_tracing_requested_without_api_key(
    monkeypatch: MonkeyPatch,
    caplog: LogCaptureFixture,
) -> None:
    settings = _settings(langsmith_tracing=True, langsmith_api_key="  ")
    seen: dict[str, str | None] = {}

    class _Graph:
        async def ainvoke(
            self,
            state: dict[str, Any],
            config: dict[str, Any] | None = None,
        ) -> dict[str, Any]:
            seen["tracing"] = os.environ.get("LANGSMITH_TRACING_V2")
            return {"messages": [AIMessage(content="still works")]}

    monkeypatch.setattr("app.agents.runtime.get_settings", lambda: settings)
    monkeypatch.setattr("app.agents.runtime.build_agent_graph", lambda **kwargs: _Graph())
    llm = ScriptedChatModel(script=[AIMessage(content="unused")])

    with caplog.at_level(logging.WARNING):
        result = asyncio.run(
            run_agent(
                "Hi",
                tool_auth=default_tool_auth(),
                execution_config=default_execution_config(),
                llm=llm,
            )
        )

    assert result.reply == "still works"
    assert seen["tracing"] == "false"
    assert "LANGSMITH_API_KEY" in caplog.text


def test_failed_invoke_returns_the_same_execution_id(monkeypatch: MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    class _Graph:
        async def ainvoke(
            self,
            state: dict[str, Any],
            config: dict[str, Any] | None = None,
        ) -> dict[str, Any]:
            assert config is not None
            captured["run_id"] = config["run_id"]
            raise RuntimeError("boom")

    monkeypatch.setattr("app.agents.runtime.get_settings", lambda: _settings())
    monkeypatch.setattr("app.agents.runtime.build_agent_graph", lambda **kwargs: _Graph())

    with pytest.raises(AgentExecutionError, match="^Agent execution failed$") as exc_info:
        asyncio.run(
            run_agent(
                "Hi",
                tool_auth=default_tool_auth(),
                execution_config=default_execution_config(),
                llm=ScriptedChatModel(script=[]),
            )
        )

    assert exc_info.value.execution_id == str(captured["run_id"])
    assert "boom" not in str(exc_info.value)


def test_agent_runs_when_langsmith_client_raises(monkeypatch: MonkeyPatch) -> None:
    settings = _settings(
        langsmith_tracing=True,
        langsmith_api_key="ls-secret-key",
        langsmith_project="agent-platform-development",
    )

    def _unavailable(self: object, *args: object, **kwargs: object) -> None:
        raise RuntimeError("langsmith unavailable")

    monkeypatch.setattr("app.agents.runtime.get_settings", lambda: settings)
    # Client construction is lazy in some SDK paths; patch both module locations.
    monkeypatch.setattr("langsmith.client.Client.__init__", _unavailable)
    monkeypatch.setattr("langsmith.Client.__init__", _unavailable)
    llm = ScriptedChatModel(script=[AIMessage(content="Hello!")])

    result = asyncio.run(
        run_agent(
            "Hi",
            tool_auth=default_tool_auth(),
            execution_config=default_execution_config(),
            llm=llm,
        )
    )

    # Run must succeed even if LangSmith client construction fails when attempted.
    assert result.reply == "Hello!"
