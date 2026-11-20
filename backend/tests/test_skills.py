"""Curated agent skills: registry, assignment, load_skill, checkpoint retention (#23)."""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from typing import Any

import pytest
from app.agents.runtime import run_agent
from app.agents.skills import (
    LOAD_SKILL_TOOL_NAME,
    ApprovedResource,
    Skill,
    SkillRegistry,
    SkillRegistryError,
    SkillValidationError,
    compose_system_prompt_with_skills,
    create_default_skill_registry,
)
from app.agents.tool_policy import (
    ToolAuthorizationError,
    reset_tool_auth_context,
    set_tool_auth_context,
)
from app.agents.tools import create_default_registry
from app.agents.tools.load_skill import format_skill_payload
from app.api.deps import get_current_user
from app.api.execution import execution_bundle
from app.core.auth import AuthenticatedUser
from app.core.permissions import (
    PERM_AGENTS_CONFIGURE,
    PERM_AGENTS_EXECUTE,
    PERM_AGENTS_READ,
)
from app.models.agent import Agent
from fastapi import Request
from fastapi.testclient import TestClient
from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGenerationChunk
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import PrivateAttr
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


def _valid_config_body(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "system_prompt": "You are helpful.",
        "llm_provider": "deepseek",
        "llm_model": "deepseek-flash",
        "temperature": 1.0,
        "tool_names": ["echo"],
        "skill_names": [],
    }
    body.update(overrides)
    return body


def _load_skill_script(*, call_id: str = "call_load") -> list[AIMessage]:
    return [
        AIMessage(
            content="",
            tool_calls=[
                {
                    "name": LOAD_SKILL_TOOL_NAME,
                    "args": {"name": "summarize_brief"},
                    "id": call_id,
                    "type": "tool_call",
                }
            ],
        ),
        AIMessage(content="done"),
    ]


class _PromptCaptureModel(ScriptedChatModel):
    """Scripted model that records model-input system text."""

    _captured: list[str] = PrivateAttr(default_factory=list)

    @property
    def captured(self) -> list[str]:
        return self._captured

    def _stream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> Iterator[ChatGenerationChunk]:
        del stop, run_manager, kwargs
        if messages:
            self._captured.append(str(getattr(messages[0], "content", "")))
        yield from super()._stream(messages)


def test_skill_registry_rejects_invalid_definitions() -> None:
    registry = SkillRegistry()
    with pytest.raises(SkillValidationError):
        registry.register(Skill(name="Bad", description="x", instructions="y"))
    with pytest.raises(SkillValidationError):
        registry.register(Skill(name="ok", description=" ", instructions="y"))
    with pytest.raises(SkillValidationError):
        registry.register(
            Skill(
                name="ok",
                description="d",
                instructions="i",
                resources=(ApprovedResource(id="https://evil.example"),),
            ),
        )
    with pytest.raises(SkillValidationError):
        registry.register(
            Skill(
                name="ok",
                description="d",
                instructions="i",
                resources=(ApprovedResource(id="docs/path"),),
            ),
        )
    with pytest.raises(SkillValidationError):
        registry.register(
            Skill(name=LOAD_SKILL_TOOL_NAME, description="d", instructions="i"),
        )


def test_skill_registry_rejects_duplicate_names() -> None:
    registry = SkillRegistry()
    skill = Skill(name="demo", description="d", instructions="do the thing")
    registry.register(skill)
    with pytest.raises(SkillRegistryError):
        registry.register(skill)


def test_seed_skills_are_registered() -> None:
    names = {skill.name for skill in create_default_skill_registry().list()}
    assert "summarize_brief" in names
    assert "meeting_notes" in names


def test_compose_catalog_lists_name_and_description_only() -> None:
    skill = create_default_skill_registry().get("summarize_brief")
    prompt = compose_system_prompt_with_skills("Base.", [skill])
    assert "Base." in prompt
    assert skill.name in prompt
    assert skill.description in prompt
    assert skill.instructions not in prompt
    assert LOAD_SKILL_TOOL_NAME in prompt


def test_list_skills_requires_read_returns_summaries_only(
    api_client: TestClient,
) -> None:
    def no_read(request: Request) -> AuthenticatedUser:
        return AuthenticatedUser(
            user_id=request.headers.get("x-user-id", USER),
            permissions=frozenset({PERM_AGENTS_EXECUTE}),
        )

    api_client.app.dependency_overrides[get_current_user] = no_read
    assert api_client.get("/skills", headers=headers()).status_code == 403

    def reader(request: Request) -> AuthenticatedUser:
        return AuthenticatedUser(
            user_id=request.headers.get("x-user-id", USER),
            permissions=frozenset({PERM_AGENTS_READ}),
        )

    api_client.app.dependency_overrides[get_current_user] = reader
    response = api_client.get("/skills", headers=headers())
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert items
    for item in items:
        assert set(item.keys()) == {"name", "description"}


def test_get_skill_detail_requires_platform_technical(api_client: TestClient) -> None:
    from app.core.permissions import PERM_PLATFORM_TECHNICAL

    def reader(request: Request) -> AuthenticatedUser:
        return AuthenticatedUser(
            user_id=request.headers.get("x-user-id", USER),
            permissions=frozenset({PERM_AGENTS_READ, PERM_AGENTS_EXECUTE, PERM_AGENTS_CONFIGURE}),
        )

    api_client.app.dependency_overrides[get_current_user] = reader
    assert api_client.get("/skills/summarize_brief", headers=headers()).status_code == 403

    def technical(request: Request) -> AuthenticatedUser:
        return AuthenticatedUser(
            user_id=request.headers.get("x-user-id", USER),
            permissions=frozenset({PERM_PLATFORM_TECHNICAL}),
        )

    api_client.app.dependency_overrides[get_current_user] = technical
    response = api_client.get("/skills/summarize_brief", headers=headers())
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["name"] == "summarize_brief"
    assert "executive summary" in body["instructions"].lower()
    assert body["resources"]
    assert api_client.get("/skills/not_a_skill", headers=headers()).status_code == 404


def test_put_configuration_assigns_and_rejects_unknown_skills(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(db_session, USER, "default", can_configure=True)
    ok = api_client.put(
        "/agents/default/configuration",
        json=_valid_config_body(skill_names=["summarize_brief"]),
        headers=headers(),
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["skill_names"] == ["summarize_brief"]

    bad = api_client.put(
        "/agents/default/configuration",
        json=_valid_config_body(skill_names=["ghost_skill"]),
        headers=headers(),
    )
    assert bad.status_code == 422
    assert "unknown skill" in bad.text


def test_put_configuration_rejects_manual_load_skill_assignment(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(db_session, USER, "default", can_configure=True)
    response = api_client.put(
        "/agents/default/configuration",
        json=_valid_config_body(tool_names=["echo", LOAD_SKILL_TOOL_NAME]),
        headers=headers(),
    )
    assert response.status_code == 422
    assert LOAD_SKILL_TOOL_NAME in response.text
    assert "reserved" in response.text


def test_get_put_configuration_includes_skill_names(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(db_session, USER, "default", can_configure=True)
    put = api_client.put(
        "/agents/default/configuration",
        json=_valid_config_body(skill_names=["meeting_notes"]),
        headers=headers(),
    )
    assert put.status_code == 200, put.text
    assert put.json()["skill_names"] == ["meeting_notes"]
    got = api_client.get("/agents/default/configuration", headers=headers())
    assert got.json()["skill_names"] == ["meeting_notes"]
    cleared = api_client.put(
        "/agents/default/configuration",
        json=_valid_config_body(skill_names=[]),
        headers=headers(),
    )
    assert cleared.json()["skill_names"] == []


def test_execution_bundle_adds_load_skill_only_when_skills_assigned(
    db_session: Session,
) -> None:
    agent = seed_agent(db_session, "skills-agent", tool_names=[], skill_names=[])
    _config, auth = execution_bundle(
        db_session,
        agent,
        user_id=USER,
        permissions=frozenset({PERM_AGENTS_EXECUTE}),
    )
    assert LOAD_SKILL_TOOL_NAME not in auth.allowed_tools
    assert auth.allowed_skills == frozenset()

    agent = seed_agent(
        db_session,
        "skills-agent",
        tool_names=[],
        skill_names=["summarize_brief"],
    )
    _config, auth = execution_bundle(
        db_session,
        agent,
        user_id=USER,
        permissions=frozenset({PERM_AGENTS_EXECUTE}),
    )
    assert LOAD_SKILL_TOOL_NAME in auth.allowed_tools
    assert auth.allowed_skills == frozenset({"summarize_brief"})


def test_load_skill_fail_closed_for_unassigned_and_unknown() -> None:
    auth = default_tool_auth(
        allowed_tools=frozenset({LOAD_SKILL_TOOL_NAME}),
        allowed_skills=frozenset({"summarize_brief"}),
    )
    token = set_tool_auth_context(auth)
    try:
        text = format_skill_payload("summarize_brief")
        assert "executive summary" in text.lower()
        assert "brief_template" in text
        with pytest.raises(ToolAuthorizationError):
            format_skill_payload("meeting_notes")
        with pytest.raises(ToolAuthorizationError):
            format_skill_payload("not_a_skill")
    finally:
        reset_tool_auth_context(token)


def test_skills_do_not_grant_extra_tools() -> None:
    registry = create_default_registry()
    auth = default_tool_auth(
        allowed_tools=frozenset({LOAD_SKILL_TOOL_NAME}),
        allowed_skills=frozenset({"summarize_brief"}),
    )
    with pytest.raises(ToolAuthorizationError):
        asyncio.run(registry.aexecute("add", {"a": 1, "b": 2}, context=auth))


def test_fresh_session_hides_instructions_until_load() -> None:
    skill = create_default_skill_registry().get("summarize_brief")
    llm = _PromptCaptureModel(script=_load_skill_script())
    result = asyncio.run(
        run_agent(
            "summarize",
            tool_auth=default_tool_auth(
                allowed_tools=frozenset({LOAD_SKILL_TOOL_NAME}),
                allowed_skills=frozenset({"summarize_brief"}),
            ),
            execution_config=default_execution_config(
                tool_names=(),
                skill_names=("summarize_brief",),
            ),
            llm=llm,
        )
    )
    assert llm.captured
    first_prompt = llm.captured[0]
    assert skill.name in first_prompt
    assert skill.description in first_prompt
    assert skill.instructions not in first_prompt
    tool_msg = next(item for item in result.messages if item.role == "tool")
    assert "executive summary" in tool_msg.content.lower()


def test_missing_saved_skill_returns_503_before_sse(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(
        db_session,
        USER,
        "ghost-skill",
        can_configure=True,
        can_execute=True,
        tool_names=[],
    )
    session = create_session(
        api_client,
        db_session,
        agent_id="ghost-skill",
        tool_names=[],
    )
    seed_agent(db_session, "ghost-skill", tool_names=[], skill_names=["missing_skill"])
    with_saver(api_client)

    json_resp = api_client.post(
        f"/sessions/{session['id']}/messages",
        json={"content": "hi"},
        headers=headers(),
    )
    assert json_resp.status_code == 503
    assert "skill" in json_resp.json()["detail"]

    stream = api_client.post(
        f"/sessions/{session['id']}/messages/stream",
        json={"content": "hi"},
        headers=headers(),
    )
    assert stream.status_code == 503
    assert stream.headers.get("content-type", "").startswith("application/json")
    assert "skill" in stream.json()["detail"]
    row = db_session.get(Agent, "ghost-skill")
    assert row is not None
    assert row.skill_names == ["missing_skill"]


def test_http_unassign_retains_session_text_blocks_reload_and_new_session_is_clean(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scripts = iter(
        [
            _load_skill_script(call_id="call_load"),
            _load_skill_script(call_id="call_reload"),
            [AIMessage(content="fresh reply")],
        ]
    )
    monkeypatch.setattr(
        "app.agents.runtime.create_chat_model_for_agent",
        lambda **_kwargs: ScriptedChatModel(script=next(scripts)),
    )
    first_session = create_session(api_client, db_session, can_configure=True, tool_names=[])
    with_saver(api_client)

    def put_skills(skill_names: list[str]) -> None:
        response = api_client.put(
            "/agents/default/configuration",
            json=_valid_config_body(tool_names=[], skill_names=skill_names),
            headers=headers(),
        )
        assert response.status_code == 200, response.text

    def send(session_id: str, content: str) -> None:
        response = api_client.post(
            f"/sessions/{session_id}/messages",
            json={"content": content},
            headers=headers(),
        )
        assert response.status_code == 200, response.text

    def tool_contents(session_id: str) -> list[str]:
        response = api_client.get(f"/sessions/{session_id}/messages", headers=headers())
        assert response.status_code == 200, response.text
        return [item["content"] for item in response.json()["items"] if item["role"] == "tool"]

    put_skills(["summarize_brief"])
    send(first_session["id"], "load it")
    loaded = tool_contents(first_session["id"])
    assert any("executive summary" in content.lower() for content in loaded)

    put_skills([])
    send(first_session["id"], "load it again")
    after_unassign = tool_contents(first_session["id"])
    assert any("executive summary" in content.lower() for content in after_unassign)
    assert after_unassign[-1] == f"Error: tool '{LOAD_SKILL_TOOL_NAME}' is not authorized"

    second_session = create_session(api_client, db_session, can_configure=True, tool_names=[])
    send(second_session["id"], "hello")
    assert tool_contents(second_session["id"]) == []


def test_unassign_retains_checkpoint_text_but_blocks_reload_and_new_session_is_clean() -> None:
    skill = create_default_skill_registry().get("summarize_brief")
    saver = InMemorySaver()
    thread_id = "skill-thread-1"

    first = asyncio.run(
        run_agent(
            "load it",
            tool_auth=default_tool_auth(
                allowed_tools=frozenset({LOAD_SKILL_TOOL_NAME}),
                allowed_skills=frozenset({"summarize_brief"}),
            ),
            execution_config=default_execution_config(
                tool_names=(),
                skill_names=("summarize_brief",),
            ),
            llm=ScriptedChatModel(script=_load_skill_script(call_id="call_load")),
            checkpointer=saver,
            thread_id=thread_id,
        )
    )
    loaded = next(item for item in first.messages if item.role == "tool")
    assert "executive summary" in loaded.content.lower()

    second = asyncio.run(
        run_agent(
            "again",
            tool_auth=default_tool_auth(
                allowed_tools=frozenset(),
                allowed_skills=frozenset(),
            ),
            execution_config=default_execution_config(
                tool_names=(),
                skill_names=(),
            ),
            llm=ScriptedChatModel(script=_load_skill_script(call_id="call_reload")),
            checkpointer=saver,
            thread_id=thread_id,
        )
    )
    assert any(
        item.role == "tool" and "executive summary" in item.content.lower()
        for item in second.messages
    )
    denied = [
        item
        for item in second.messages
        if item.role == "tool" and "executive summary" not in item.content.lower()
    ]
    assert denied
    assert any(
        "not authorized" in item.content.lower()
        or "not registered" in item.content.lower()
        or "cannot be executed" in item.content.lower()
        for item in denied
    )

    third = asyncio.run(
        run_agent(
            "hello",
            tool_auth=default_tool_auth(
                allowed_tools=frozenset(),
                allowed_skills=frozenset(),
            ),
            execution_config=default_execution_config(
                tool_names=(),
                skill_names=(),
            ),
            llm=ScriptedChatModel(script=[AIMessage(content="fresh reply")]),
            checkpointer=saver,
            thread_id="skill-thread-2",
        )
    )
    assert third.reply == "fresh reply"
    assert not any(
        item.role == "tool" and "executive summary" in item.content.lower()
        for item in third.messages
    )
    joined = " ".join(item.content for item in third.messages)
    assert skill.instructions not in joined
