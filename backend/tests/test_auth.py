"""Auth0 access-token validation and protected-route enforcement."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Generator
from typing import Any

import httpx
import jwt
import pytest
from app.agents.runtime import AgentMessageView, AgentResult
from app.api.deps import get_current_user_id
from app.core.auth import (
    AuthNotConfigured,
    AuthRejected,
    AuthUnavailable,
    JwksCache,
    normalize_auth0_domain,
    verify_access_token,
)
from app.core.config import get_settings
from app.main import app
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage
from pytest import MonkeyPatch
from sqlalchemy.orm import Session

from tests.auth_helpers import (
    AUTH0_AUDIENCE,
    AUTH0_DOMAIN,
    AUTH0_ISSUER,
    bearer_headers,
    generate_rsa_keypair,
    jwks_document,
    sign_access_token,
)
from tests.fakes import ScriptedChatModel


@pytest.fixture
def rsa_material() -> tuple[rsa.RSAPrivateKey, dict[str, Any]]:
    return generate_rsa_keypair()


AuthClientBundle = tuple[TestClient, rsa.RSAPrivateKey, dict[str, Any], list[dict[str, Any]]]


@pytest.fixture
def auth_api_client(
    db_session: Session,
    monkeypatch: MonkeyPatch,
    rsa_material: tuple[rsa.RSAPrivateKey, dict[str, Any]],
) -> Generator[AuthClientBundle, None, None]:
    """Client without the X-User-Id stub; JWKS is served from memory."""
    private_key, jwk = rsa_material
    fetch_log: list[dict[str, Any]] = []

    def _override_db() -> Generator[Session, None, None]:
        yield db_session

    async def _handler(request: httpx.Request) -> httpx.Response:
        fetch_log.append({"url": str(request.url), "method": request.method})
        assert str(request.url) == f"https://{AUTH0_DOMAIN}/.well-known/jwks.json"
        return httpx.Response(200, json=jwks_document(jwk))

    transport = httpx.MockTransport(_handler)
    client = httpx.AsyncClient(transport=transport)

    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setenv("AUTH0_DOMAIN", AUTH0_DOMAIN)
    monkeypatch.setenv("AUTH0_AUDIENCE", AUTH0_AUDIENCE)
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    get_settings.cache_clear()
    app.dependency_overrides.clear()
    from app.core.database import get_db

    app.dependency_overrides[get_db] = _override_db
    with TestClient(app) as test_client:
        test_client.app.state.auth_http_client = client
        test_client.app.state.jwks_cache = None
        yield test_client, private_key, jwk, fetch_log
    asyncio.run(client.aclose())
    app.dependency_overrides.clear()
    get_settings.cache_clear()


def _token(
    private_key: rsa.RSAPrivateKey,
    **kwargs: Any,
) -> str:
    return sign_access_token(private_key, **kwargs)


def test_normalize_auth0_domain_rejects_non_hostnames() -> None:
    for value in (
        "https://auth.test.example",
        "auth.test.example/path",
        "auth.test.example?x=1",
        "auth.test.example#frag",
        "user@auth.test.example",
        "auth.test.example:443",
        "",
        "   ",
        "localhost",
    ):
        with pytest.raises(AuthNotConfigured):
            normalize_auth0_domain(value)
    assert normalize_auth0_domain("Dev-PF7WI26TB5BJ8QXZ.us.auth0.com") == (
        "dev-pf7wi26tb5bj8qxz.us.auth0.com"
    )


def test_missing_auth_config_returns_503(
    api_client: TestClient,
    monkeypatch: MonkeyPatch,
) -> None:
    app.dependency_overrides.pop(get_current_user_id, None)
    monkeypatch.setenv("AUTH0_DOMAIN", "")
    monkeypatch.setenv("AUTH0_AUDIENCE", "")
    get_settings.cache_clear()
    response = api_client.post("/sessions", json={"agent_id": "default"})
    assert response.status_code == 503
    assert "not configured" in response.json()["detail"].lower()


def test_invalid_auth_domain_returns_503(
    api_client: TestClient,
    monkeypatch: MonkeyPatch,
) -> None:
    app.dependency_overrides.pop(get_current_user_id, None)
    monkeypatch.setenv("AUTH0_DOMAIN", "https://auth.test.example")
    monkeypatch.setenv("AUTH0_AUDIENCE", AUTH0_AUDIENCE)
    get_settings.cache_clear()
    response = api_client.post(
        "/sessions",
        json={"agent_id": "default"},
        headers={"Authorization": "Bearer irrelevant"},
    )
    assert response.status_code == 503


@pytest.mark.parametrize(
    ("path", "method", "json_body"),
    [
        ("/sessions", "POST", {"agent_id": "default"}),
        ("/sessions", "GET", None),
        ("/agents/run", "POST", {"message": "hello"}),
    ],
)
def test_missing_bearer_returns_401_with_www_authenticate(
    auth_api_client: tuple[TestClient, rsa.RSAPrivateKey, dict[str, Any], list[dict[str, Any]]],
    path: str,
    method: str,
    json_body: dict[str, Any] | None,
) -> None:
    client, _private_key, _jwk, fetch_log = auth_api_client
    response = client.request(method, path, json=json_body)
    assert response.status_code == 401
    assert response.headers.get("www-authenticate") == "Bearer"
    assert fetch_log == []


def test_x_user_id_cannot_bypass_or_override_token(
    auth_api_client: tuple[TestClient, rsa.RSAPrivateKey, dict[str, Any], list[dict[str, Any]]],
) -> None:
    client, private_key, _jwk, _fetch_log = auth_api_client
    token = _token(private_key, subject="auth0|token-user")
    response = client.post(
        "/sessions",
        json={"agent_id": "default"},
        headers=bearer_headers(token, extra={"X-User-Id": "spoofed-user"}),
    )
    assert response.status_code == 201
    assert response.json()["user_id"] == "auth0|token-user"


def test_valid_token_creates_session_owned_by_sub(
    auth_api_client: tuple[TestClient, rsa.RSAPrivateKey, dict[str, Any], list[dict[str, Any]]],
) -> None:
    client, private_key, _jwk, fetch_log = auth_api_client
    token = _token(private_key, subject="auth0|owner")
    response = client.post(
        "/sessions",
        json={"agent_id": "default"},
        headers=bearer_headers(token),
    )
    assert response.status_code == 201
    assert response.json()["user_id"] == "auth0|owner"
    assert len(fetch_log) == 1

    # Cache hit within TTL — no second JWKS fetch.
    listed = client.get("/sessions", headers=bearer_headers(token))
    assert listed.status_code == 200
    assert len(fetch_log) == 1


def test_other_user_cannot_access_session(
    auth_api_client: tuple[TestClient, rsa.RSAPrivateKey, dict[str, Any], list[dict[str, Any]]],
) -> None:
    client, private_key, _jwk, _fetch_log = auth_api_client
    owner = client.post(
        "/sessions",
        json={"agent_id": "default"},
        headers=bearer_headers(_token(private_key, subject="auth0|owner")),
    ).json()
    response = client.get(
        f"/sessions/{owner['id']}",
        headers=bearer_headers(_token(private_key, subject="auth0|intruder")),
    )
    assert response.status_code == 404


@pytest.mark.parametrize(
    "mutate",
    [
        lambda key: _token(key, expires_in=-10),
        lambda key: _token(key, issuer="https://other.example/"),
        lambda key: _token(key, audience="https://other-api"),
        lambda key: _token(key, omit_claims={"sub"}),
        lambda key: _token(key, subject=""),
        lambda key: _token(key, subject="   "),
        lambda key: _token(key, subject="x" * 513),
        lambda key: _token(key, audience=AUTH0_ISSUER),  # ID-token style audience
    ],
)
def test_invalid_claims_return_401(
    auth_api_client: tuple[TestClient, rsa.RSAPrivateKey, dict[str, Any], list[dict[str, Any]]],
    mutate,
) -> None:
    client, private_key, _jwk, _fetch_log = auth_api_client
    token = mutate(private_key)
    response = client.post(
        "/sessions",
        json={"agent_id": "default"},
        headers=bearer_headers(token),
    )
    assert response.status_code == 401
    assert response.headers.get("www-authenticate") == "Bearer"


def test_bad_signature_returns_401(
    auth_api_client: tuple[TestClient, rsa.RSAPrivateKey, dict[str, Any], list[dict[str, Any]]],
) -> None:
    client, _private_key, _jwk, _fetch_log = auth_api_client
    other_key, _other_jwk = generate_rsa_keypair()
    token = _token(other_key)
    response = client.post(
        "/sessions",
        json={"agent_id": "default"},
        headers=bearer_headers(token),
    )
    assert response.status_code == 401


def test_missing_kid_does_not_fetch_jwks(
    auth_api_client: tuple[TestClient, rsa.RSAPrivateKey, dict[str, Any], list[dict[str, Any]]],
) -> None:
    client, private_key, _jwk, fetch_log = auth_api_client
    token = jwt.encode(
        {
            "sub": "auth0|user",
            "aud": AUTH0_AUDIENCE,
            "iss": AUTH0_ISSUER,
            "exp": int(time.time()) + 60,
        },
        private_key,
        algorithm="RS256",
        headers={"alg": "RS256"},
    )
    response = client.post(
        "/sessions",
        json={"agent_id": "default"},
        headers=bearer_headers(token),
    )
    assert response.status_code == 401
    assert fetch_log == []


def test_hs256_does_not_fetch_jwks(
    auth_api_client: tuple[TestClient, rsa.RSAPrivateKey, dict[str, Any], list[dict[str, Any]]],
) -> None:
    client, _private_key, _jwk, fetch_log = auth_api_client
    token = jwt.encode(
        {
            "sub": "auth0|user",
            "aud": AUTH0_AUDIENCE,
            "iss": AUTH0_ISSUER,
            "exp": int(time.time()) + 60,
        },
        "secret",
        algorithm="HS256",
        headers={"kid": "test-key-1", "alg": "HS256"},
    )
    response = client.post(
        "/sessions",
        json={"agent_id": "default"},
        headers=bearer_headers(token),
    )
    assert response.status_code == 401
    assert fetch_log == []


def test_alg_none_does_not_fetch_jwks(
    auth_api_client: tuple[TestClient, rsa.RSAPrivateKey, dict[str, Any], list[dict[str, Any]]],
) -> None:
    client, _private_key, _jwk, fetch_log = auth_api_client
    token = jwt.encode(
        {
            "sub": "auth0|user",
            "aud": AUTH0_AUDIENCE,
            "iss": AUTH0_ISSUER,
            "exp": int(time.time()) + 60,
        },
        key=None,
        algorithm="none",
        headers={"kid": "test-key-1", "alg": "none"},
    )
    response = client.post(
        "/sessions",
        json={"agent_id": "default"},
        headers=bearer_headers(token),
    )
    assert response.status_code == 401
    assert fetch_log == []


def test_jwks_fetch_failure_returns_503(
    db_session: Session,
    monkeypatch: MonkeyPatch,
    rsa_material: tuple[rsa.RSAPrivateKey, dict[str, Any]],
) -> None:
    private_key, _jwk = rsa_material

    def _override_db() -> Generator[Session, None, None]:
        yield db_session

    async def _handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="nope")

    transport = httpx.MockTransport(_handler)
    http_client = httpx.AsyncClient(transport=transport)
    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setenv("AUTH0_DOMAIN", AUTH0_DOMAIN)
    monkeypatch.setenv("AUTH0_AUDIENCE", AUTH0_AUDIENCE)
    get_settings.cache_clear()
    app.dependency_overrides.clear()
    from app.core.database import get_db

    app.dependency_overrides[get_db] = _override_db
    with TestClient(app) as client:
        client.app.state.auth_http_client = http_client
        client.app.state.jwks_cache = None
        response = client.post(
            "/sessions",
            json={"agent_id": "default"},
            headers=bearer_headers(_token(private_key)),
        )
        assert response.status_code == 503
        assert "temporarily unavailable" in response.json()["detail"].lower()
    asyncio.run(http_client.aclose())
    app.dependency_overrides.clear()
    get_settings.cache_clear()


def test_jwks_cache_concurrent_unknown_kid_fetches_once() -> None:
    calls = 0

    async def fetch() -> dict[str, Any]:
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.05)
        return {}

    cache = JwksCache(fetch, ttl_seconds=600, cooldown_seconds=30)

    async def run() -> list[BaseException]:
        results = await asyncio.gather(
            cache.get_key("a"),
            cache.get_key("b"),
            return_exceptions=True,
        )
        return [item for item in results if isinstance(item, BaseException)]

    errors = asyncio.run(run())
    assert calls == 1
    assert all(isinstance(error, AuthRejected) for error in errors)


def test_jwks_cooldown_preserves_unknown_kid_as_401() -> None:
    clock = {"now": 0.0}
    calls = 0

    async def fetch() -> dict[str, Any]:
        nonlocal calls
        calls += 1
        return {"known": object()}

    cache = JwksCache(
        fetch,
        ttl_seconds=600,
        cooldown_seconds=30,
        clock=lambda: clock["now"],
    )

    async def run() -> None:
        with pytest.raises(AuthRejected):
            await cache.get_key("missing")
        clock["now"] = 10.0
        with pytest.raises(AuthRejected):
            await cache.get_key("still-missing")
        assert calls == 1
        clock["now"] = 31.0
        with pytest.raises(AuthRejected):
            await cache.get_key("still-missing")
        assert calls == 2

    asyncio.run(run())


def test_jwks_cooldown_preserves_failed_refresh_as_503() -> None:
    clock = {"now": 0.0}
    calls = 0

    async def fetch() -> dict[str, Any]:
        nonlocal calls
        calls += 1
        raise AuthUnavailable

    cache = JwksCache(
        fetch,
        ttl_seconds=600,
        cooldown_seconds=30,
        clock=lambda: clock["now"],
    )

    async def run() -> None:
        with pytest.raises(AuthUnavailable):
            await cache.get_key("any")
        clock["now"] = 5.0
        with pytest.raises(AuthUnavailable):
            await cache.get_key("any")
        assert calls == 1
        clock["now"] = 31.0
        with pytest.raises(AuthUnavailable):
            await cache.get_key("any")
        assert calls == 2

    asyncio.run(run())


def test_jwks_rotation_refresh_after_cooldown() -> None:
    clock = {"now": 0.0}
    key_a = object()
    key_b = object()
    documents = [{"a": key_a}, {"b": key_b}]

    async def fetch() -> dict[str, Any]:
        return documents.pop(0)

    cache = JwksCache(
        fetch,
        ttl_seconds=600,
        cooldown_seconds=30,
        clock=lambda: clock["now"],
    )

    async def run() -> None:
        assert await cache.get_key("a") is key_a
        clock["now"] = 31.0
        assert await cache.get_key("b") is key_b

    asyncio.run(run())


def test_protected_families_require_bearer_without_override(
    auth_api_client: tuple[TestClient, rsa.RSAPrivateKey, dict[str, Any], list[dict[str, Any]]],
    monkeypatch: MonkeyPatch,
) -> None:
    client, private_key, _jwk, _fetch_log = auth_api_client
    token = _token(private_key, subject="auth0|owner")
    headers = bearer_headers(token)

    created = client.post("/sessions", json={"agent_id": "default"}, headers=headers)
    assert created.status_code == 201
    session_id = created.json()["id"]

    assert client.get("/sessions", headers=headers).status_code == 200
    assert client.get(f"/sessions/{session_id}", headers=headers).status_code == 200

    from langgraph.checkpoint.memory import InMemorySaver

    client.app.state.checkpointer = InMemorySaver()
    monkeypatch.setattr(
        "app.agents.graph.create_chat_model",
        lambda: ScriptedChatModel(
            script=[
                AIMessage(content="ok"),
                AIMessage(content="streamed"),
            ]
        ),
    )

    history = client.get(f"/sessions/{session_id}/messages", headers=headers)
    assert history.status_code == 200

    posted = client.post(
        f"/sessions/{session_id}/messages",
        json={"content": "hi"},
        headers=headers,
    )
    assert posted.status_code == 200

    with client.stream(
        "POST",
        f"/sessions/{session_id}/messages/stream",
        json={"content": "stream"},
        headers=headers,
    ) as stream:
        assert stream.status_code == 200
        body = stream.read().decode()
        assert "event: done" in body

    async def fake_run(message: str, **kwargs):
        return AgentResult(
            reply="ok",
            execution_id="11111111-1111-4111-8111-111111111111",
            messages=[AgentMessageView(role="assistant", content="ok")],
        )

    monkeypatch.setattr("app.api.routes.agents.run_agent", fake_run)
    assert client.post("/agents/run", json={"message": "hello"}, headers=headers).status_code == 200
    assert (
        client.post(
            "/agents/run",
            json={"message": "hello", "session_id": session_id},
            headers=headers,
        ).status_code
        == 200
    )

    for path, method, body in (
        ("/sessions", "POST", {"agent_id": "default"}),
        (f"/sessions/{session_id}/messages", "POST", {"content": "x"}),
        (f"/sessions/{session_id}/messages/stream", "POST", {"content": "x"}),
        ("/agents/run", "POST", {"message": "hello"}),
    ):
        denied = client.request(method, path, json=body)
        assert denied.status_code == 401
        assert denied.headers.get("www-authenticate") == "Bearer"


def test_agents_run_session_without_credentials_returns_401_before_persistence(
    auth_api_client: tuple[TestClient, rsa.RSAPrivateKey, dict[str, Any], list[dict[str, Any]]],
) -> None:
    client, _private_key, _jwk, _fetch_log = auth_api_client
    client.app.state.checkpointer = None
    response = client.post(
        "/agents/run",
        json={"message": "hello", "session_id": "00000000-0000-4000-8000-000000000001"},
    )
    assert response.status_code == 401


def test_agents_run_session_with_identity_missing_checkpointer_returns_503(
    auth_api_client: tuple[TestClient, rsa.RSAPrivateKey, dict[str, Any], list[dict[str, Any]]],
) -> None:
    client, private_key, _jwk, _fetch_log = auth_api_client
    client.app.state.checkpointer = None
    response = client.post(
        "/agents/run",
        json={"message": "hello", "session_id": "00000000-0000-4000-8000-000000000001"},
        headers=bearer_headers(_token(private_key)),
    )
    assert response.status_code == 503
    assert "persistence" in response.json()["detail"].lower()


def test_verify_access_token_unit(
    rsa_material: tuple[rsa.RSAPrivateKey, dict[str, Any]],
) -> None:
    private_key, jwk = rsa_material
    from jwt.algorithms import RSAAlgorithm

    key = RSAAlgorithm.from_jwk(jwk)

    async def fetch() -> dict[str, Any]:
        return {jwk["kid"]: key}

    cache = JwksCache(fetch)
    subject = asyncio.run(
        verify_access_token(
            _token(private_key),
            issuer=AUTH0_ISSUER,
            audience=AUTH0_AUDIENCE,
            jwks=cache,
        )
    )
    assert subject == "auth0|user-1"
