"""Shared chat-session HTTP helpers."""

from __future__ import annotations

from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import InMemorySaver

USER = "owner"
OTHER = "intruder"


def headers(user_id: str = USER) -> dict[str, str]:
    return {"X-User-Id": user_id}


def create_session(api_client: TestClient, *, user_id: str = USER) -> dict:
    response = api_client.post(
        "/sessions",
        json={"agent_id": "default"},
        headers=headers(user_id),
    )
    assert response.status_code == 201
    return response.json()


def with_saver(api_client: TestClient) -> InMemorySaver:
    saver = InMemorySaver()
    api_client.app.state.checkpointer = saver
    return saver
