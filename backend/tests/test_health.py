from app.core.config import get_settings
from fastapi.testclient import TestClient
from pytest import MonkeyPatch


def test_health_returns_ok(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "healthy"
    assert body["service"] == "agent-platform-api"
    assert "environment" in body


def test_health_reflects_environment_after_cache_clear(
    client: TestClient,
    monkeypatch: MonkeyPatch,
) -> None:
    monkeypatch.setenv("ENVIRONMENT", "demo")
    get_settings.cache_clear()

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["environment"] == "demo"


def test_unknown_route_returns_json_detail(client: TestClient) -> None:
    response = client.get("/does-not-exist")

    assert response.status_code == 404
    assert "detail" in response.json()
