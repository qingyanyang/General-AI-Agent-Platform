"""Shared chat-session HTTP helpers."""

from __future__ import annotations

from app.services import agent_access as access_service
from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import InMemorySaver
from sqlalchemy.orm import Session

USER = "owner"
OTHER = "intruder"


def headers(user_id: str = USER) -> dict[str, str]:
    return {"X-User-Id": user_id}


def seed_agent_grant(
    db: Session,
    user_id: str,
    agent_id: str = "default",
    *,
    can_view: bool = True,
    can_configure: bool = False,
    can_execute: bool = True,
) -> None:
    """Opt-in grant seeding for tests that need agent access."""
    access_service.upsert_grant(
        db,
        user_id=user_id,
        agent_id=agent_id,
        can_view=can_view,
        can_configure=can_configure,
        can_execute=can_execute,
    )


def create_session(
    api_client: TestClient,
    db: Session,
    *,
    user_id: str = USER,
    agent_id: str = "default",
    can_view: bool = True,
    can_execute: bool = True,
) -> dict:
    seed_agent_grant(
        db,
        user_id,
        agent_id,
        can_view=can_view,
        can_execute=can_execute,
    )
    response = api_client.post(
        "/sessions",
        json={"agent_id": agent_id},
        headers=headers(user_id),
    )
    assert response.status_code == 201, response.text
    return response.json()


def with_saver(api_client: TestClient) -> InMemorySaver:
    saver = InMemorySaver()
    api_client.app.state.checkpointer = saver
    return saver
