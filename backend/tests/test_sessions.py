"""Chat session API: ownership, pagination, archive."""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

USER_A = "user-a"
USER_B = "user-b"


def _headers(user_id: str) -> dict[str, str]:
    return {"X-User-Id": user_id}


def test_missing_database_url_returns_503(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.core.config import Settings, get_settings
    from app.core.database import get_engine

    get_settings.cache_clear()
    get_engine.cache_clear()
    monkeypatch.setattr(
        "app.core.database.get_settings",
        lambda: Settings(database_url=None),
    )
    response = client.post(
        "/sessions",
        json={"agent_id": "default"},
        headers=_headers(USER_A),
    )
    assert response.status_code == 503
    assert "Database" in response.json()["detail"]
    get_settings.cache_clear()
    get_engine.cache_clear()


def test_missing_user_header_returns_422(api_client: TestClient) -> None:
    response = api_client.post("/sessions", json={"agent_id": "default"})
    assert response.status_code == 422


def test_blank_user_header_returns_422(api_client: TestClient) -> None:
    response = api_client.post(
        "/sessions",
        json={"agent_id": "default"},
        headers={"X-User-Id": "   "},
    )
    assert response.status_code == 422


def test_oversized_user_header_returns_422(api_client: TestClient) -> None:
    response = api_client.post(
        "/sessions",
        json={"agent_id": "default"},
        headers={"X-User-Id": "x" * 129},
    )
    assert response.status_code == 422


def test_create_session_defaults_title(api_client: TestClient) -> None:
    response = api_client.post(
        "/sessions",
        json={"agent_id": "default"},
        headers=_headers(USER_A),
    )
    assert response.status_code == 201
    body = response.json()
    assert body["agent_id"] == "default"
    assert body["title"] == "New chat"
    assert body["user_id"] == USER_A
    assert body["id"]
    assert body["created_at"]
    assert body["last_activity_at"]


def test_create_session_custom_title(api_client: TestClient) -> None:
    response = api_client.post(
        "/sessions",
        json={"agent_id": "default", "title": "  Takeoff  "},
        headers=_headers(USER_A),
    )
    assert response.status_code == 201
    assert response.json()["title"] == "Takeoff"


def test_create_rejects_blank_title(api_client: TestClient) -> None:
    response = api_client.post(
        "/sessions",
        json={"agent_id": "default", "title": "   "},
        headers=_headers(USER_A),
    )
    assert response.status_code == 422


def test_create_rejects_blank_agent_id(api_client: TestClient) -> None:
    response = api_client.post(
        "/sessions",
        json={"agent_id": "  "},
        headers=_headers(USER_A),
    )
    assert response.status_code == 422


def test_list_is_scoped_to_owner(api_client: TestClient) -> None:
    api_client.post(
        "/sessions",
        json={"agent_id": "default", "title": "A"},
        headers=_headers(USER_A),
    )
    api_client.post(
        "/sessions",
        json={"agent_id": "default", "title": "B"},
        headers=_headers(USER_B),
    )
    response = api_client.get("/sessions", headers=_headers(USER_A))
    assert response.status_code == 200
    body = response.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["title"] == "A"
    assert body["next_cursor"] is None


def test_get_other_users_session_returns_404(api_client: TestClient) -> None:
    created = api_client.post(
        "/sessions",
        json={"agent_id": "default"},
        headers=_headers(USER_A),
    ).json()
    response = api_client.get(
        f"/sessions/{created['id']}",
        headers=_headers(USER_B),
    )
    assert response.status_code == 404


def test_delete_other_users_session_returns_404(api_client: TestClient) -> None:
    created = api_client.post(
        "/sessions",
        json={"agent_id": "default"},
        headers=_headers(USER_A),
    ).json()
    response = api_client.delete(
        f"/sessions/{created['id']}",
        headers=_headers(USER_B),
    )
    assert response.status_code == 404


def test_delete_unknown_session_returns_404(api_client: TestClient) -> None:
    response = api_client.delete(
        f"/sessions/{uuid.uuid4()}",
        headers=_headers(USER_A),
    )
    assert response.status_code == 404


def test_archive_hides_from_get_and_list_and_is_idempotent(
    api_client: TestClient,
) -> None:
    created = api_client.post(
        "/sessions",
        json={"agent_id": "default", "title": "Soon gone"},
        headers=_headers(USER_A),
    ).json()
    session_id = created["id"]

    first = api_client.delete(f"/sessions/{session_id}", headers=_headers(USER_A))
    assert first.status_code == 204

    second = api_client.delete(f"/sessions/{session_id}", headers=_headers(USER_A))
    assert second.status_code == 204

    assert api_client.get(f"/sessions/{session_id}", headers=_headers(USER_A)).status_code == 404
    listed = api_client.get("/sessions", headers=_headers(USER_A)).json()
    assert listed["items"] == []


def test_pagination_cursor(api_client: TestClient) -> None:
    for index in range(3):
        api_client.post(
            "/sessions",
            json={"agent_id": "default", "title": f"S{index}"},
            headers=_headers(USER_A),
        )

    page1 = api_client.get(
        "/sessions",
        params={"limit": 2},
        headers=_headers(USER_A),
    )
    assert page1.status_code == 200
    body1 = page1.json()
    assert len(body1["items"]) == 2
    assert body1["next_cursor"]

    page2 = api_client.get(
        "/sessions",
        params={"limit": 2, "cursor": body1["next_cursor"]},
        headers=_headers(USER_A),
    )
    assert page2.status_code == 200
    body2 = page2.json()
    assert len(body2["items"]) == 1
    assert body2["next_cursor"] is None
    ids = {item["id"] for item in body1["items"] + body2["items"]}
    assert len(ids) == 3


def test_malformed_cursor_returns_422(api_client: TestClient) -> None:
    response = api_client.get(
        "/sessions",
        params={"cursor": "not-a-cursor"},
        headers=_headers(USER_A),
    )
    assert response.status_code == 422
