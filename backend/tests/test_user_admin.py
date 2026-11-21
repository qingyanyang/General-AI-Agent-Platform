"""Directory invitations resolve one Auth0 account per email."""

from __future__ import annotations

from datetime import UTC, datetime

from app.api.deps import get_current_user
from app.core.auth import AuthenticatedUser, profile_from_access_claims
from app.core.permissions import PERM_AGENT_ACCESS_MANAGE, PERM_PLATFORM_TECHNICAL
from app.models.directory_user import DirectoryUser
from app.models.group import Group, GroupMembership
from app.services.auth0_management import Auth0Account, Auth0IdentityConflict, Auth0NotConfigured
from app.services.user_admin import UserAdminError, invite_user, list_users
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

AUDIENCE = "https://api.agent-platform"


class FakeDirectory:
    def __init__(self, accounts: list[Auth0Account] | None = None) -> None:
        self.accounts = list(accounts or [])
        self.created: list[str] = []
        self.roles: list[tuple[str, str]] = []
        self.platform_roles: dict[str, str] = {}

    def find_by_email(self, email: str) -> list[Auth0Account]:
        return [account for account in self.accounts if account.email == email]

    def lookup_account(self, user_id: str) -> tuple[bool, Auth0Account | None]:
        for account in self.accounts:
            if account.user_id == user_id:
                return True, account
        return False, None

    def get_account(self, user_id: str) -> Auth0Account | None:
        present, account = self.lookup_account(user_id)
        if not present:
            return None
        return account

    def platform_role(self, user_id: str) -> str | None:
        return self.platform_roles.get(user_id)

    def create_user(self, email: str) -> Auth0Account:
        self.created.append(email)
        account = Auth0Account(
            user_id=f"auth0|{email}",
            email=email,
            email_verified=False,
            name=None,
        )
        self.accounts.append(account)
        return account

    def assign_role(self, user_id: str, role: str) -> None:
        self.roles.append((user_id, role))
        self.platform_roles[user_id] = role

    def close(self) -> None:
        return None


def test_profile_claims_keep_email_only_when_verified() -> None:
    email, name, verified = profile_from_access_claims(
        {
            f"{AUDIENCE}/email": "Ada@Example.com",
            f"{AUDIENCE}/email_verified": True,
            f"{AUDIENCE}/name": "Ada Lovelace",
        },
        AUDIENCE,
    )
    assert email == "ada@example.com"
    assert name == "Ada Lovelace"
    assert verified is True

    hidden, _, unverified = profile_from_access_claims(
        {"email": "ada@example.com", "email_verified": False},
        AUDIENCE,
    )
    assert hidden is None
    assert unverified is False


def test_invite_creates_a_pending_user_and_optional_membership(
    db_session: Session,
) -> None:
    now = datetime.now(UTC)
    group = Group(name="Finance", description=None, created_at=now, updated_at=now)
    db_session.add(group)
    db_session.commit()
    directory = FakeDirectory()
    row = invite_user(
        db_session,
        directory=directory,
        caller_user_id="auth0|admin",
        permissions=frozenset({PERM_AGENT_ACCESS_MANAGE}),
        email="New.Person@example.com",
        role="user",
        group_id=group.id,
    )
    assert row.user_id == "auth0|new.person@example.com"
    assert row.status == "pending"
    assert row.email == "new.person@example.com"
    assert directory.roles == [(row.user_id, "user")]
    membership = db_session.scalars(
        select(GroupMembership).where(GroupMembership.user_id == row.user_id),
    ).one()
    assert membership.group_id == group.id


def test_invite_reuses_the_one_linked_account(db_session: Session) -> None:
    directory = FakeDirectory(
        [
            Auth0Account(
                user_id="google-oauth2|primary",
                email="ada@example.com",
                email_verified=True,
                name="Ada",
            ),
        ],
    )
    row = invite_user(
        db_session,
        directory=directory,
        caller_user_id="auth0|admin",
        permissions=frozenset({PERM_AGENT_ACCESS_MANAGE, PERM_PLATFORM_TECHNICAL}),
        email="ada@example.com",
        role="admin",
        group_id=None,
    )
    assert row.user_id == "google-oauth2|primary"
    assert row.status == "active"
    assert row.role == "admin"
    assert directory.created == []


def test_invite_refuses_duplicate_auth0_users(db_session: Session) -> None:
    directory = FakeDirectory(
        [
            Auth0Account("auth0|a", "ada@example.com", False, None),
            Auth0Account("google-oauth2|b", "ada@example.com", True, None),
        ],
    )
    try:
        invite_user(
            db_session,
            directory=directory,
            caller_user_id="auth0|admin",
            permissions=frozenset({PERM_AGENT_ACCESS_MANAGE}),
            email="ada@example.com",
            role="user",
            group_id=None,
        )
    except Auth0IdentityConflict as exc:
        assert "Link them" in str(exc)
    else:
        raise AssertionError("expected a conflict")


def test_super_admin_role_requires_platform_technical(db_session: Session) -> None:
    try:
        invite_user(
            db_session,
            directory=FakeDirectory(),
            caller_user_id="auth0|admin",
            permissions=frozenset({PERM_AGENT_ACCESS_MANAGE}),
            email="boss@example.com",
            role="super-admin",
            group_id=None,
        )
    except UserAdminError as exc:
        assert exc.status_code == 403
    else:
        raise AssertionError("expected a forbidden role assignment")


def test_list_users_matches_email(db_session: Session, monkeypatch) -> None:
    def _not_configured() -> FakeDirectory:
        raise Auth0NotConfigured("skip")

    monkeypatch.setattr("app.services.user_admin.open_auth0_directory", _not_configured)
    now = datetime.now(UTC)
    db_session.add(
        DirectoryUser(
            user_id="auth0|ada",
            email="ada@example.com",
            display_name="Ada",
            email_verified=True,
            role="user",
            status="active",
            first_seen_at=now,
            last_seen_at=now,
        ),
    )
    db_session.commit()
    page = list_users(db_session, query="ada@", cursor=None)
    assert [item.user_id for item in page.items] == ["auth0|ada"]


def test_list_users_fills_name_email_and_role_from_auth0(db_session: Session, monkeypatch) -> None:
    now = datetime.now(UTC)
    db_session.add(
        DirectoryUser(
            user_id="auth0|ada",
            email=None,
            display_name=None,
            email_verified=False,
            role=None,
            status="active",
            first_seen_at=now,
            last_seen_at=now,
        ),
    )
    db_session.commit()
    directory = FakeDirectory(
        [
            Auth0Account(
                user_id="auth0|ada",
                email="ada@example.com",
                email_verified=True,
                name="Ada Lovelace",
            ),
        ],
    )
    directory.platform_roles["auth0|ada"] = "admin"
    monkeypatch.setattr("app.services.user_admin.open_auth0_directory", lambda: directory)
    page = list_users(db_session, query=None, cursor=None)
    assert len(page.items) == 1
    assert page.items[0].email == "ada@example.com"
    assert page.items[0].display_name == "Ada Lovelace"
    assert page.items[0].role == "admin"


def test_list_users_drops_subs_missing_from_auth0_after_link(
    db_session: Session,
    monkeypatch,
) -> None:
    """Linked-away secondary identities 404 in Auth0; prune their directory rows."""
    now = datetime.now(UTC)
    primary = DirectoryUser(
        user_id="google-oauth2|primary",
        email="ada@example.com",
        display_name="Ada",
        email_verified=True,
        role="admin",
        status="active",
        first_seen_at=now,
        last_seen_at=now,
    )
    orphan = DirectoryUser(
        user_id="auth0|secondary",
        email=None,
        display_name=None,
        email_verified=False,
        role=None,
        status="active",
        first_seen_at=now,
        last_seen_at=now,
    )
    db_session.add_all([primary, orphan])
    db_session.commit()
    group = Group(name="Ops", description=None, created_at=now, updated_at=now)
    db_session.add(group)
    db_session.commit()
    db_session.add(
        GroupMembership(
            group_id=group.id,
            user_id=orphan.user_id,
            designation="member",
        ),
    )
    db_session.commit()
    directory = FakeDirectory(
        [
            Auth0Account(
                user_id="google-oauth2|primary",
                email="ada@example.com",
                email_verified=True,
                name="Ada",
            ),
        ],
    )
    monkeypatch.setattr("app.services.user_admin.open_auth0_directory", lambda: directory)
    page = list_users(db_session, query=None, cursor=None)
    assert [item.user_id for item in page.items] == ["google-oauth2|primary"]
    assert db_session.get(DirectoryUser, "auth0|secondary") is None
    assert (
        db_session.scalars(
            select(GroupMembership).where(GroupMembership.user_id == "auth0|secondary"),
        ).first()
        is None
    )


def test_admin_directory_filters_super_admins_across_search_and_pages(
    api_client: TestClient, db_session: Session, monkeypatch,
) -> None:
    now = datetime.now(UTC)
    for name, role in [
        ("alice", "user"),
        ("bob", None),
        ("carol", "admin"),
        ("dana", "super-admin"),
        ("erin", "user"),
    ]:
        db_session.add(
            DirectoryUser(
                user_id=f"auth0|{name}",
                email=f"{name}@example.com",
                display_name=name,
                role=role,
                first_seen_at=now,
                last_seen_at=now,
            ),
        )
    db_session.commit()
    directory = FakeDirectory()
    directory.platform_roles["auth0|bob"] = "super-admin"
    monkeypatch.setattr("app.services.user_admin.open_auth0_directory", lambda: directory)

    admin = {PERM_AGENT_ACCESS_MANAGE}
    first = list_users(db_session, query=None, cursor=None, permissions=admin, limit=2)
    assert [row.user_id for row in first.items] == ["auth0|alice", "auth0|carol"]
    assert first.next_cursor == "auth0|carol"

    second = list_users(db_session, query=None, cursor=first.next_cursor, permissions=admin, limit=2)
    assert [row.user_id for row in second.items] == ["auth0|erin"]
    assert second.next_cursor is None
    assert not list_users(db_session, query="dana@", cursor=None, permissions=admin).items

    everyone = list_users(
        db_session, query=None, cursor=None, permissions=admin | {PERM_PLATFORM_TECHNICAL},
    )
    assert len(everyone.items) == 5

    monkeypatch.setitem(
        api_client.app.dependency_overrides,
        get_current_user,
        lambda: AuthenticatedUser(user_id="auth0|carol", permissions=frozenset(admin)),
    )
    response = api_client.get("/users")
    assert response.status_code == 200
    assert {row["user_id"] for row in response.json()["items"]} == {
        "auth0|alice", "auth0|carol", "auth0|erin",
    }
    for suffix in ("", "/access", "/executions"):
        assert api_client.get(f"/users/auth0%7Cdana{suffix}").status_code == 404

    response = api_client.get("/users", params={"role": "user"})
    assert response.status_code == 200
    assert [row["user_id"] for row in response.json()["items"]] == ["auth0|alice", "auth0|erin"]

    group = Group(name="Support")
    db_session.add(group)
    db_session.flush()
    db_session.add(GroupMembership(group_id=group.id, user_id="auth0|alice", designation="member"))
    db_session.commit()

    response = api_client.get("/users", params={"role": "user", "exclude_group_id": str(group.id)})
    assert response.status_code == 200
    assert [row["user_id"] for row in response.json()["items"]] == ["auth0|erin"]
