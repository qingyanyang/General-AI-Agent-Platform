"""Platform RBAC: Auth0 permissions claim and require_permissions (#16)."""

from __future__ import annotations

import asyncio
from collections.abc import Generator
from typing import Any

import httpx
import pytest
from app.agents.runtime import AgentMessageView, AgentResult
from app.api.deps import require_permissions
from app.core.auth import AuthenticatedUser, parse_permissions_claim
from app.core.config import get_settings
from app.core.database import get_db
from app.core.permissions import (
    ALL_PERMISSIONS,
    PERM_AGENT_ACCESS_MANAGE,
    PERM_AGENTS_CONFIGURE,
    PERM_AGENTS_EXECUTE,
    PERM_AGENTS_READ,
    ROLE_PERMISSIONS,
)
from app.main import app
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pytest import MonkeyPatch
from sqlalchemy.orm import Session

from tests.auth_helpers import (
    AUTH0_AUDIENCE,
    AUTH0_DOMAIN,
    bearer_headers,
    generate_rsa_keypair,
    jwks_document,
    sign_access_token,
)
from tests.chat_helpers import seed_agent_grant


@pytest.fixture
def rsa_material() -> tuple[rsa.RSAPrivateKey, dict[str, Any]]:
    return generate_rsa_keypair()


@pytest.fixture
def rbac_client(
    db_session: Session,
    monkeypatch: MonkeyPatch,
    rsa_material: tuple[rsa.RSAPrivateKey, dict[str, Any]],
) -> Generator[tuple[TestClient, rsa.RSAPrivateKey], None, None]:
    private_key, jwk = rsa_material

    def _override_db() -> Generator[Session, None, None]:
        yield db_session

    async def _handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=jwks_document(jwk))

    transport = httpx.MockTransport(_handler)
    http_client = httpx.AsyncClient(transport=transport)

    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setenv("AUTH0_DOMAIN", AUTH0_DOMAIN)
    monkeypatch.setenv("AUTH0_AUDIENCE", AUTH0_AUDIENCE)
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    get_settings.cache_clear()
    app.dependency_overrides.clear()
    app.dependency_overrides[get_db] = _override_db
    with TestClient(app) as test_client:
        test_client.app.state.auth_http_client = http_client
        test_client.app.state.jwks_cache = None
        yield test_client, private_key
    asyncio.run(http_client.aclose())
    app.dependency_overrides.clear()
    get_settings.cache_clear()


def _token(
    private_key: rsa.RSAPrivateKey,
    *,
    subject: str = "auth0|user-1",
    permissions: list[str] | None = None,
    include_permissions: bool = True,
    extra_claims: dict[str, Any] | None = None,
) -> str:
    return sign_access_token(
        private_key,
        subject=subject,
        permissions=permissions,
        include_permissions=include_permissions,
        extra_claims=extra_claims,
    )


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (None, frozenset()),
        ("agents:read", frozenset()),
        ({"agents:read"}, frozenset()),
        ([""], frozenset()),
        (["agents:read", ""], frozenset()),
        (["agents:read", 1], frozenset()),
        (["agents:read", " agents:execute"], frozenset({"agents:read", " agents:execute"})),
        (["agents:read", "agents:execute"], frozenset({"agents:read", "agents:execute"})),
    ],
)
def test_parse_permissions_claim(raw: Any, expected: frozenset[str]) -> None:
    assert parse_permissions_claim(raw) == expected


def test_role_matrix_matches_documented_mapping() -> None:
    assert ROLE_PERMISSIONS["Admin"] == ALL_PERMISSIONS
    assert ROLE_PERMISSIONS["Agent Developer"] == frozenset(
        {PERM_AGENTS_READ, PERM_AGENTS_CONFIGURE, PERM_AGENTS_EXECUTE}
    )
    assert ROLE_PERMISSIONS["Agent User"] == frozenset({PERM_AGENTS_READ, PERM_AGENTS_EXECUTE})


def test_missing_permissions_claim_is_403(
    rbac_client: tuple[TestClient, rsa.RSAPrivateKey],
) -> None:
    client, private_key = rbac_client
    token = _token(private_key, include_permissions=False)
    response = client.post(
        "/sessions",
        json={"agent_id": "default"},
        headers=bearer_headers(token),
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Permission denied"


def test_invalid_permissions_element_fails_closed(
    rbac_client: tuple[TestClient, rsa.RSAPrivateKey],
) -> None:
    client, private_key = rbac_client
    token = _token(
        private_key,
        include_permissions=False,
        extra_claims={"permissions": ["agents:execute", ""]},
    )
    response = client.post(
        "/sessions",
        json={"agent_id": "default"},
        headers=bearer_headers(token),
    )
    assert response.status_code == 403


def test_execute_without_permission_is_403_not_401(
    rbac_client: tuple[TestClient, rsa.RSAPrivateKey],
) -> None:
    client, private_key = rbac_client
    token = _token(private_key, permissions=[PERM_AGENTS_READ])
    response = client.post(
        "/sessions",
        json={"agent_id": "default"},
        headers=bearer_headers(token),
    )
    assert response.status_code == 403
    assert "www-authenticate" not in {k.lower() for k in response.headers}


def test_read_without_permission_is_403(
    rbac_client: tuple[TestClient, rsa.RSAPrivateKey],
    db_session: Session,
) -> None:
    client, private_key = rbac_client
    seed_agent_grant(db_session, "auth0|user-1", can_view=False, can_execute=True)
    token = _token(private_key, permissions=[PERM_AGENTS_EXECUTE])
    created = client.post(
        "/sessions",
        json={"agent_id": "default"},
        headers=bearer_headers(token),
    )
    assert created.status_code == 201
    response = client.get("/sessions", headers=bearer_headers(token))
    assert response.status_code == 403


def test_agent_user_can_read_and_execute(
    rbac_client: tuple[TestClient, rsa.RSAPrivateKey],
    db_session: Session,
) -> None:
    client, private_key = rbac_client
    seed_agent_grant(db_session, "auth0|user-1")
    token = _token(
        private_key,
        permissions=sorted(ROLE_PERMISSIONS["Agent User"]),
    )
    headers = bearer_headers(token)
    created = client.post("/sessions", json={"agent_id": "default"}, headers=headers)
    assert created.status_code == 201
    listed = client.get("/sessions", headers=headers)
    assert listed.status_code == 200
    assert listed.json()["items"][0]["id"] == created.json()["id"]


def test_agent_developer_lacks_agent_access_manage() -> None:
    async def run() -> None:
        user = AuthenticatedUser(
            user_id="auth0|dev",
            permissions=ROLE_PERMISSIONS["Agent Developer"],
        )
        check = require_permissions(PERM_AGENT_ACCESS_MANAGE)
        with pytest.raises(HTTPException) as exc_info:
            await check(user=user)
        assert exc_info.value.status_code == 403
        assert exc_info.value.detail == "Permission denied"

    asyncio.run(run())


def test_require_permissions_requires_all() -> None:
    async def run() -> None:
        check = require_permissions(PERM_AGENTS_READ, PERM_AGENTS_CONFIGURE)
        partial = AuthenticatedUser(
            user_id="auth0|partial",
            permissions=frozenset({PERM_AGENTS_READ}),
        )
        with pytest.raises(HTTPException) as exc_info:
            await check(user=partial)
        assert exc_info.value.status_code == 403

        full = AuthenticatedUser(
            user_id="auth0|full",
            permissions=frozenset({PERM_AGENTS_READ, PERM_AGENTS_CONFIGURE}),
        )
        assert await check(user=full) is full

    asyncio.run(run())


def test_admin_still_404_for_other_users_session(
    rbac_client: tuple[TestClient, rsa.RSAPrivateKey],
    db_session: Session,
) -> None:
    client, private_key = rbac_client
    seed_agent_grant(db_session, "auth0|owner")
    seed_agent_grant(db_session, "auth0|admin")
    owner = bearer_headers(
        _token(
            private_key,
            subject="auth0|owner",
            permissions=sorted(ROLE_PERMISSIONS["Admin"]),
        )
    )
    admin = bearer_headers(
        _token(
            private_key,
            subject="auth0|admin",
            permissions=sorted(ROLE_PERMISSIONS["Admin"]),
        )
    )
    created = client.post("/sessions", json={"agent_id": "default"}, headers=owner)
    assert created.status_code == 201
    session_id = created.json()["id"]
    response = client.get(f"/sessions/{session_id}", headers=admin)
    assert response.status_code == 404


def test_configure_permission_unwired_but_enforced() -> None:
    async def run() -> None:
        user = AuthenticatedUser(
            user_id="auth0|user",
            permissions=ROLE_PERMISSIONS["Agent User"],
        )
        check = require_permissions(PERM_AGENTS_CONFIGURE)
        with pytest.raises(HTTPException) as exc_info:
            await check(user=user)
        assert exc_info.value.status_code == 403

    asyncio.run(run())


def test_agents_run_requires_execute(
    rbac_client: tuple[TestClient, rsa.RSAPrivateKey],
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    client, private_key = rbac_client
    seed_agent_grant(db_session, "auth0|user-1")

    async def fake_run(message: str, **kwargs: Any) -> AgentResult:
        return AgentResult(
            reply="ok",
            execution_id="11111111-1111-4111-8111-111111111111",
            messages=[AgentMessageView(role="assistant", content="ok")],
        )

    monkeypatch.setattr("app.api.routes.agents.run_agent", fake_run)
    denied = client.post(
        "/agents/run",
        json={"message": "hello"},
        headers=bearer_headers(_token(private_key, permissions=[PERM_AGENTS_READ])),
    )
    assert denied.status_code == 403
    allowed = client.post(
        "/agents/run",
        json={"message": "hello"},
        headers=bearer_headers(
            _token(private_key, permissions=sorted(ROLE_PERMISSIONS["Agent User"]))
        ),
    )
    assert allowed.status_code == 200
