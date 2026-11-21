"""Issue 4: audience vs legacy_grants authorization (never OR'd)."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from app.api.deps import get_current_user
from app.core.auth import AuthenticatedUser
from app.core.permissions import (
    ALL_PERMISSIONS,
    PERM_AGENT_ACCESS_MANAGE,
    PERM_AGENTS_CONFIGURE,
    PERM_AGENTS_EXECUTE,
    PERM_AGENTS_READ,
    PERM_PLATFORM_TECHNICAL,
    ROLE_PERMISSIONS,
)
from app.models.agent import Agent, AgentAudienceMode, AgentAuthorizationMode
from app.models.agent_group_assignment import AgentGroupAssignment
from app.models.directory_user import DirectoryUser
from app.models.group import Group, GroupDesignation, GroupMembership
from app.services import agent_access as access_service
from app.services import agents as agent_service
from fastapi import Request
from sqlalchemy import delete
from sqlalchemy.orm import Session
from starlette.testclient import TestClient

from tests.chat_helpers import headers, seed_agent_grant

USER = "auth0|audience-user"
ADMIN = "auth0|audience-admin"
OTHER = "auth0|audience-other"


def _as_user(user_id: str, *permissions: str) -> Callable[[Request], AuthenticatedUser]:
    perms = frozenset(permissions)

    def _current(request: Request) -> AuthenticatedUser:
        return AuthenticatedUser(
            user_id=request.headers.get("x-user-id", user_id),
            permissions=perms,
        )

    return _current


def _ensure_directory(db: Session, user_id: str) -> None:
    if db.get(DirectoryUser, user_id) is None:
        now = datetime.now(UTC)
        db.add(
            DirectoryUser(
                user_id=user_id,
                first_seen_at=now,
                last_seen_at=now,
            ),
        )
        db.commit()


def _make_group(db: Session, name: str) -> Group:
    group = Group(id=uuid4(), name=name, description=None)
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


def _add_member(
    db: Session,
    group_id: object,
    user_id: str,
    designation: str = GroupDesignation.MEMBER.value,
) -> None:
    _ensure_directory(db, user_id)
    db.add(
        GroupMembership(
            group_id=group_id,
            user_id=user_id,
            designation=designation,
        ),
    )
    db.commit()


def _assign_group(db: Session, agent_id: str, group_id: object) -> None:
    now = datetime.now(UTC)
    db.add(
        AgentGroupAssignment(
            agent_id=agent_id,
            group_id=group_id,
            created_at=now,
            updated_at=now,
        ),
    )
    db.commit()


def test_legacy_grant_does_not_authorize_audience_agent(
    api_client: TestClient,
    db_session: Session,
) -> None:
    agent = agent_service.create_agent(
        db_session,
        agent_id="aud-no-grant-or",
        name="Audience",
        description=None,
        created_by=ADMIN,
    )
    assert agent.authorization_mode == AgentAuthorizationMode.AUDIENCE.value
    access_service.upsert_grant(
        db_session,
        user_id=USER,
        agent_id=agent.id,
        can_view=True,
        can_configure=True,
        can_execute=True,
    )
    api_client.app.dependency_overrides[get_current_user] = _as_user(
        USER,
        PERM_AGENTS_READ,
        PERM_AGENTS_EXECUTE,
    )
    listed = api_client.get("/agents", headers=headers(USER))
    assert listed.status_code == 200
    assert all(item["id"] != agent.id for item in listed.json()["items"])
    assert api_client.get(f"/agents/{agent.id}", headers=headers(USER)).status_code == 404
    assert (
        api_client.post(
            "/sessions",
            json={"agent_id": agent.id},
            headers=headers(USER),
        ).status_code
        == 403
    )


def test_membership_does_not_authorize_legacy_agent(
    api_client: TestClient,
    db_session: Session,
) -> None:
    group = _make_group(db_session, "legacy-bypass")
    _add_member(db_session, group.id, USER)
    seed_agent_grant(db_session, OTHER)
    agent = db_session.get(Agent, "default")
    assert agent is not None
    assert agent.authorization_mode == AgentAuthorizationMode.LEGACY_GRANTS.value
    _assign_group(db_session, "default", group.id)

    api_client.app.dependency_overrides[get_current_user] = _as_user(
        USER,
        PERM_AGENTS_READ,
        PERM_AGENTS_EXECUTE,
    )
    assert api_client.get("/agents/default", headers=headers(USER)).status_code == 404


def test_manage_can_view_legacy_agent_without_a_grant(
    api_client: TestClient,
    db_session: Session,
) -> None:
    agent = db_session.get(Agent, "default")
    assert agent is not None
    assert agent.authorization_mode == AgentAuthorizationMode.LEGACY_GRANTS.value
    api_client.app.dependency_overrides[get_current_user] = _as_user(
        ADMIN,
        PERM_AGENTS_READ,
        PERM_AGENTS_EXECUTE,
        PERM_AGENT_ACCESS_MANAGE,
    )
    listed = api_client.get("/agents", headers=headers(ADMIN))
    assert listed.status_code == 200
    assert any(item["id"] == "default" for item in listed.json()["items"])
    assert api_client.get("/agents/default", headers=headers(ADMIN)).status_code == 200
    created = api_client.post(
        "/sessions",
        json={"agent_id": "default"},
        headers=headers(ADMIN),
    )
    assert created.status_code == 403


def test_company_audience_allows_authenticated_user(
    api_client: TestClient,
    db_session: Session,
) -> None:
    agent = agent_service.create_agent(
        db_session,
        agent_id="aud-company",
        name="Company",
        description=None,
        created_by=ADMIN,
    )
    row = db_session.get(Agent, agent.id)
    assert row is not None
    row.audience_mode = AgentAudienceMode.COMPANY.value
    db_session.commit()

    api_client.app.dependency_overrides[get_current_user] = _as_user(
        USER,
        PERM_AGENTS_READ,
        PERM_AGENTS_EXECUTE,
    )
    assert api_client.get(f"/agents/{agent.id}", headers=headers(USER)).status_code == 200
    assert (
        api_client.post(
            "/sessions",
            json={"agent_id": agent.id},
            headers=headers(USER),
        ).status_code
        == 201
    )


def test_selected_group_member_and_leader_same_usage(
    api_client: TestClient,
    db_session: Session,
) -> None:
    group = _make_group(db_session, "usage-group")
    member = "auth0|member-usage"
    leader = "auth0|leader-usage"
    _add_member(db_session, group.id, member, GroupDesignation.MEMBER.value)
    _add_member(db_session, group.id, leader, GroupDesignation.LEADER.value)
    agent = agent_service.create_agent(
        db_session,
        agent_id="aud-groups",
        name="Groups",
        description=None,
        created_by=ADMIN,
    )
    _assign_group(db_session, agent.id, group.id)

    for uid in (member, leader):
        api_client.app.dependency_overrides[get_current_user] = _as_user(
            uid,
            PERM_AGENTS_READ,
            PERM_AGENTS_EXECUTE,
        )
        assert api_client.get(f"/agents/{agent.id}", headers=headers(uid)).status_code == 200
        assert (
            api_client.post(
                "/sessions",
                json={"agent_id": agent.id},
                headers=headers(uid),
            ).status_code
            == 201
        )


def test_empty_audience_hides_from_ordinary_user_not_manage(
    api_client: TestClient,
    db_session: Session,
) -> None:
    agent = agent_service.create_agent(
        db_session,
        agent_id="aud-empty",
        name="Empty",
        description=None,
        created_by=ADMIN,
    )
    api_client.app.dependency_overrides[get_current_user] = _as_user(
        USER,
        PERM_AGENTS_READ,
        PERM_AGENTS_EXECUTE,
    )
    assert api_client.get(f"/agents/{agent.id}", headers=headers(USER)).status_code == 404

    api_client.app.dependency_overrides[get_current_user] = _as_user(
        ADMIN,
        PERM_AGENTS_READ,
        PERM_AGENTS_EXECUTE,
        PERM_AGENT_ACCESS_MANAGE,
    )
    assert api_client.get(f"/agents/{agent.id}", headers=headers(ADMIN)).status_code == 200


def test_admin_without_technical_cannot_read_configuration(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(db_session, ADMIN, can_view=True, can_configure=True, can_execute=True)
    admin_perms = ROLE_PERMISSIONS["Admin"]
    assert PERM_PLATFORM_TECHNICAL not in admin_perms
    api_client.app.dependency_overrides[get_current_user] = _as_user(ADMIN, *sorted(admin_perms))
    response = api_client.get("/agents/default/configuration", headers=headers(ADMIN))
    assert response.status_code == 403
    assert response.json()["detail"] == "Permission denied"
    assert api_client.get("/tools", headers=headers(ADMIN)).status_code == 403


def test_configure_grant_does_not_bypass_technical(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(db_session, USER, can_view=True, can_configure=True, can_execute=True)
    api_client.app.dependency_overrides[get_current_user] = _as_user(
        USER,
        PERM_AGENTS_READ,
        PERM_AGENTS_CONFIGURE,
        PERM_AGENTS_EXECUTE,
    )
    response = api_client.get("/agents/default/configuration", headers=headers(USER))
    assert response.status_code == 403


def test_activate_then_put_changes_effective_access(
    api_client: TestClient,
    db_session: Session,
) -> None:
    group = _make_group(db_session, "activate-group")
    _add_member(db_session, group.id, USER)
    api_client.app.dependency_overrides[get_current_user] = _as_user(
        ADMIN,
        *sorted(ALL_PERMISSIONS),
    )
    put = api_client.put(
        "/agents/default/access-config",
        json={
            "audience_mode": "groups",
            "owning_group_id": None,
            "group_ids": [str(group.id)],
        },
        headers=headers(ADMIN),
    )
    assert put.status_code == 200
    assert put.json()["audience_effective"] is False

    activate = api_client.post(
        "/agents/default/access-config/activate",
        headers=headers(ADMIN),
    )
    assert activate.status_code == 200
    assert activate.json()["authorization_mode"] == "audience"
    assert activate.json()["audience_effective"] is True

    seed_agent_grant(db_session, OTHER, can_view=True, can_configure=True, can_execute=True)
    api_client.app.dependency_overrides[get_current_user] = _as_user(
        OTHER,
        PERM_AGENTS_READ,
        PERM_AGENTS_EXECUTE,
    )
    assert api_client.get("/agents/default", headers=headers(OTHER)).status_code == 404

    api_client.app.dependency_overrides[get_current_user] = _as_user(
        USER,
        PERM_AGENTS_READ,
        PERM_AGENTS_EXECUTE,
    )
    assert api_client.get("/agents/default", headers=headers(USER)).status_code == 200

    api_client.app.dependency_overrides[get_current_user] = _as_user(
        ADMIN,
        *sorted(ALL_PERMISSIONS),
    )
    emptied = api_client.put(
        "/agents/default/access-config",
        json={
            "audience_mode": "groups",
            "owning_group_id": None,
            "group_ids": [],
        },
        headers=headers(ADMIN),
    )
    assert emptied.status_code == 200
    assert emptied.json()["audience_effective"] is True
    api_client.app.dependency_overrides[get_current_user] = _as_user(
        USER,
        PERM_AGENTS_READ,
        PERM_AGENTS_EXECUTE,
    )
    assert api_client.get("/agents/default", headers=headers(USER)).status_code == 404


def test_activate_requires_saved_audience(
    api_client: TestClient,
    db_session: Session,
) -> None:
    agent = agent_service.create_agent(
        db_session,
        agent_id="aud-activate-bad",
        name="Bad",
        description=None,
        created_by=ADMIN,
    )
    row = db_session.get(Agent, agent.id)
    assert row is not None
    row.authorization_mode = AgentAuthorizationMode.LEGACY_GRANTS.value
    row.audience_mode = None
    db_session.execute(
        delete(AgentGroupAssignment).where(AgentGroupAssignment.agent_id == agent.id),
    )
    db_session.commit()

    api_client.app.dependency_overrides[get_current_user] = _as_user(
        ADMIN,
        PERM_AGENT_ACCESS_MANAGE,
    )
    response = api_client.post(
        f"/agents/{agent.id}/access-config/activate",
        headers=headers(ADMIN),
    )
    assert response.status_code == 400


def test_new_agent_defaults_and_no_creator_grant(
    api_client: TestClient,
    db_session: Session,
) -> None:
    api_client.app.dependency_overrides[get_current_user] = _as_user(
        ADMIN,
        PERM_AGENTS_CONFIGURE,
        PERM_AGENT_ACCESS_MANAGE,
        PERM_AGENTS_READ,
    )
    created = api_client.post(
        "/agents",
        json={"id": "new-aud", "name": "New", "description": None},
        headers=headers(ADMIN),
    )
    assert created.status_code == 201
    row = db_session.get(Agent, "new-aud")
    assert row is not None
    assert row.authorization_mode == AgentAuthorizationMode.AUDIENCE.value
    assert row.audience_mode == AgentAudienceMode.GROUPS.value
    assert access_service.get_grant(db_session, user_id=ADMIN, agent_id="new-aud") is None

    api_client.app.dependency_overrides[get_current_user] = _as_user(
        USER,
        PERM_AGENTS_READ,
        PERM_AGENTS_EXECUTE,
    )
    assert api_client.get("/agents/new-aud", headers=headers(USER)).status_code == 404


def test_create_requires_manage(api_client: TestClient) -> None:
    api_client.app.dependency_overrides[get_current_user] = _as_user(
        ADMIN,
        PERM_AGENTS_CONFIGURE,
    )
    response = api_client.post(
        "/agents",
        json={"id": "need-manage", "name": "X", "description": None},
        headers=headers(ADMIN),
    )
    assert response.status_code == 403


def test_manage_does_not_bypass_session_ownership(
    api_client: TestClient,
    db_session: Session,
) -> None:
    agent = agent_service.create_agent(
        db_session,
        agent_id="aud-own",
        name="Own",
        description=None,
        created_by=ADMIN,
    )
    row = db_session.get(Agent, agent.id)
    assert row is not None
    row.audience_mode = AgentAudienceMode.COMPANY.value
    db_session.commit()

    api_client.app.dependency_overrides[get_current_user] = _as_user(
        USER,
        PERM_AGENTS_READ,
        PERM_AGENTS_EXECUTE,
    )
    created = api_client.post(
        "/sessions",
        json={"agent_id": agent.id},
        headers=headers(USER),
    )
    assert created.status_code == 201
    session_id = created.json()["id"]

    api_client.app.dependency_overrides[get_current_user] = _as_user(
        ADMIN,
        *sorted(ALL_PERMISSIONS),
    )
    assert api_client.get(f"/sessions/{session_id}", headers=headers(ADMIN)).status_code == 404


def test_archive_without_agent_access(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(db_session, USER)
    api_client.app.dependency_overrides[get_current_user] = _as_user(
        USER,
        PERM_AGENTS_READ,
        PERM_AGENTS_EXECUTE,
    )
    created = api_client.post(
        "/sessions",
        json={"agent_id": "default"},
        headers=headers(USER),
    )
    assert created.status_code == 201
    session_id = created.json()["id"]
    access_service.revoke_grant(db_session, user_id=USER, agent_id="default")
    assert api_client.delete(f"/sessions/{session_id}", headers=headers(USER)).status_code == 204


def test_unauthorized_approval_does_not_resume(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    agent = agent_service.create_agent(
        db_session,
        agent_id="aud-approval",
        name="Approval",
        description=None,
        created_by=ADMIN,
    )
    row = db_session.get(Agent, agent.id)
    assert row is not None
    row.audience_mode = AgentAudienceMode.COMPANY.value
    db_session.commit()

    api_client.app.dependency_overrides[get_current_user] = _as_user(
        USER,
        PERM_AGENTS_READ,
        PERM_AGENTS_EXECUTE,
    )
    created = api_client.post(
        "/sessions",
        json={"agent_id": agent.id},
        headers=headers(USER),
    )
    assert created.status_code == 201
    session_id = created.json()["id"]

    row.audience_mode = AgentAudienceMode.GROUPS.value
    db_session.commit()

    resume = MagicMock()
    monkeypatch.setattr("app.api.routes.sessions.resume_agent", resume)
    denied = api_client.post(
        f"/sessions/{session_id}/approvals/interrupt-1/approve",
        json={"tool_call_id": "call-1"},
        headers=headers(USER),
    )
    assert denied.status_code == 403
    resume.assert_not_called()
