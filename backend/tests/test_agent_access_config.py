"""Staged agent audience / owning-group configuration (Issue 3)."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from uuid import UUID, uuid4

from app.api.deps import get_current_user
from app.core.auth import AuthenticatedUser
from app.core.permissions import (
    PERM_AGENTS_CONFIGURE,
    PERM_AGENTS_EXECUTE,
    PERM_AGENTS_READ,
)
from app.models.agent import AgentAuthorizationMode
from app.models.agent_access_grant import AgentAccessGrant
from app.models.agent_group_assignment import AgentGroupAssignment
from app.models.directory_user import DirectoryUser
from app.models.group import GroupDesignation
from fastapi import Request
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from tests.auth_helpers import stub_get_current_user
from tests.chat_helpers import headers, seed_agent, seed_agent_grant

ADMIN = "auth0|admin"
LEADER = "auth0|leader"
MEMBER = "auth0|member"
AGENT_ID = "access-config-agent"


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


def _put_config(
    api_client: TestClient,
    *,
    agent_id: str = AGENT_ID,
    audience_mode: str = "groups",
    owning_group_id: str | None = None,
    group_ids: list[str] | None = None,
    extra: dict | None = None,
) -> object:
    body: dict = {
        "audience_mode": audience_mode,
        "owning_group_id": owning_group_id,
        "group_ids": group_ids if group_ids is not None else [],
    }
    if extra:
        body.update(extra)
    return api_client.put(
        f"/agents/{agent_id}/access-config",
        json=body,
        headers=headers(ADMIN),
    )


def test_unauthenticated_access_config_is_401(
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
    assert api_client.get(f"/agents/{AGENT_ID}/access-config").status_code == 401
    assert (
        api_client.put(
            f"/agents/{AGENT_ID}/access-config",
            json={
                "audience_mode": "company",
                "owning_group_id": None,
                "group_ids": [],
            },
        ).status_code
        == 401
    )


def test_without_manage_is_403(api_client: TestClient, db_session: Session) -> None:
    seed_agent(db_session, AGENT_ID)
    api_client.app.dependency_overrides[get_current_user] = _as_user(
        LEADER,
        PERM_AGENTS_READ,
        PERM_AGENTS_EXECUTE,
    )
    try:
        assert (
            api_client.get(
                f"/agents/{AGENT_ID}/access-config",
                headers=headers(LEADER),
            ).status_code
            == 403
        )
        assert (
            api_client.put(
                f"/agents/{AGENT_ID}/access-config",
                json={
                    "audience_mode": "company",
                    "owning_group_id": None,
                    "group_ids": [],
                },
                headers=headers(LEADER),
            ).status_code
            == 403
        )
    finally:
        api_client.app.dependency_overrides[get_current_user] = stub_get_current_user


def test_leader_cannot_change_access_config(
    api_client: TestClient,
    db_session: Session,
) -> None:
    _seed_directory(db_session, ADMIN, LEADER)
    seed_agent(db_session, AGENT_ID)
    group_id = _create_group(api_client, "Led")
    _put_membership(api_client, group_id, LEADER, GroupDesignation.LEADER.value)

    api_client.app.dependency_overrides[get_current_user] = _as_user(
        LEADER,
        PERM_AGENTS_READ,
        PERM_AGENTS_EXECUTE,
    )
    try:
        denied = api_client.put(
            f"/agents/{AGENT_ID}/access-config",
            json={
                "audience_mode": "groups",
                "owning_group_id": group_id,
                "group_ids": [group_id],
            },
            headers=headers(LEADER),
        )
        assert denied.status_code == 403, denied.text
    finally:
        api_client.app.dependency_overrides[get_current_user] = stub_get_current_user


def test_unknown_agent_and_group_are_404(
    api_client: TestClient,
    db_session: Session,
) -> None:
    _seed_directory(db_session, ADMIN)
    seed_agent(db_session, AGENT_ID)
    missing = str(uuid4())
    assert (
        api_client.get(
            "/agents/missing-agent/access-config",
            headers=headers(ADMIN),
        ).status_code
        == 404
    )
    bad_group = _put_config(
        api_client,
        owning_group_id=missing,
        group_ids=[],
    )
    assert bad_group.status_code == 404, bad_group.text


def test_put_requires_all_fields_and_rejects_authorization_mode(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent(db_session, AGENT_ID)
    missing_owning = api_client.put(
        f"/agents/{AGENT_ID}/access-config",
        json={"audience_mode": "company", "group_ids": []},
        headers=headers(ADMIN),
    )
    assert missing_owning.status_code == 422, missing_owning.text

    with_mode = api_client.put(
        f"/agents/{AGENT_ID}/access-config",
        json={
            "audience_mode": "company",
            "owning_group_id": None,
            "group_ids": [],
            "authorization_mode": "audience",
        },
        headers=headers(ADMIN),
    )
    assert with_mode.status_code == 422, with_mode.text


def test_company_and_groups_settings_and_empty_audience(
    api_client: TestClient,
    db_session: Session,
) -> None:
    _seed_directory(db_session, ADMIN)
    seed_agent(db_session, AGENT_ID)
    group_id = _create_group(api_client, "Ops")

    company = _put_config(
        api_client,
        audience_mode="company",
        owning_group_id=None,
        group_ids=[group_id],
    )
    assert company.status_code == 200, company.text
    body = company.json()
    assert body["authorization_mode"] == "legacy_grants"
    assert body["audience_effective"] is False
    assert body["audience_mode"] == "company"
    assert body["group_ids"] == [group_id]

    empty = _put_config(
        api_client,
        audience_mode="groups",
        owning_group_id=None,
        group_ids=[],
    )
    assert empty.status_code == 200, empty.text
    assert empty.json()["group_ids"] == []
    assert empty.json()["audience_effective"] is False


def test_owning_auto_include_and_cannot_strip_current_owning(
    api_client: TestClient,
    db_session: Session,
) -> None:
    _seed_directory(db_session, ADMIN)
    seed_agent(db_session, AGENT_ID)
    owning = _create_group(api_client, "Owning")
    other = _create_group(api_client, "Other")

    created = _put_config(
        api_client,
        audience_mode="groups",
        owning_group_id=owning,
        group_ids=[other],
    )
    assert created.status_code == 200, created.text
    assert set(created.json()["group_ids"]) == {owning, other}
    owning_flags = {item["group_id"]: item["is_owning"] for item in created.json()["groups"]}
    assert owning_flags[owning] is True
    assert owning_flags[other] is False

    stripped = _put_config(
        api_client,
        audience_mode="groups",
        owning_group_id=owning,
        group_ids=[other],
    )
    assert stripped.status_code == 422, stripped.text
    assert "owning" in stripped.json()["detail"].lower()

    # No partial write: still has both assignments.
    current = api_client.get(
        f"/agents/{AGENT_ID}/access-config",
        headers=headers(ADMIN),
    )
    assert set(current.json()["group_ids"]) == {owning, other}


def test_ownership_change_preserves_previous_then_allows_later_removal(
    api_client: TestClient,
    db_session: Session,
) -> None:
    _seed_directory(db_session, ADMIN)
    seed_agent(db_session, AGENT_ID)
    group_a = _create_group(api_client, "Group A")
    group_b = _create_group(api_client, "Group B")

    first = _put_config(
        api_client,
        owning_group_id=group_a,
        group_ids=[group_a],
    )
    assert first.status_code == 200, first.text

    changed = _put_config(
        api_client,
        owning_group_id=group_b,
        group_ids=[group_b],
    )
    assert changed.status_code == 200, changed.text
    assert set(changed.json()["group_ids"]) == {group_a, group_b}
    assert changed.json()["owning_group_id"] == group_b

    removed = _put_config(
        api_client,
        owning_group_id=group_b,
        group_ids=[group_b],
    )
    assert removed.status_code == 200, removed.text
    assert removed.json()["group_ids"] == [group_b]


def test_zero_leaders_and_null_owning_allowed(
    api_client: TestClient,
    db_session: Session,
) -> None:
    _seed_directory(db_session, ADMIN)
    seed_agent(db_session, AGENT_ID)
    group_id = _create_group(api_client, "No Leaders")
    response = _put_config(
        api_client,
        owning_group_id=group_id,
        group_ids=[group_id],
    )
    assert response.status_code == 200, response.text
    cleared = _put_config(
        api_client,
        owning_group_id=None,
        group_ids=[group_id],
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["owning_group_id"] is None


def test_assignment_only_change_bumps_updated_at(
    api_client: TestClient,
    db_session: Session,
) -> None:
    _seed_directory(db_session, ADMIN)
    seed_agent(db_session, AGENT_ID)
    group_a = _create_group(api_client, "Stamp A")
    group_b = _create_group(api_client, "Stamp B")

    first = _put_config(
        api_client,
        audience_mode="groups",
        owning_group_id=None,
        group_ids=[group_a],
    )
    assert first.status_code == 200, first.text
    first_updated = first.json()["updated_at"]

    second = _put_config(
        api_client,
        audience_mode="groups",
        owning_group_id=None,
        group_ids=[group_a, group_b],
    )
    assert second.status_code == 200, second.text
    assert second.json()["audience_mode"] == "groups"
    assert second.json()["owning_group_id"] is None
    assert second.json()["updated_at"] >= first_updated
    assert set(second.json()["group_ids"]) == {group_a, group_b}


def test_existing_agents_remain_legacy_and_chat_grants_unchanged(
    api_client: TestClient,
    db_session: Session,
) -> None:
    _seed_directory(db_session, ADMIN, MEMBER)
    seed_agent(db_session, AGENT_ID)
    seed_agent_grant(db_session, MEMBER, AGENT_ID, can_view=True, can_execute=True)
    group_id = _create_group(api_client, "Staged")

    before_grants = list(
        db_session.scalars(
            select(AgentAccessGrant).where(AgentAccessGrant.agent_id == AGENT_ID),
        ).all(),
    )
    before_payload = [
        (g.user_id, g.can_view, g.can_configure, g.can_execute) for g in before_grants
    ]

    staged = _put_config(
        api_client,
        audience_mode="groups",
        owning_group_id=group_id,
        group_ids=[],
    )
    assert staged.status_code == 200, staged.text
    assert staged.json()["authorization_mode"] == AgentAuthorizationMode.LEGACY_GRANTS.value
    assert staged.json()["audience_effective"] is False

    after_grants = list(
        db_session.scalars(
            select(AgentAccessGrant).where(AgentAccessGrant.agent_id == AGENT_ID),
        ).all(),
    )
    after_payload = [(g.user_id, g.can_view, g.can_configure, g.can_execute) for g in after_grants]
    assert after_payload == before_payload

    api_client.app.dependency_overrides[get_current_user] = _as_user(
        MEMBER,
        PERM_AGENTS_READ,
        PERM_AGENTS_EXECUTE,
    )
    try:
        listed = api_client.get("/agents", headers=headers(MEMBER))
        assert listed.status_code == 200, listed.text
        assert any(item["id"] == AGENT_ID for item in listed.json()["items"])

        session = api_client.post(
            "/sessions",
            json={"agent_id": AGENT_ID},
            headers=headers(MEMBER),
        )
        assert session.status_code == 201, session.text
    finally:
        api_client.app.dependency_overrides[get_current_user] = stub_get_current_user


def test_create_agent_uses_audience_mode_without_creator_grant(
    api_client: TestClient,
    db_session: Session,
) -> None:
    created = api_client.post(
        "/agents",
        json={"id": "new-audience-agent", "name": "New", "description": None},
        headers=headers(ADMIN),
    )
    assert created.status_code == 201, created.text

    config = api_client.get(
        "/agents/new-audience-agent/access-config",
        headers=headers(ADMIN),
    )
    assert config.status_code == 200, config.text
    assert config.json()["authorization_mode"] == "audience"
    assert config.json()["audience_mode"] == "groups"
    assert config.json()["audience_effective"] is True
    assert config.json()["group_ids"] == []

    grant = db_session.scalar(
        select(AgentAccessGrant).where(
            AgentAccessGrant.agent_id == "new-audience-agent",
            AgentAccessGrant.user_id == ADMIN,
        ),
    )
    assert grant is None


def test_unique_agent_group_assignment(
    api_client: TestClient,
    db_session: Session,
) -> None:
    _seed_directory(db_session, ADMIN)
    seed_agent(db_session, AGENT_ID)
    group_id = _create_group(api_client, "Unique")
    first = _put_config(
        api_client,
        owning_group_id=None,
        group_ids=[group_id, group_id],
    )
    assert first.status_code == 200, first.text
    rows = list(
        db_session.scalars(
            select(AgentGroupAssignment).where(
                AgentGroupAssignment.agent_id == AGENT_ID,
                AgentGroupAssignment.group_id == UUID(group_id),
            ),
        ).all(),
    )
    assert len(rows) == 1


def test_developer_without_manage_cannot_read_config(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent(db_session, AGENT_ID)
    api_client.app.dependency_overrides[get_current_user] = _as_user(
        "auth0|dev",
        PERM_AGENTS_READ,
        PERM_AGENTS_CONFIGURE,
        PERM_AGENTS_EXECUTE,
    )
    try:
        assert (
            api_client.get(
                f"/agents/{AGENT_ID}/access-config",
                headers=headers("auth0|dev"),
            ).status_code
            == 403
        )
    finally:
        api_client.app.dependency_overrides[get_current_user] = stub_get_current_user


def test_company_mode_also_rejects_stripping_current_owning(
    api_client: TestClient,
    db_session: Session,
) -> None:
    _seed_directory(db_session, ADMIN)
    seed_agent(db_session, AGENT_ID)
    owning = _create_group(api_client, "Company Owning")
    other = _create_group(api_client, "Company Other")
    setup = _put_config(
        api_client,
        audience_mode="company",
        owning_group_id=owning,
        group_ids=[owning, other],
    )
    assert setup.status_code == 200, setup.text
    denied = _put_config(
        api_client,
        audience_mode="company",
        owning_group_id=owning,
        group_ids=[other],
    )
    assert denied.status_code == 422, denied.text
