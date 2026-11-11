"""Shared chat-session HTTP helpers."""

from __future__ import annotations

from datetime import UTC, datetime

from app.agents.tool_policy import ToolAuthContext
from app.core.permissions import PERM_AGENTS_EXECUTE
from app.models.agent import Agent, AgentStatus
from app.services import agent_access as access_service
from app.services.agents import DEFAULT_AGENT_ID, ensure_default_agent
from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import InMemorySaver
from sqlalchemy.orm import Session

USER = "owner"
OTHER = "intruder"


def default_tool_auth(
    *,
    user_id: str = USER,
    agent_id: str = "default",
    permissions: frozenset[str] | None = None,
) -> ToolAuthContext:
    """Trusted tool auth for unit tests that invoke run_agent / stream_agent."""
    return ToolAuthContext(
        user_id=user_id,
        agent_id=agent_id,
        permissions=(frozenset({PERM_AGENTS_EXECUTE}) if permissions is None else permissions),
    )


def headers(user_id: str = USER) -> dict[str, str]:
    return {"X-User-Id": user_id}


def seed_agent(
    db: Session,
    agent_id: str = DEFAULT_AGENT_ID,
    *,
    name: str | None = None,
    status: str = AgentStatus.ACTIVE.value,
    created_by: str = "system",
    description: str | None = None,
) -> Agent:
    """Insert an agent row if missing (unit tests use create_all, not Alembic seed)."""
    if agent_id == DEFAULT_AGENT_ID and status == AgentStatus.ACTIVE.value:
        ensure_default_agent(db)
        agent = db.get(Agent, DEFAULT_AGENT_ID)
        assert agent is not None
        if name is not None or description is not None or status != agent.status:
            if name is not None:
                agent.name = name
            if description is not None:
                agent.description = description
            agent.status = status
            agent.updated_at = datetime.now(UTC)
            db.commit()
            db.refresh(agent)
        return agent

    existing = db.get(Agent, agent_id)
    if existing is not None:
        existing.status = status
        if name is not None:
            existing.name = name
        if description is not None:
            existing.description = description
        existing.updated_at = datetime.now(UTC)
        db.commit()
        db.refresh(existing)
        return existing

    now = datetime.now(UTC)
    agent = Agent(
        id=agent_id,
        name=name or agent_id,
        description=description,
        status=status,
        created_by=created_by,
        created_at=now,
        updated_at=now,
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return agent


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
    seed_agent(db, agent_id)
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
    can_configure: bool = False,
    can_execute: bool = True,
) -> dict:
    seed_agent_grant(
        db,
        user_id,
        agent_id,
        can_view=can_view,
        can_configure=can_configure,
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
