"""Read-only tool and approved-model catalogs (#28)."""

from __future__ import annotations

from app.api.deps import get_current_user
from app.core.auth import AuthenticatedUser
from app.core.config import get_settings
from app.core.permissions import PERM_AGENTS_READ, PERM_PLATFORM_TECHNICAL
from fastapi import Request
from fastapi.testclient import TestClient
from pytest import MonkeyPatch


def _as_user(*permissions: str):
    def _current(_request: Request) -> AuthenticatedUser:
        return AuthenticatedUser(user_id="user", permissions=frozenset(permissions))

    return _current


def test_catalog_missing_bearer_is_401(client: TestClient, monkeypatch: MonkeyPatch) -> None:
    client.app.dependency_overrides.pop(get_current_user, None)
    monkeypatch.setenv("AUTH0_DOMAIN", "auth.test.example")
    monkeypatch.setenv("AUTH0_AUDIENCE", "https://api.agent-platform")
    get_settings.cache_clear()

    response = client.get("/tools")

    assert response.status_code == 401
    assert response.headers.get("www-authenticate") == "Bearer"


def test_catalog_without_technical_is_403(client: TestClient) -> None:
    client.app.dependency_overrides[get_current_user] = _as_user(PERM_AGENTS_READ)

    assert client.get("/tools").status_code == 403
    assert client.get("/llm-models").status_code == 403


def test_tools_exclude_load_skill_and_models_include_bounds(client: TestClient) -> None:
    client.app.dependency_overrides[get_current_user] = _as_user(PERM_PLATFORM_TECHNICAL)

    tools = client.get("/tools")
    assert tools.status_code == 200, tools.text
    items = tools.json()["items"]
    names = [item["name"] for item in items]
    assert "load_skill" not in names
    assert "echo" in names
    assert names == sorted(names)
    for item in items:
        assert set(item) == {"name", "description"}

    models = client.get("/llm-models")
    assert models.status_code == 200, models.text
    flash = next(item for item in models.json()["items"] if item["model"] == "deepseek-flash")
    assert flash["provider"] == "deepseek"
    assert flash["temperature_min"] == 0.0
    assert flash["temperature_max"] == 2.0
