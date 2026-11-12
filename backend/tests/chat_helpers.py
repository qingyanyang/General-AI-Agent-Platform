"""Shared chat-session HTTP helpers."""

from __future__ import annotations

from datetime import UTC, datetime

from app.agents.tool_policy import BUILTIN_TOOL_NAMES, ToolAuthContext
from app.core.permissions import PERM_AGENTS_EXECUTE
from app.models.agent import Agent, AgentStatus
from app.services import agent_access as access_service
from app.services.agents import DEFAULT_AGENT_ID, AgentExecutionConfig, ensure_default_agent
from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import InMemorySaver
from sqlalchemy.orm import Session

USER = "owner"
OTHER = "intruder"

_DEFAULT_PROVIDER = "deepseek"
_DEFAULT_MODEL = "deepseek-flash"
_DEFAULT_TEMPERATURE = 1.0

# Historical reporting fixture: echo-only tools (replaces code allowlist).
REPORTING_TOOL_NAMES: tuple[str, ...] = ("echo",)


def default_execution_config(
    *,
    agent_id: str = "default",
    system_prompt: str = "",
    llm_provider: str = _DEFAULT_PROVIDER,
    llm_model: str = _DEFAULT_MODEL,
    temperature: float | None = _DEFAULT_TEMPERATURE,
    tool_names: tuple[str, ...] | None = None,
    skill_names: tuple[str, ...] = (),
) -> AgentExecutionConfig:
    """Immutable config snapshot for unit tests that call run_agent / stream_agent."""
    tools = tuple(sorted(BUILTIN_TOOL_NAMES)) if tool_names is None else tool_names
    return AgentExecutionConfig(
        agent_id=agent_id,
        system_prompt=system_prompt,
        llm_provider=llm_provider,
        llm_model=llm_model,
        temperature=temperature,
        tool_names=tools,
        skill_names=skill_names,
    )


def default_tool_auth(
    *,
    user_id: str = USER,
    agent_id: str = "default",
    permissions: frozenset[str] | None = None,
    allowed_tools: frozenset[str] | None = None,
    allowed_skills: frozenset[str] = frozenset(),
) -> ToolAuthContext:
    """Trusted tool auth for unit tests that invoke run_agent / stream_agent."""
    tools = BUILTIN_TOOL_NAMES if allowed_tools is None else allowed_tools
    return ToolAuthContext(
        user_id=user_id,
        agent_id=agent_id,
        permissions=(frozenset({PERM_AGENTS_EXECUTE}) if permissions is None else permissions),
        allowed_tools=tools,
        allowed_skills=allowed_skills,
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
    tool_names: list[str] | None = None,
    skill_names: list[str] | None = None,
    system_prompt: str | None = None,
    llm_provider: str | None = None,
    llm_model: str | None = None,
    temperature: float | None = _DEFAULT_TEMPERATURE,
) -> Agent:
    """Insert an agent row if missing (unit tests use create_all, not Alembic seed)."""
    if agent_id == DEFAULT_AGENT_ID and status == AgentStatus.ACTIVE.value:
        ensure_default_agent(db)
        agent = db.get(Agent, DEFAULT_AGENT_ID)
        assert agent is not None
        if name is not None:
            agent.name = name
        if description is not None:
            agent.description = description
        agent.status = status
        if tool_names is not None:
            agent.tool_names = list(tool_names)
        if skill_names is not None:
            agent.skill_names = list(skill_names)
        if system_prompt is not None:
            agent.system_prompt = system_prompt
        if llm_provider is not None:
            agent.llm_provider = llm_provider
        if llm_model is not None:
            agent.llm_model = llm_model
        agent.temperature = temperature
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
        if tool_names is not None:
            existing.tool_names = list(tool_names)
        if skill_names is not None:
            existing.skill_names = list(skill_names)
        if system_prompt is not None:
            existing.system_prompt = system_prompt
        if llm_provider is not None:
            existing.llm_provider = llm_provider
        if llm_model is not None:
            existing.llm_model = llm_model
        existing.temperature = temperature
        existing.updated_at = datetime.now(UTC)
        db.commit()
        db.refresh(existing)
        return existing

    now = datetime.now(UTC)
    default_tools = list(BUILTIN_TOOL_NAMES) if agent_id == DEFAULT_AGENT_ID else []
    agent = Agent(
        id=agent_id,
        name=name or agent_id,
        description=description,
        status=status,
        created_by=created_by,
        created_at=now,
        updated_at=now,
        system_prompt=system_prompt or "",
        llm_provider=llm_provider or _DEFAULT_PROVIDER,
        llm_model=llm_model or _DEFAULT_MODEL,
        temperature=temperature,
        tool_names=list(tool_names) if tool_names is not None else default_tools,
        skill_names=list(skill_names) if skill_names is not None else [],
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
    tool_names: list[str] | None = None,
) -> None:
    """Opt-in grant seeding for tests that need agent access."""
    seed_agent(db, agent_id, tool_names=tool_names)
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
    tool_names: list[str] | None = None,
) -> dict:
    seed_agent_grant(
        db,
        user_id,
        agent_id,
        can_view=can_view,
        can_configure=can_configure,
        can_execute=can_execute,
        tool_names=tool_names,
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
