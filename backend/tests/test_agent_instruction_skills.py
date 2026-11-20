"""Published Instruction Skills API, auth, validation, and snapshot (Issue 5)."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from datetime import UTC, datetime

import pytest
from app.agents.instructions import PublishedInstructionSkill
from app.agents.runtime import _system_prompt_for_run, run_agent
from app.agents.skills import compose_system_prompt_with_instructions
from app.api.deps import get_current_user
from app.api.execution import execution_bundle
from app.core.auth import AuthenticatedUser
from app.core.permissions import (
    PERM_AGENT_ACCESS_MANAGE,
    PERM_AGENTS_CONFIGURE,
    PERM_AGENTS_EXECUTE,
    PERM_AGENTS_READ,
    PERM_PLATFORM_TECHNICAL,
)
from app.models.agent import Agent
from app.models.agent_instruction_skill import AgentInstructionSkill
from app.models.directory_user import DirectoryUser
from app.models.group import GroupDesignation
from app.schemas.agent_instruction_skills import (
    AGGREGATE_MAX_LENGTH,
    InstructionSkillItemIn,
)
from app.services import agent_instruction_skills as instruction_service
from fastapi import Request
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langgraph.checkpoint.memory import InMemorySaver
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from tests.auth_helpers import stub_get_current_user
from tests.chat_helpers import (
    default_execution_config,
    default_tool_auth,
    headers,
    seed_agent,
    seed_agent_grant,
)
from tests.fakes import ScriptedChatModel

ADMIN = "auth0|admin"
LEADER = "auth0|leader"
MEMBER = "auth0|member"
OTHER_LEADER = "auth0|other-leader"
TECHNICAL = "auth0|technical"
CONFIGURE_ONLY = "auth0|configure"
AGENT_ID = "instruction-agent"


def _as_user(user_id: str, *permissions: str) -> Callable[[Request], AuthenticatedUser]:
    perms = frozenset(permissions)

    def _current(request: Request) -> AuthenticatedUser:
        return AuthenticatedUser(
            user_id=request.headers.get("x-user-id", user_id),
            permissions=perms,
        )

    return _current


def _seed_directory(db: Session, *user_ids: str) -> None:
    now = datetime.now(UTC)
    for user_id in user_ids:
        if db.get(DirectoryUser, user_id) is None:
            db.add(
                DirectoryUser(
                    user_id=user_id,
                    first_seen_at=now,
                    last_seen_at=now,
                ),
            )
    db.commit()


def _create_group(api_client: TestClient, name: str) -> str:
    response = api_client.post(
        "/groups",
        json={"name": name, "description": None},
        headers=headers(ADMIN),
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _put_membership(
    api_client: TestClient,
    group_id: str,
    user_id: str,
    designation: str,
) -> None:
    response = api_client.put(
        f"/groups/{group_id}/memberships",
        json={"user_id": user_id, "designation": designation},
        headers=headers(ADMIN),
    )
    assert response.status_code == 200, response.text


def _put_access_config(
    api_client: TestClient,
    *,
    agent_id: str,
    owning_group_id: str | None,
    group_ids: list[str],
) -> None:
    response = api_client.put(
        f"/agents/{agent_id}/access-config",
        json={
            "audience_mode": "groups",
            "owning_group_id": owning_group_id,
            "group_ids": group_ids,
        },
        headers=headers(ADMIN),
    )
    assert response.status_code == 200, response.text


def _put_instructions(
    api_client: TestClient,
    *,
    agent_id: str,
    items: list[dict],
    user_id: str = ADMIN,
) -> object:
    return api_client.put(
        f"/agents/{agent_id}/instruction-skills",
        json={"items": items},
        headers=headers(user_id),
    )


def _sample_items() -> list[dict]:
    return [
        {
            "name": "Tone",
            "description": "Voice guidance",
            "instructions": "Be concise.\nKeep  trailing  spaces  ",
        },
        {
            "name": "Escalation",
            "description": "",
            "instructions": "Escalate billing disputes.",
        },
    ]


def test_unauthenticated_instruction_skills_are_401(
    api_client: TestClient,
    db_session: Session,
    monkeypatch,
) -> None:
    from app.core.config import get_settings

    seed_agent(db_session, AGENT_ID)
    api_client.app.dependency_overrides.pop(get_current_user, None)
    monkeypatch.setenv("AUTH0_DOMAIN", "auth.test.example")
    monkeypatch.setenv("AUTH0_AUDIENCE", "https://api.agent-platform")
    get_settings.cache_clear()
    assert api_client.get(f"/agents/{AGENT_ID}/instruction-skills").status_code == 401
    assert (
        api_client.put(
            f"/agents/{AGENT_ID}/instruction-skills",
            json={"items": []},
        ).status_code
        == 401
    )


def test_admin_can_read_and_replace(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent(db_session, AGENT_ID)
    empty = api_client.get(
        f"/agents/{AGENT_ID}/instruction-skills",
        headers=headers(ADMIN),
    )
    assert empty.status_code == 200
    assert empty.json() == {"items": []}

    put = _put_instructions(api_client, agent_id=AGENT_ID, items=_sample_items())
    assert put.status_code == 200, put.text
    body = put.json()["items"]
    assert [item["name"] for item in body] == ["Tone", "Escalation"]
    assert body[0]["instructions"] == "Be concise.\nKeep  trailing  spaces  "
    assert body[1]["description"] == ""

    got = api_client.get(
        f"/agents/{AGENT_ID}/instruction-skills",
        headers=headers(ADMIN),
    )
    assert got.status_code == 200
    assert [item["name"] for item in got.json()["items"]] == ["Tone", "Escalation"]


def test_owning_group_leader_can_read_and_replace(
    api_client: TestClient,
    db_session: Session,
) -> None:
    _seed_directory(db_session, ADMIN, LEADER)
    seed_agent(db_session, AGENT_ID)
    group_id = _create_group(api_client, "Owners")
    _put_membership(api_client, group_id, LEADER, GroupDesignation.LEADER.value)
    _put_access_config(
        api_client,
        agent_id=AGENT_ID,
        owning_group_id=group_id,
        group_ids=[group_id],
    )

    api_client.app.dependency_overrides[get_current_user] = _as_user(
        LEADER,
        PERM_AGENTS_READ,
        PERM_AGENTS_EXECUTE,
    )
    try:
        put = _put_instructions(
            api_client,
            agent_id=AGENT_ID,
            items=_sample_items(),
            user_id=LEADER,
        )
        assert put.status_code == 200, put.text
        got = api_client.get(
            f"/agents/{AGENT_ID}/instruction-skills",
            headers=headers(LEADER),
        )
        assert got.status_code == 200
        assert len(got.json()["items"]) == 2
    finally:
        api_client.app.dependency_overrides[get_current_user] = stub_get_current_user


def test_member_unrelated_and_audience_only_leader_denied(
    api_client: TestClient,
    db_session: Session,
) -> None:
    _seed_directory(db_session, ADMIN, LEADER, MEMBER, OTHER_LEADER)
    seed_agent(db_session, AGENT_ID)
    owning = _create_group(api_client, "Owning")
    audience = _create_group(api_client, "AudienceOnly")
    _put_membership(api_client, owning, LEADER, GroupDesignation.LEADER.value)
    _put_membership(api_client, owning, MEMBER, GroupDesignation.MEMBER.value)
    _put_membership(api_client, audience, OTHER_LEADER, GroupDesignation.LEADER.value)
    _put_access_config(
        api_client,
        agent_id=AGENT_ID,
        owning_group_id=owning,
        group_ids=[owning, audience],
    )

    for user_id in (MEMBER, OTHER_LEADER):
        api_client.app.dependency_overrides[get_current_user] = _as_user(
            user_id,
            PERM_AGENTS_READ,
            PERM_AGENTS_EXECUTE,
        )
        try:
            assert (
                api_client.get(
                    f"/agents/{AGENT_ID}/instruction-skills",
                    headers=headers(user_id),
                ).status_code
                == 403
            )
            assert (
                _put_instructions(
                    api_client,
                    agent_id=AGENT_ID,
                    items=_sample_items(),
                    user_id=user_id,
                ).status_code
                == 403
            )
        finally:
            api_client.app.dependency_overrides[get_current_user] = stub_get_current_user


def test_null_owning_group_denies_leader(
    api_client: TestClient,
    db_session: Session,
) -> None:
    _seed_directory(db_session, ADMIN, LEADER)
    seed_agent(db_session, AGENT_ID)
    group_id = _create_group(api_client, "LedButNotOwning")
    _put_membership(api_client, group_id, LEADER, GroupDesignation.LEADER.value)
    _put_access_config(
        api_client,
        agent_id=AGENT_ID,
        owning_group_id=None,
        group_ids=[group_id],
    )

    api_client.app.dependency_overrides[get_current_user] = _as_user(
        LEADER,
        PERM_AGENTS_READ,
        PERM_AGENTS_EXECUTE,
    )
    try:
        assert (
            api_client.get(
                f"/agents/{AGENT_ID}/instruction-skills",
                headers=headers(LEADER),
            ).status_code
            == 403
        )
    finally:
        api_client.app.dependency_overrides[get_current_user] = stub_get_current_user


def test_configure_alone_and_technical_alone_denied(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent(db_session, AGENT_ID)
    seed_agent_grant(
        db_session,
        user_id=CONFIGURE_ONLY,
        agent_id=AGENT_ID,
        can_view=True,
        can_configure=True,
        can_execute=True,
    )

    api_client.app.dependency_overrides[get_current_user] = _as_user(
        CONFIGURE_ONLY,
        PERM_AGENTS_CONFIGURE,
        PERM_AGENTS_READ,
        PERM_AGENTS_EXECUTE,
    )
    try:
        assert (
            api_client.put(
                f"/agents/{AGENT_ID}/instruction-skills",
                json={"items": _sample_items()},
                headers=headers(CONFIGURE_ONLY),
            ).status_code
            == 403
        )
    finally:
        api_client.app.dependency_overrides[get_current_user] = stub_get_current_user

    api_client.app.dependency_overrides[get_current_user] = _as_user(
        TECHNICAL,
        PERM_PLATFORM_TECHNICAL,
        PERM_AGENTS_READ,
    )
    try:
        assert (
            api_client.put(
                f"/agents/{AGENT_ID}/instruction-skills",
                json={"items": _sample_items()},
                headers=headers(TECHNICAL),
            ).status_code
            == 403
        )
    finally:
        api_client.app.dependency_overrides[get_current_user] = stub_get_current_user


def test_reassign_owning_group_removes_former_leader(
    api_client: TestClient,
    db_session: Session,
) -> None:
    _seed_directory(db_session, ADMIN, LEADER, OTHER_LEADER)
    seed_agent(db_session, AGENT_ID)
    group_a = _create_group(api_client, "GroupA")
    group_b = _create_group(api_client, "GroupB")
    _put_membership(api_client, group_a, LEADER, GroupDesignation.LEADER.value)
    _put_membership(api_client, group_b, OTHER_LEADER, GroupDesignation.LEADER.value)
    _put_access_config(
        api_client,
        agent_id=AGENT_ID,
        owning_group_id=group_a,
        group_ids=[group_a, group_b],
    )

    api_client.app.dependency_overrides[get_current_user] = _as_user(
        LEADER,
        PERM_AGENTS_READ,
        PERM_AGENTS_EXECUTE,
    )
    try:
        assert (
            _put_instructions(
                api_client,
                agent_id=AGENT_ID,
                items=_sample_items(),
                user_id=LEADER,
            ).status_code
            == 200
        )
    finally:
        api_client.app.dependency_overrides[get_current_user] = stub_get_current_user

    _put_access_config(
        api_client,
        agent_id=AGENT_ID,
        owning_group_id=group_b,
        group_ids=[group_a, group_b],
    )

    api_client.app.dependency_overrides[get_current_user] = _as_user(
        LEADER,
        PERM_AGENTS_READ,
        PERM_AGENTS_EXECUTE,
    )
    try:
        assert (
            api_client.get(
                f"/agents/{AGENT_ID}/instruction-skills",
                headers=headers(LEADER),
            ).status_code
            == 403
        )
    finally:
        api_client.app.dependency_overrides[get_current_user] = stub_get_current_user


def test_unknown_agent_is_404(api_client: TestClient) -> None:
    assert (
        api_client.get(
            "/agents/missing-agent/instruction-skills",
            headers=headers(ADMIN),
        ).status_code
        == 404
    )
    assert (
        api_client.put(
            "/agents/missing-agent/instruction-skills",
            json={"items": []},
            headers=headers(ADMIN),
        ).status_code
        == 404
    )


def test_name_and_description_trim_before_length_limits(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent(db_session, AGENT_ID)
    # Raw length > 120 due to padding; trimmed length is within the limit.
    padded_name = f"  {'n' * 119}  "
    padded_description = f"  {'d' * 50}  "
    put = _put_instructions(
        api_client,
        agent_id=AGENT_ID,
        items=[
            {
                "name": padded_name,
                "description": padded_description,
                "instructions": "body",
            },
        ],
    )
    assert put.status_code == 200, put.text
    item = put.json()["items"][0]
    assert item["name"] == "n" * 119
    assert item["description"] == "d" * 50


def test_validation_failures_leave_collection_unchanged(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent(db_session, AGENT_ID)
    seeded = _put_instructions(api_client, agent_id=AGENT_ID, items=_sample_items())
    assert seeded.status_code == 200
    before = api_client.get(
        f"/agents/{AGENT_ID}/instruction-skills",
        headers=headers(ADMIN),
    ).json()["items"]

    assert (
        _put_instructions(
            api_client,
            agent_id=AGENT_ID,
            items=[{"name": "   ", "description": "", "instructions": "x"}],
        ).status_code
        == 422
    )
    assert (
        _put_instructions(
            api_client,
            agent_id=AGENT_ID,
            items=[{"name": "Blank", "description": "", "instructions": "   \n\t  "}],
        ).status_code
        == 422
    )
    huge = "x" * (AGGREGATE_MAX_LENGTH // 2)
    assert (
        _put_instructions(
            api_client,
            agent_id=AGENT_ID,
            items=[
                {"name": "A", "description": huge, "instructions": "ok"},
                {"name": "B", "description": huge, "instructions": "ok"},
            ],
        ).status_code
        == 422
    )

    after = api_client.get(
        f"/agents/{AGENT_ID}/instruction-skills",
        headers=headers(ADMIN),
    ).json()["items"]
    assert after == before


def test_empty_replace_clears_and_order_preserved(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent(db_session, AGENT_ID)
    put = _put_instructions(api_client, agent_id=AGENT_ID, items=_sample_items())
    assert [item["name"] for item in put.json()["items"]] == ["Tone", "Escalation"]
    cleared = _put_instructions(api_client, agent_id=AGENT_ID, items=[])
    assert cleared.status_code == 200
    assert cleared.json() == {"items": []}


def test_insert_failure_after_delete_preserves_previous(
    api_client: TestClient,
    db_session: Session,
    db_engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seed_agent(db_session, AGENT_ID)
    seeded = _put_instructions(api_client, agent_id=AGENT_ID, items=_sample_items())
    assert seeded.status_code == 200
    previous = [
        (row.name, row.description, row.instructions, row.position)
        for row in db_session.scalars(
            select(AgentInstructionSkill)
            .where(AgentInstructionSkill.agent_id == AGENT_ID)
            .order_by(AgentInstructionSkill.position.asc()),
        ).all()
    ]
    assert len(previous) == 2

    original_add = db_session.add

    def flaky_add(obj: object) -> None:
        if isinstance(obj, AgentInstructionSkill):
            raise RuntimeError("forced insert failure")
        return original_add(obj)

    monkeypatch.setattr(db_session, "add", flaky_add)
    with pytest.raises(RuntimeError, match="forced insert failure"):
        instruction_service.replace_instruction_skills(
            db_session,
            agent_id=AGENT_ID,
            items=[
                InstructionSkillItemIn(
                    name="New",
                    description="",
                    instructions="replacement",
                ),
            ],
            user_id=ADMIN,
            permissions=frozenset({PERM_AGENT_ACCESS_MANAGE}),
        )

    factory = sessionmaker(bind=db_engine, autoflush=False, autocommit=False)
    with factory() as fresh:
        restored = [
            (row.name, row.description, row.instructions, row.position)
            for row in fresh.scalars(
                select(AgentInstructionSkill)
                .where(AgentInstructionSkill.agent_id == AGENT_ID)
                .order_by(AgentInstructionSkill.position.asc()),
            ).all()
        ]
    assert restored == previous


def test_compose_and_snapshot_include_instructions_in_order(
    db_session: Session,
) -> None:
    seed_agent(db_session, AGENT_ID, system_prompt="BASE")
    instruction_service.replace_instruction_skills(
        db_session,
        agent_id=AGENT_ID,
        items=[
            InstructionSkillItemIn(
                name="First",
                description="d1",
                instructions="body-one",
            ),
            InstructionSkillItemIn(
                name="Second",
                description="",
                instructions="body-two",
            ),
        ],
        user_id=ADMIN,
        permissions=frozenset({PERM_AGENT_ACCESS_MANAGE}),
    )
    agent = db_session.get(Agent, AGENT_ID)
    assert agent is not None
    config, auth = execution_bundle(
        db_session,
        agent,
        user_id=ADMIN,
        permissions=frozenset({PERM_AGENTS_EXECUTE, PERM_AGENT_ACCESS_MANAGE}),
    )
    assert [item.name for item in config.instruction_skills] == ["First", "Second"]
    prompt = _system_prompt_for_run(config)
    assert prompt.index("BASE") < prompt.index("body-one") < prompt.index("body-two")
    assert "First" in prompt and "Second" in prompt
    from app.agents.skills import LOAD_SKILL_TOOL_NAME

    # Published instructions must not expand the tool allowlist.
    assert auth.allowed_tools == frozenset(config.tool_names)
    assert LOAD_SKILL_TOOL_NAME not in auth.allowed_tools


def test_published_instructions_are_ephemeral_not_checkpointed() -> None:
    saver = InMemorySaver()
    thread_id = "instruction-ephemeral"
    llm = ScriptedChatModel(script=[AIMessage(content="ack")])
    config = default_execution_config(
        system_prompt="TECH",
        instruction_skills=(
            PublishedInstructionSkill(
                name="Biz",
                description="",
                instructions="SECRET_INSTRUCTION_BODY",
            ),
        ),
    )
    asyncio.run(
        run_agent(
            "hello",
            tool_auth=default_tool_auth(),
            execution_config=config,
            llm=llm,
            checkpointer=saver,
            thread_id=thread_id,
        ),
    )
    tuple_ = asyncio.run(saver.aget_tuple({"configurable": {"thread_id": thread_id}}))
    assert tuple_ is not None
    rendered = repr(tuple_.checkpoint)
    assert "SECRET_INSTRUCTION_BODY" not in rendered
    messages = tuple_.checkpoint["channel_values"]["messages"]
    assert all(not isinstance(msg, SystemMessage) for msg in messages)
    assert any(isinstance(msg, HumanMessage) for msg in messages)


def test_compose_empty_instructions_preserves_base() -> None:
    assert compose_system_prompt_with_instructions("Only base", ()) == "Only base"
    assert compose_system_prompt_with_instructions("", ()) == ""


def test_snapshot_immutable_when_db_changes(db_session: Session) -> None:
    seed_agent(db_session, AGENT_ID, system_prompt="snap")
    instruction_service.replace_instruction_skills(
        db_session,
        agent_id=AGENT_ID,
        items=[
            InstructionSkillItemIn(
                name="Old",
                description="",
                instructions="old-body",
            ),
        ],
        user_id=ADMIN,
        permissions=frozenset({PERM_AGENT_ACCESS_MANAGE}),
    )
    agent = db_session.get(Agent, AGENT_ID)
    assert agent is not None
    config, _auth = execution_bundle(
        db_session,
        agent,
        user_id=ADMIN,
        permissions=frozenset({PERM_AGENTS_EXECUTE, PERM_AGENT_ACCESS_MANAGE}),
    )
    instruction_service.replace_instruction_skills(
        db_session,
        agent_id=AGENT_ID,
        items=[
            InstructionSkillItemIn(
                name="New",
                description="",
                instructions="new-body",
            ),
        ],
        user_id=ADMIN,
        permissions=frozenset({PERM_AGENT_ACCESS_MANAGE}),
    )
    assert config.instruction_skills[0].instructions == "old-body"
    assert "new-body" not in _system_prompt_for_run(config)

    agent = db_session.get(Agent, AGENT_ID)
    assert agent is not None
    next_config, _ = execution_bundle(
        db_session,
        agent,
        user_id=ADMIN,
        permissions=frozenset({PERM_AGENTS_EXECUTE, PERM_AGENT_ACCESS_MANAGE}),
    )
    assert next_config.instruction_skills[0].instructions == "new-body"
