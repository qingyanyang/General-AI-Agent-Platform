"""Agent configuration API, snapshot immutability, and preflight gates (#20)."""

from __future__ import annotations

import asyncio

import pytest
from app.agents.tool_policy import BUILTIN_TOOL_NAMES
from app.api.deps import get_current_user
from app.core.auth import AuthenticatedUser
from app.core.config import ApprovedLlmCatalogError, Settings, get_settings
from app.core.permissions import (
    PERM_AGENTS_CONFIGURE,
    PERM_AGENTS_EXECUTE,
    PERM_AGENTS_READ,
)
from app.models.agent import Agent
from app.schemas.agent_config import SYSTEM_PROMPT_MAX_LENGTH
from app.services import agents as agent_service
from app.services.agents import AgentExecutionConfig
from fastapi import Request
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langgraph.checkpoint.memory import InMemorySaver
from pytest import MonkeyPatch
from sqlalchemy.orm import Session

from tests.chat_helpers import (
    USER,
    create_session,
    default_execution_config,
    default_tool_auth,
    headers,
    seed_agent,
    seed_agent_grant,
    with_saver,
)
from tests.fakes import ScriptedChatModel


def _configure_headers(user_id: str = USER) -> dict[str, str]:
    return headers(user_id)


def _valid_config_body(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "system_prompt": "You are helpful.",
        "llm_provider": "deepseek",
        "llm_model": "deepseek-flash",
        "temperature": 1.0,
        "tool_names": ["echo"],
    }
    body.update(overrides)
    return body


def test_get_put_configuration_round_trip(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(db_session, USER, "default", can_configure=True)
    put = api_client.put(
        "/agents/default/configuration",
        json=_valid_config_body(system_prompt="Be concise."),
        headers=_configure_headers(),
    )
    assert put.status_code == 200, put.text
    body = put.json()
    assert body["system_prompt"] == "Be concise."
    assert body["llm_provider"] == "deepseek"
    assert body["llm_model"] == "deepseek-flash"
    assert body["temperature"] == 1.0
    assert body["tool_names"] == ["echo"]
    assert body["skill_names"] == []

    got = api_client.get(
        "/agents/default/configuration",
        headers=_configure_headers(),
    )
    assert got.status_code == 200
    assert got.json() == body


def test_get_configuration_requires_configure_permission(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(db_session, USER, "default", can_configure=True)

    def read_only(request: Request) -> AuthenticatedUser:
        return AuthenticatedUser(
            user_id=request.headers.get("x-user-id", USER),
            permissions=frozenset({PERM_AGENTS_READ, PERM_AGENTS_EXECUTE}),
        )

    api_client.app.dependency_overrides[get_current_user] = read_only
    response = api_client.get(
        "/agents/default/configuration",
        headers=_configure_headers(),
    )
    assert response.status_code == 403


def test_get_configuration_requires_can_configure_grant(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(
        db_session,
        USER,
        "default",
        can_view=True,
        can_configure=False,
        can_execute=True,
    )
    response = api_client.get(
        "/agents/default/configuration",
        headers=_configure_headers(),
    )
    assert response.status_code == 403


def test_put_rejects_unapproved_llm(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(db_session, USER, "default", can_configure=True)
    response = api_client.put(
        "/agents/default/configuration",
        json=_valid_config_body(llm_provider="openai", llm_model="gpt-nope"),
        headers=_configure_headers(),
    )
    assert response.status_code == 422
    assert "APPROVED_LLM_MODELS" in response.json()["detail"]


def test_put_rejects_unknown_tool(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(db_session, USER, "default", can_configure=True)
    response = api_client.put(
        "/agents/default/configuration",
        json=_valid_config_body(tool_names=["not_a_tool"]),
        headers=_configure_headers(),
    )
    assert response.status_code == 422
    assert "unknown tool" in response.json()["detail"]


def test_put_system_prompt_exact_20k_ok_over_rejected(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(db_session, USER, "default", can_configure=True)
    exact = "x" * SYSTEM_PROMPT_MAX_LENGTH
    ok = api_client.put(
        "/agents/default/configuration",
        json=_valid_config_body(system_prompt=exact),
        headers=_configure_headers(),
    )
    assert ok.status_code == 200, ok.text
    assert len(ok.json()["system_prompt"]) == SYSTEM_PROMPT_MAX_LENGTH

    too_long = exact + "y"
    bad = api_client.put(
        "/agents/default/configuration",
        json=_valid_config_body(system_prompt=too_long),
        headers=_configure_headers(),
    )
    assert bad.status_code == 422


def test_put_preserves_prompt_whitespace(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(db_session, USER, "default", can_configure=True)
    prompt = "  leading and trailing  \n"
    response = api_client.put(
        "/agents/default/configuration",
        json=_valid_config_body(system_prompt=prompt),
        headers=_configure_headers(),
    )
    assert response.status_code == 200
    assert response.json()["system_prompt"] == prompt


def test_put_add_tool_requires_tool_permissions(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent(db_session, "tools", tool_names=[])
    seed_agent_grant(
        db_session,
        USER,
        "tools",
        can_view=True,
        can_configure=True,
        can_execute=True,
        tool_names=[],
    )

    def configure_without_execute(request: Request) -> AuthenticatedUser:
        return AuthenticatedUser(
            user_id=request.headers.get("x-user-id", USER),
            permissions=frozenset({PERM_AGENTS_CONFIGURE, PERM_AGENTS_READ}),
        )

    api_client.app.dependency_overrides[get_current_user] = configure_without_execute
    response = api_client.put(
        "/agents/tools/configuration",
        json=_valid_config_body(tool_names=["add"]),
        headers=_configure_headers(),
    )
    assert response.status_code == 403
    assert "not authorized to assign tool" in response.json()["detail"]


def test_put_remove_tool_does_not_require_tool_permissions(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent(db_session, "tools", tool_names=["add", "echo"])
    seed_agent_grant(
        db_session,
        USER,
        "tools",
        can_configure=True,
        tool_names=["add", "echo"],
    )

    def configure_without_execute(request: Request) -> AuthenticatedUser:
        return AuthenticatedUser(
            user_id=request.headers.get("x-user-id", USER),
            permissions=frozenset({PERM_AGENTS_CONFIGURE, PERM_AGENTS_READ}),
        )

    api_client.app.dependency_overrides[get_current_user] = configure_without_execute
    response = api_client.put(
        "/agents/tools/configuration",
        json=_valid_config_body(tool_names=["echo"]),
        headers=_configure_headers(),
    )
    assert response.status_code == 200, response.text
    assert response.json()["tool_names"] == ["echo"]


def test_create_agent_defaults_empty_tools(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(db_session, USER, "default", can_configure=True)
    created = api_client.post(
        "/agents",
        json={"id": "fresh", "name": "Fresh"},
        headers=_configure_headers(),
    )
    assert created.status_code == 201
    agent = db_session.get(Agent, "fresh")
    assert agent is not None
    assert agent.tool_names == []
    assert agent.system_prompt == ""


def test_stale_unregistered_tool_fails_execution_preflight(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent(db_session, "stale", tool_names=["ghost_tool"])
    seed_agent_grant(
        db_session,
        USER,
        "stale",
        can_execute=True,
        tool_names=["ghost_tool"],
    )
    with_saver(api_client)
    created = api_client.post(
        "/sessions",
        json={"agent_id": "stale"},
        headers=headers(),
    )
    assert created.status_code == 201
    response = api_client.post(
        f"/sessions/{created.json()['id']}/messages",
        json={"content": "hi"},
        headers=headers(),
    )
    assert response.status_code == 503
    assert "not registered" in response.json()["detail"]


def test_execution_uses_immutable_snapshot_not_live_row(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    seed_agent_grant(db_session, USER, "default", can_configure=True, can_execute=True)
    with_saver(api_client)
    put = api_client.put(
        "/agents/default/configuration",
        json=_valid_config_body(system_prompt="SNAPSHOT_PROMPT"),
        headers=_configure_headers(),
    )
    assert put.status_code == 200

    seen_prompts: list[str] = []

    class _Capture(ScriptedChatModel):
        async def _astream(self, messages, stop=None, run_manager=None, **kwargs):  # noqa: ANN001
            for msg in messages:
                if isinstance(msg, SystemMessage):
                    seen_prompts.append(str(msg.content))
            async for chunk in super()._astream(
                messages,
                stop=stop,
                run_manager=run_manager,
                **kwargs,
            ):
                yield chunk

    monkeypatch.setattr(
        "app.agents.runtime.create_chat_model_for_agent",
        lambda **_kwargs: _Capture(script=[AIMessage(content="ok")]),
    )

    original_validate = agent_service.validate_execution_config

    def validate_then_mutate(config: AgentExecutionConfig) -> None:
        original_validate(config)
        agent = db_session.get(Agent, "default")
        assert agent is not None
        agent.system_prompt = "MUTATED_AFTER_SNAPSHOT"
        db_session.commit()

    monkeypatch.setattr(
        "app.api.routes.sessions.agent_service.validate_execution_config",
        validate_then_mutate,
    )

    created = create_session(api_client, db_session)
    response = api_client.post(
        f"/sessions/{created['id']}/messages",
        json={"content": "hi"},
        headers=headers(),
    )
    assert response.status_code == 200, response.text
    assert seen_prompts == ["SNAPSHOT_PROMPT"]
    agent = db_session.get(Agent, "default")
    assert agent is not None
    assert agent.system_prompt == "MUTATED_AFTER_SNAPSHOT"


def test_system_prompt_is_ephemeral_not_checkpointed() -> None:
    from app.agents.runtime import run_agent

    saver = InMemorySaver()
    thread_id = "prompt-ephemeral"
    llm = ScriptedChatModel(script=[AIMessage(content="ack")])
    asyncio.run(
        run_agent(
            "hello",
            tool_auth=default_tool_auth(),
            execution_config=default_execution_config(system_prompt="SECRET_PROMPT"),
            llm=llm,
            checkpointer=saver,
            thread_id=thread_id,
        ),
    )
    tuple_ = asyncio.run(saver.aget_tuple({"configurable": {"thread_id": thread_id}}))
    assert tuple_ is not None
    rendered = repr(tuple_.checkpoint)
    assert "SECRET_PROMPT" not in rendered
    messages = tuple_.checkpoint["channel_values"]["messages"]
    assert all(not isinstance(msg, SystemMessage) for msg in messages)
    assert any(isinstance(msg, HumanMessage) for msg in messages)


def test_sse_preflight_503_before_stream_headers(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    created = create_session(api_client, db_session)
    with_saver(api_client)
    monkeypatch.setenv("LLM_API_KEY", "")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "")
    get_settings.cache_clear()

    def no_keys() -> Settings:
        return Settings(
            _env_file=None,
            llm_provider="deepseek",
            llm_api_key=None,
            deepseek_api_key=None,
        )

    monkeypatch.setattr("app.services.agents.get_settings", no_keys)

    response = api_client.post(
        f"/sessions/{created['id']}/messages/stream",
        json={"content": "hi"},
        headers=headers(),
    )
    assert response.status_code == 503
    assert response.headers.get("content-type", "").startswith("application/json")
    assert "API key" in response.json()["detail"]


def test_default_approved_llm_fails_without_fallback(
    monkeypatch: MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("LLM_MODEL", "not-in-catalog")
    get_settings.cache_clear()
    settings = Settings(_env_file=None)
    with pytest.raises(ApprovedLlmCatalogError, match="not in APPROVED_LLM_MODELS"):
        settings.default_approved_llm()
    get_settings.cache_clear()


def test_run_agent_requires_execution_config() -> None:
    from app.agents.runtime import run_agent

    with pytest.raises(TypeError):
        asyncio.run(run_agent("hi", tool_auth=default_tool_auth()))  # type: ignore[call-arg]


def test_empty_tools_does_not_mean_all_tools(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    seed_agent_grant(
        db_session,
        USER,
        "empty-tools",
        can_execute=True,
        tool_names=[],
    )
    with_saver(api_client)
    monkeypatch.setattr(
        "app.agents.runtime.create_chat_model_for_agent",
        lambda **_kwargs: ScriptedChatModel(
            script=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "add",
                            "args": {"a": 1, "b": 2},
                            "id": "call_1",
                            "type": "tool_call",
                        }
                    ],
                ),
                AIMessage(content="denied"),
            ]
        ),
    )
    created = create_session(
        api_client,
        db_session,
        agent_id="empty-tools",
        tool_names=[],
    )
    response = api_client.post(
        f"/sessions/{created['id']}/messages",
        json={"content": "add"},
        headers=headers(),
    )
    assert response.status_code == 200
    history = api_client.get(
        f"/sessions/{created['id']}/messages",
        headers=headers(),
    ).json()["items"]
    tool_items = [item for item in history if item["role"] == "tool"]
    assert tool_items
    assert "not authorized" in tool_items[0]["content"]
    assert set(BUILTIN_TOOL_NAMES) != set()


def test_configuration_not_on_agent_out(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(db_session, USER, "default", can_view=True, can_configure=True)
    api_client.put(
        "/agents/default/configuration",
        json=_valid_config_body(system_prompt="hidden-from-list"),
        headers=_configure_headers(),
    )
    listed = api_client.get("/agents", headers=_configure_headers())
    assert listed.status_code == 200
    item = next(i for i in listed.json()["items"] if i["id"] == "default")
    assert "system_prompt" not in item
    assert "tool_names" not in item
