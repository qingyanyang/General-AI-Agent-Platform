"""Groups and Member/Leader designations."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from uuid import UUID, uuid4

from app.api.deps import get_current_user
from app.core.auth import AuthenticatedUser
from app.core.permissions import (
    ALL_PERMISSIONS,
    PERM_AGENT_ACCESS_MANAGE,
    PERM_AGENTS_CONFIGURE,
    PERM_AGENTS_EXECUTE,
    PERM_AGENTS_READ,
)
from app.models.directory_user import DirectoryUser
from app.models.group import GroupDesignation, GroupMembership
from app.schemas.groups import GROUP_DESCRIPTION_MAX_LENGTH
from app.services import groups as groups_service
from fastapi import Request
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.auth_helpers import stub_get_current_user
from tests.chat_helpers import headers, seed_agent_grant

ADMIN = "auth0|admin"
LEADER = "auth0|leader"
MEMBER = "auth0|member"
OTHER = "auth0|other"
DEVELOPER = "auth0|developer"


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


def _create_group(api_client: TestClient, name: str = "Ops") -> str:
    response = api_client.post(
        "/groups",
        json={"name": name, "description": "ops group"},
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


def test_create_group_allows_zero_leaders(
    api_client: TestClient,
    db_session: Session,
) -> None:
    _seed_directory(db_session, ADMIN)
    group_id = _create_group(api_client, "Empty Leaders")
    roster = api_client.get(
        f"/groups/{group_id}/memberships",
        headers=headers(ADMIN),
    )
    assert roster.status_code == 200, roster.text
    assert roster.json()["items"] == []


def test_user_can_lead_one_group_and_member_another(
    api_client: TestClient,
    db_session: Session,
) -> None:
    _seed_directory(db_session, ADMIN, LEADER)
    group_a = _create_group(api_client, "Group A")
    group_b = _create_group(api_client, "Group B")
    _put_membership(api_client, group_a, LEADER, GroupDesignation.LEADER.value)
    _put_membership(api_client, group_b, LEADER, GroupDesignation.MEMBER.value)

    api_client.app.dependency_overrides[get_current_user] = _as_user(
        LEADER,
        PERM_AGENTS_READ,
        PERM_AGENTS_EXECUTE,
    )
    try:
        listed = api_client.get("/groups", headers=headers(LEADER))
        assert listed.status_code == 200, listed.text
        by_id = {item["id"]: item["designation"] for item in listed.json()["items"]}
        assert by_id[group_a] == "leader"
        assert by_id[group_b] == "member"
    finally:
        api_client.app.dependency_overrides[get_current_user] = stub_get_current_user


def test_membership_unique_per_user_and_group(
    api_client: TestClient,
    db_session: Session,
) -> None:
    _seed_directory(db_session, ADMIN, MEMBER)
    group_id = _create_group(api_client)
    _put_membership(api_client, group_id, MEMBER, GroupDesignation.MEMBER.value)
    _put_membership(api_client, group_id, MEMBER, GroupDesignation.MEMBER.value)

    rows = (
        db_session.query(GroupMembership)
        .filter(
            GroupMembership.group_id == UUID(group_id),
            GroupMembership.user_id == MEMBER,
        )
        .all()
    )
    assert len(rows) == 1
    assert rows[0].designation == "member"


def test_unknown_directory_subject_is_404(
    api_client: TestClient,
    db_session: Session,
) -> None:
    _seed_directory(db_session, ADMIN)
    group_id = _create_group(api_client)
    response = api_client.put(
        f"/groups/{group_id}/memberships",
        json={"user_id": "auth0|missing", "designation": "member"},
        headers=headers(ADMIN),
    )
    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "Directory user not found"


def test_leader_can_read_own_roster_but_not_write(
    api_client: TestClient,
    db_session: Session,
) -> None:
    _seed_directory(db_session, ADMIN, LEADER, MEMBER)
    group_id = _create_group(api_client)
    _put_membership(api_client, group_id, LEADER, GroupDesignation.LEADER.value)
    _put_membership(api_client, group_id, MEMBER, GroupDesignation.MEMBER.value)

    api_client.app.dependency_overrides[get_current_user] = _as_user(
        LEADER,
        PERM_AGENTS_READ,
        PERM_AGENTS_EXECUTE,
    )
    try:
        roster = api_client.get(
            f"/groups/{group_id}/memberships",
            headers=headers(LEADER),
        )
        assert roster.status_code == 200, roster.text
        subjects = {item["user_id"] for item in roster.json()["items"]}
        assert subjects == {LEADER, MEMBER}

        add = api_client.put(
            f"/groups/{group_id}/memberships",
            json={"user_id": OTHER, "designation": "member"},
            headers=headers(LEADER),
        )
        assert add.status_code == 403, add.text

        promote = api_client.put(
            f"/groups/{group_id}/memberships",
            json={"user_id": MEMBER, "designation": "leader"},
            headers=headers(LEADER),
        )
        assert promote.status_code == 403, promote.text

        demote = api_client.put(
            f"/groups/{group_id}/memberships",
            json={"user_id": LEADER, "designation": "member"},
            headers=headers(LEADER),
        )
        assert demote.status_code == 403, demote.text

        remove = api_client.delete(
            f"/groups/{group_id}/memberships/{MEMBER}",
            headers=headers(LEADER),
        )
        assert remove.status_code == 403, remove.text
    finally:
        api_client.app.dependency_overrides[get_current_user] = stub_get_current_user


def test_leader_cannot_access_other_group(
    api_client: TestClient,
    db_session: Session,
) -> None:
    _seed_directory(db_session, ADMIN, LEADER, MEMBER)
    group_a = _create_group(api_client, "Led")
    group_b = _create_group(api_client, "Other")
    _put_membership(api_client, group_a, LEADER, GroupDesignation.LEADER.value)
    _put_membership(api_client, group_b, MEMBER, GroupDesignation.MEMBER.value)

    api_client.app.dependency_overrides[get_current_user] = _as_user(
        LEADER,
        PERM_AGENTS_READ,
        PERM_AGENTS_EXECUTE,
    )
    try:
        assert api_client.get(f"/groups/{group_b}", headers=headers(LEADER)).status_code == 404
        assert (
            api_client.get(
                f"/groups/{group_b}/memberships",
                headers=headers(LEADER),
            ).status_code
            == 404
        )
        assert (
            api_client.put(
                f"/groups/{group_b}/memberships",
                json={"user_id": MEMBER, "designation": "member"},
                headers=headers(LEADER),
            ).status_code
            == 404
        )
        assert (
            api_client.delete(
                f"/groups/{group_b}/memberships/{MEMBER}",
                headers=headers(LEADER),
            ).status_code
            == 404
        )
    finally:
        api_client.app.dependency_overrides[get_current_user] = stub_get_current_user


def test_member_reads_own_group_but_not_roster(
    api_client: TestClient,
    db_session: Session,
) -> None:
    _seed_directory(db_session, ADMIN, MEMBER)
    group_id = _create_group(api_client)
    _put_membership(api_client, group_id, MEMBER, GroupDesignation.MEMBER.value)

    api_client.app.dependency_overrides[get_current_user] = _as_user(
        MEMBER,
        PERM_AGENTS_READ,
        PERM_AGENTS_EXECUTE,
    )
    try:
        detail = api_client.get(f"/groups/{group_id}", headers=headers(MEMBER))
        assert detail.status_code == 200, detail.text
        assert detail.json()["designation"] == "member"

        roster = api_client.get(
            f"/groups/{group_id}/memberships",
            headers=headers(MEMBER),
        )
        assert roster.status_code == 403, roster.text
    finally:
        api_client.app.dependency_overrides[get_current_user] = stub_get_current_user


def test_agent_developer_cannot_administer_groups(
    api_client: TestClient,
    db_session: Session,
) -> None:
    _seed_directory(db_session, ADMIN, DEVELOPER)
    group_id = _create_group(api_client)

    api_client.app.dependency_overrides[get_current_user] = _as_user(
        DEVELOPER,
        PERM_AGENTS_READ,
        PERM_AGENTS_CONFIGURE,
        PERM_AGENTS_EXECUTE,
    )
    try:
        create = api_client.post(
            "/groups",
            json={"name": "Dev Group"},
            headers=headers(DEVELOPER),
        )
        assert create.status_code == 403, create.text

        write = api_client.put(
            f"/groups/{group_id}/memberships",
            json={"user_id": DEVELOPER, "designation": "member"},
            headers=headers(DEVELOPER),
        )
        assert write.status_code == 404, write.text
    finally:
        api_client.app.dependency_overrides[get_current_user] = stub_get_current_user


def test_manager_can_add_update_and_remove_including_last_leader(
    api_client: TestClient,
    db_session: Session,
) -> None:
    _seed_directory(db_session, ADMIN, LEADER, MEMBER)
    group_id = _create_group(api_client)

    created = api_client.put(
        f"/groups/{group_id}/memberships",
        json={"user_id": LEADER, "designation": "leader"},
        headers=headers(ADMIN),
    )
    assert created.status_code == 200, created.text
    assert created.json()["designation"] == "leader"

    promoted = api_client.put(
        f"/groups/{group_id}/memberships",
        json={"user_id": MEMBER, "designation": "member"},
        headers=headers(ADMIN),
    )
    assert promoted.status_code == 200, promoted.text

    updated = api_client.put(
        f"/groups/{group_id}/memberships",
        json={"user_id": MEMBER, "designation": "leader"},
        headers=headers(ADMIN),
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["designation"] == "leader"

    demoted = api_client.put(
        f"/groups/{group_id}/memberships",
        json={"user_id": MEMBER, "designation": "member"},
        headers=headers(ADMIN),
    )
    assert demoted.status_code == 200, demoted.text
    assert demoted.json()["designation"] == "member"

    removed_member = api_client.delete(
        f"/groups/{group_id}/memberships/{MEMBER}",
        headers=headers(ADMIN),
    )
    assert removed_member.status_code == 204, removed_member.text

    removed_last_leader = api_client.delete(
        f"/groups/{group_id}/memberships/{LEADER}",
        headers=headers(ADMIN),
    )
    assert removed_last_leader.status_code == 204, removed_last_leader.text

    roster = api_client.get(
        f"/groups/{group_id}/memberships",
        headers=headers(ADMIN),
    )
    assert roster.status_code == 200, roster.text
    assert roster.json()["items"] == []


def test_manager_lists_all_groups_with_optional_designation(
    api_client: TestClient,
    db_session: Session,
) -> None:
    _seed_directory(db_session, ADMIN, MEMBER)
    group_a = _create_group(api_client, "Alpha")
    group_b = _create_group(api_client, "Beta")
    _put_membership(api_client, group_a, ADMIN, GroupDesignation.MEMBER.value)

    listed = api_client.get("/groups", headers=headers(ADMIN))
    assert listed.status_code == 200, listed.text
    by_id = {item["id"]: item for item in listed.json()["items"]}
    assert by_id[group_a]["designation"] == "member"
    assert by_id[group_b]["designation"] is None


def test_duplicate_group_name_is_409(
    api_client: TestClient,
    db_session: Session,
) -> None:
    _seed_directory(db_session, ADMIN)
    assert _create_group(api_client, "Unique Name")
    conflict = api_client.post(
        "/groups",
        json={"name": "  Unique Name  "},
        headers=headers(ADMIN),
    )
    assert conflict.status_code == 409, conflict.text


def test_group_description_normalized_and_bounded(
    api_client: TestClient,
    db_session: Session,
) -> None:
    _seed_directory(db_session, ADMIN)
    blank = api_client.post(
        "/groups",
        json={"name": "Blank Desc", "description": "   "},
        headers=headers(ADMIN),
    )
    assert blank.status_code == 201, blank.text
    assert blank.json()["description"] is None

    trimmed = api_client.post(
        "/groups",
        json={"name": "Trim Desc", "description": "  hello  "},
        headers=headers(ADMIN),
    )
    assert trimmed.status_code == 201, trimmed.text
    assert trimmed.json()["description"] == "hello"

    too_long = api_client.post(
        "/groups",
        json={
            "name": "Long Desc",
            "description": "x" * (GROUP_DESCRIPTION_MAX_LENGTH + 1),
        },
        headers=headers(ADMIN),
    )
    assert too_long.status_code == 422, too_long.text


def test_missing_group_and_membership_are_404(
    api_client: TestClient,
    db_session: Session,
) -> None:
    _seed_directory(db_session, ADMIN, MEMBER)
    missing = uuid4()
    assert api_client.get(f"/groups/{missing}", headers=headers(ADMIN)).status_code == 404
    group_id = _create_group(api_client)
    deleted = api_client.delete(
        f"/groups/{group_id}/memberships/{MEMBER}",
        headers=headers(ADMIN),
    )
    assert deleted.status_code == 404, deleted.text


def test_membership_does_not_authorize_legacy_default_agent(
    api_client: TestClient,
    db_session: Session,
) -> None:
    """Group membership alone does not authorize legacy_grants Agents."""
    _seed_directory(db_session, ADMIN, MEMBER)
    group_id = _create_group(api_client)
    _put_membership(api_client, group_id, MEMBER, GroupDesignation.MEMBER.value)

    api_client.app.dependency_overrides[get_current_user] = _as_user(
        MEMBER,
        PERM_AGENTS_READ,
        PERM_AGENTS_EXECUTE,
    )
    try:
        agents = api_client.get("/agents", headers=headers(MEMBER))
        assert agents.status_code == 200, agents.text
        assert agents.json()["items"] == []

        session = api_client.post(
            "/sessions",
            json={"agent_id": "default"},
            headers=headers(MEMBER),
        )
        assert session.status_code == 403, session.text
    finally:
        api_client.app.dependency_overrides[get_current_user] = stub_get_current_user

    seed_agent_grant(db_session, MEMBER, can_view=True, can_execute=True)
    api_client.app.dependency_overrides[get_current_user] = _as_user(
        MEMBER,
        PERM_AGENTS_READ,
        PERM_AGENTS_EXECUTE,
    )
    try:
        agents = api_client.get("/agents", headers=headers(MEMBER))
        assert agents.status_code == 200, agents.text
        assert any(item["id"] == "default" for item in agents.json()["items"])

        session = api_client.post(
            "/sessions",
            json={"agent_id": "default"},
            headers=headers(MEMBER),
        )
        assert session.status_code == 201, session.text
    finally:
        api_client.app.dependency_overrides[get_current_user] = stub_get_current_user


def test_idempotent_same_designation_and_manager_permissions(
    api_client: TestClient,
    db_session: Session,
) -> None:
    _seed_directory(db_session, ADMIN, MEMBER)
    group_id = _create_group(api_client)
    first = api_client.put(
        f"/groups/{group_id}/memberships",
        json={"user_id": MEMBER, "designation": "member"},
        headers=headers(ADMIN),
    )
    second = api_client.put(
        f"/groups/{group_id}/memberships",
        json={"user_id": MEMBER, "designation": "member"},
        headers=headers(ADMIN),
    )
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["designation"] == second.json()["designation"] == "member"
    assert set(ALL_PERMISSIONS) >= {PERM_AGENT_ACCESS_MANAGE}


def test_service_rejects_invalid_cursor(db_session: Session) -> None:
    try:
        groups_service.list_groups_for_caller(
            db_session,
            caller_user_id=ADMIN,
            permissions={PERM_AGENT_ACCESS_MANAGE},
            limit=10,
            cursor="not-a-cursor",
        )
    except groups_service.GroupValidationError:
        return
    raise AssertionError("expected GroupValidationError")
