"""Agent catalog CRUD and deactivation gates (#19)."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from unittest.mock import MagicMock

from app.agents.tool_policy import permitted_tool_names
from app.agents.tools import create_default_registry
from app.api.deps import get_current_user
from app.core.auth import AuthenticatedUser
from app.core.config import Settings, get_settings
from app.core.permissions import PERM_AGENTS_CONFIGURE, PERM_AGENTS_EXECUTE, PERM_AGENTS_READ
from app.models.agent import Agent
from app.models.agent_access_grant import AgentAccessGrant
from app.services import agent_access as access_service
from app.services import agents as agent_service
from app.services.agents import INACTIVE_AGENT_DETAIL
from fastapi import Request
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage
from pytest import MonkeyPatch
from sqlalchemy.orm import Session

from tests.auth_helpers import stub_get_current_user
from tests.chat_helpers import (
    USER,
    create_session,
    default_tool_auth,
    headers,
    seed_agent,
    seed_agent_grant,
    with_saver,
)
from tests.fakes import ScriptedChatModel


def _configure_headers(user_id: str = USER) -> dict[str, str]:
    return headers(user_id)


def _as_user(*permissions: str):
    perms = frozenset(permissions)

    def _current(request: Request) -> AuthenticatedUser:
        user_id = request.headers.get("x-user-id", USER)
        return AuthenticatedUser(user_id=user_id, permissions=perms)

    return _current


def test_create_list_get_update_deactivate(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(
        db_session,
        USER,
        "default",
        can_view=True,
        can_configure=True,
        can_execute=True,
    )
    created = api_client.post(
        "/agents",
        json={"id": "ops", "name": "Ops", "description": "ops bot"},
        headers=_configure_headers(),
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["id"] == "ops"
    assert body["name"] == "Ops"
    assert body["description"] == "ops bot"
    assert body["status"] == "active"
    assert body["created_by"] == USER

    listed = api_client.get("/agents", headers=_configure_headers())
    assert listed.status_code == 200
    ids = {item["id"] for item in listed.json()["items"]}
    assert "ops" in ids

    got = api_client.get("/agents/ops", headers=_configure_headers())
    assert got.status_code == 200
    assert got.json()["name"] == "Ops"

    patched = api_client.patch(
        "/agents/ops",
        json={"name": "Ops 2"},
        headers=_configure_headers(),
    )
    assert patched.status_code == 200
    assert patched.json()["name"] == "Ops 2"
    assert patched.json()["description"] == "ops bot"

    cleared = api_client.patch(
        "/agents/ops",
        json={"description": None},
        headers=_configure_headers(),
    )
    assert cleared.status_code == 200
    assert cleared.json()["description"] is None

    deactivated = api_client.post(
        "/agents/ops/deactivate",
        headers=_configure_headers(),
    )
    assert deactivated.status_code == 200
    assert deactivated.json()["status"] == "inactive"

    # Idempotent deactivate
    again = api_client.post("/agents/ops/deactivate", headers=_configure_headers())
    assert again.status_code == 200
    assert again.json()["status"] == "inactive"


def test_list_pagination_and_status_filter(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(db_session, USER, "default", can_configure=True, can_view=True)
    for agent_id in ("page-a", "page-b", "page-c"):
        created = api_client.post(
            "/agents",
            json={"id": agent_id, "name": agent_id},
            headers=_configure_headers(),
        )
        assert created.status_code == 201, created.text
    deactivated = api_client.post(
        "/agents/page-c/deactivate",
        headers=_configure_headers(),
    )
    assert deactivated.status_code == 200

    active = api_client.get("/agents", params={"limit": 2}, headers=_configure_headers())
    assert active.status_code == 200
    body = active.json()
    assert len(body["items"]) == 2
    assert body["next_cursor"]
    page2 = api_client.get(
        "/agents",
        params={"limit": 2, "cursor": body["next_cursor"]},
        headers=_configure_headers(),
    )
    assert page2.status_code == 200
    # default status=active excludes page-c; remaining active include default + page-a/b
    active_ids = {item["id"] for item in body["items"] + page2.json()["items"]}
    assert "page-c" not in active_ids
    assert {"page-a", "page-b"} <= active_ids

    inactive = api_client.get(
        "/agents",
        params={"status": "inactive"},
        headers=_configure_headers(),
    )
    assert inactive.status_code == 200
    assert {item["id"] for item in inactive.json()["items"]} == {"page-c"}

    all_status = api_client.get(
        "/agents",
        params={"status": "all", "limit": 100},
        headers=_configure_headers(),
    )
    assert all_status.status_code == 200
    assert {"page-a", "page-b", "page-c"} <= {item["id"] for item in all_status.json()["items"]}


def test_patch_rejects_immutable_id(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(db_session, USER, "default", can_configure=True)
    api_client.post(
        "/agents",
        json={"id": "immutable", "name": "Immutable"},
        headers=_configure_headers(),
    )
    response = api_client.patch(
        "/agents/immutable",
        json={"id": "other", "name": "Nope"},
        headers=_configure_headers(),
    )
    assert response.status_code == 422


def test_create_duplicate_conflict(api_client: TestClient, db_session: Session) -> None:
    seed_agent_grant(db_session, USER, "default", can_configure=True)
    first = api_client.post(
        "/agents",
        json={"id": "dup", "name": "Dup"},
        headers=_configure_headers(),
    )
    assert first.status_code == 201
    second = api_client.post(
        "/agents",
        json={"id": "dup", "name": "Dup2"},
        headers=_configure_headers(),
    )
    assert second.status_code == 409


def test_patch_rejects_blank_name_and_unknown_fields(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(db_session, USER, "default", can_configure=True)
    api_client.post(
        "/agents",
        json={"id": "patchy", "name": "Patchy"},
        headers=_configure_headers(),
    )
    blank = api_client.patch(
        "/agents/patchy",
        json={"name": "  "},
        headers=_configure_headers(),
    )
    assert blank.status_code == 422
    extra = api_client.patch(
        "/agents/patchy",
        json={"status": "inactive"},
        headers=_configure_headers(),
    )
    assert extra.status_code == 422


def test_get_without_view_is_404(api_client: TestClient, db_session: Session) -> None:
    seed_agent(db_session, "secret")
    seed_agent_grant(db_session, USER, "default", can_view=True)
    api_client.app.dependency_overrides[get_current_user] = _as_user(PERM_AGENTS_READ)
    try:
        response = api_client.get("/agents/secret", headers=_configure_headers())
        assert response.status_code == 404
    finally:
        api_client.app.dependency_overrides[get_current_user] = stub_get_current_user


def test_update_without_configure_is_403(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(
        db_session,
        USER,
        "locked",
        can_view=True,
        can_configure=False,
        can_execute=True,
    )
    api_client.app.dependency_overrides[get_current_user] = _as_user(
        PERM_AGENTS_READ,
        PERM_AGENTS_CONFIGURE,
    )
    try:
        response = api_client.patch(
            "/agents/locked",
            json={"name": "Nope"},
            headers=_configure_headers(),
        )
        assert response.status_code == 403
    finally:
        api_client.app.dependency_overrides[get_current_user] = stub_get_current_user


def test_create_agent_does_not_write_creator_grant(
    db_session: Session,
) -> None:
    agent = agent_service.create_agent(
        db_session,
        agent_id="no-creator-grant",
        name="No Grant",
        description=None,
        created_by=USER,
    )
    assert agent.authorization_mode == "audience"
    assert agent.audience_mode == "groups"
    assert access_service.get_grant(db_session, user_id=USER, agent_id="no-creator-grant") is None


def test_create_ignores_preexisting_orphan_grant(
    api_client: TestClient,
    db_session: Session,
) -> None:
    """Orphan grants must not block create; create does not rewrite them."""
    now = datetime.now(UTC)
    db_session.add(
        AgentAccessGrant(
            id=uuid.uuid4(),
            user_id=USER,
            agent_id="legacy",
            can_view=True,
            can_configure=False,
            can_execute=False,
            created_at=now,
            updated_at=now,
        )
    )
    db_session.commit()

    seed_agent_grant(db_session, USER, "default", can_configure=True)
    created = api_client.post(
        "/agents",
        json={"id": "legacy", "name": "Legacy"},
        headers=_configure_headers(),
    )
    assert created.status_code == 201, created.text
    grant = access_service.get_grant(db_session, user_id=USER, agent_id="legacy")
    assert grant is not None
    assert grant.can_view is True
    assert grant.can_configure is False
    assert grant.can_execute is False


def test_inactive_without_execute_is_403_not_409(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent(db_session, "quiet", status="inactive")
    api_client.app.dependency_overrides[get_current_user] = _as_user(
        PERM_AGENTS_READ,
        PERM_AGENTS_EXECUTE,
    )
    try:
        denied = api_client.post(
            "/sessions",
            json={"agent_id": "quiet"},
            headers=headers(),
        )
        assert denied.status_code == 403
        assert denied.json()["detail"] == "Agent access denied"
    finally:
        api_client.app.dependency_overrides[get_current_user] = stub_get_current_user


def test_owned_session_missing_execute_inactive_is_403(
    api_client: TestClient,
    db_session: Session,
) -> None:
    created = create_session(
        api_client,
        db_session,
        agent_id="later-quiet",
        can_view=True,
        can_configure=True,
        can_execute=True,
    )
    api_client.post("/agents/later-quiet/deactivate", headers=_configure_headers())
    access_service.upsert_grant(
        db_session,
        user_id=USER,
        agent_id="later-quiet",
        can_view=True,
        can_configure=True,
        can_execute=False,
    )
    with_saver(api_client)
    api_client.app.dependency_overrides[get_current_user] = _as_user(
        PERM_AGENTS_READ,
        PERM_AGENTS_EXECUTE,
    )
    try:
        denied = api_client.post(
            f"/sessions/{created['id']}/messages",
            json={"content": "hi"},
            headers=headers(),
        )
        assert denied.status_code == 403
        assert denied.json()["detail"] == "Agent access denied"
    finally:
        api_client.app.dependency_overrides[get_current_user] = stub_get_current_user


def test_patch_oversized_agent_id_is_404_not_500(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(db_session, USER, "default", can_configure=True)
    oversized = "x" * 65
    response = api_client.patch(
        f"/agents/{oversized}",
        json={"name": "Nope"},
        headers=_configure_headers(),
    )
    assert response.status_code == 404


def test_patch_blank_description_clears_to_null(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(db_session, USER, "default", can_configure=True)
    api_client.post(
        "/agents",
        json={"id": "desc", "name": "Desc", "description": "keep"},
        headers=_configure_headers(),
    )
    cleared = api_client.patch(
        "/agents/desc",
        json={"description": "  "},
        headers=_configure_headers(),
    )
    assert cleared.status_code == 200
    assert cleared.json()["description"] is None


def _use_model(monkeypatch: MonkeyPatch, model: ScriptedChatModel) -> None:
    def _settings() -> Settings:
        return Settings(_env_file=None, llm_api_key="test-key")

    monkeypatch.setattr("app.agents.runtime.get_settings", _settings)
    monkeypatch.setattr("app.agents.runtime.create_chat_model_for_agent", lambda **_kwargs: model)


def test_deactivate_blocks_all_execution_entry_points(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    created = create_session(
        api_client,
        db_session,
        agent_id="blockme",
        can_view=True,
        can_configure=True,
        can_execute=True,
    )
    with_saver(api_client)

    # Seed a turn while active so history exists.
    _use_model(monkeypatch, ScriptedChatModel(script=[AIMessage(content="hello")]))
    ok = api_client.post(
        f"/sessions/{created['id']}/messages",
        json={"content": "hi"},
        headers=headers(),
    )
    assert ok.status_code == 200, ok.text

    api_client.post("/agents/blockme/deactivate", headers=_configure_headers())

    run_spy = MagicMock()

    async def _should_not_run(*args, **kwargs):  # noqa: ANN002, ANN003
        run_spy()
        raise AssertionError("run_agent must not be called for inactive agent")

    monkeypatch.setattr(
        "app.api.routes.sessions.message_service.post_user_message", _should_not_run
    )
    monkeypatch.setattr(
        "app.api.routes.sessions.message_service.stream_user_message",
        _should_not_run,
    )
    monkeypatch.setattr("app.api.routes.agents.run_agent", _should_not_run)

    # New session
    new_session = api_client.post(
        "/sessions",
        json={"agent_id": "blockme"},
        headers=headers(),
    )
    assert new_session.status_code == 409
    assert new_session.json()["detail"] == INACTIVE_AGENT_DETAIL

    # Existing-session JSON
    json_msg = api_client.post(
        f"/sessions/{created['id']}/messages",
        json={"content": "again"},
        headers=headers(),
    )
    assert json_msg.status_code == 409
    assert json_msg.json()["detail"] == INACTIVE_AGENT_DETAIL

    # Existing-session SSE
    with api_client.stream(
        "POST",
        f"/sessions/{created['id']}/messages/stream",
        json={"content": "stream"},
        headers=headers(),
    ) as stream:
        assert stream.status_code == 409
        assert json.loads(stream.read())["detail"] == INACTIVE_AGENT_DETAIL

    # Session-scoped /agents/run
    run_session = api_client.post(
        "/agents/run",
        json={"message": "run", "session_id": created["id"]},
        headers=headers(),
    )
    assert run_session.status_code == 409
    assert run_session.json()["detail"] == INACTIVE_AGENT_DETAIL

    # Stateless /agents/run against deactivated settings agent
    monkeypatch.setenv("AGENT_ID", "blockme")
    get_settings.cache_clear()
    try:
        run_stateless = api_client.post(
            "/agents/run",
            json={"message": "run"},
            headers=headers(),
        )
        assert run_stateless.status_code == 409
        assert run_stateless.json()["detail"] == INACTIVE_AGENT_DETAIL
    finally:
        monkeypatch.delenv("AGENT_ID", raising=False)
        get_settings.cache_clear()

    assert run_spy.call_count == 0

    # History still readable
    history = api_client.get(
        f"/sessions/{created['id']}/messages",
        headers=headers(),
    )
    assert history.status_code == 200
    assert len(history.json()["items"]) >= 2


def test_new_agent_defaults_to_empty_tools(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    """New agents start with tool_names=[] (empty ≠ all tools)."""
    seed_agent_grant(db_session, USER, "default", can_configure=True)
    created = api_client.post(
        "/agents",
        json={"id": "brand-new", "name": "Brand New"},
        headers=_configure_headers(),
    )
    assert created.status_code == 201
    agent = db_session.get(Agent, "brand-new")
    assert agent is not None
    assert agent.tool_names == []

    registry = create_default_registry()
    auth = default_tool_auth(agent_id="brand-new", allowed_tools=frozenset())
    assert permitted_tool_names(registry, auth) == frozenset()

    _use_model(
        monkeypatch,
        ScriptedChatModel(
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
    session = create_session(api_client, db_session, agent_id="brand-new")
    with_saver(api_client)
    response = api_client.post(
        f"/sessions/{session['id']}/messages",
        json={"content": "add"},
        headers=headers(),
    )
    assert response.status_code == 200
    history = api_client.get(
        f"/sessions/{session['id']}/messages",
        headers=headers(),
    ).json()["items"]
    tool_items = [item for item in history if item["role"] == "tool"]
    assert tool_items
    assert "not authorized" in tool_items[0]["content"]


def test_permissions_required_for_crud(
    api_client: TestClient,
    db_session: Session,
) -> None:
    def execute_only(request: Request) -> AuthenticatedUser:
        return AuthenticatedUser(
            user_id=request.headers.get("x-user-id", USER),
            permissions=frozenset({PERM_AGENTS_EXECUTE, PERM_AGENTS_READ}),
        )

    api_client.app.dependency_overrides[get_current_user] = execute_only
    response = api_client.post(
        "/agents",
        json={"id": "nope", "name": "Nope"},
        headers=headers(),
    )
    assert response.status_code == 403
