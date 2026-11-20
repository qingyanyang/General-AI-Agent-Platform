"""Shared execution-config snapshot + tool-auth assembly for invoke paths."""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.agents.errors import AgentNotConfiguredError
from app.agents.skills import LOAD_SKILL_TOOL_NAME
from app.agents.tool_policy import ToolAuthContext
from app.models.agent import Agent
from app.services import agent_instruction_skills as instruction_service
from app.services import agents as agent_service
from app.services.agents import AgentExecutionConfig


def execution_bundle(
    db: Session,
    agent: Agent,
    *,
    user_id: str,
    permissions: frozenset[str],
) -> tuple[AgentExecutionConfig, ToolAuthContext]:
    """Snapshot + validate config, then build tool auth (no further DB reads).

    Loads published Instruction Skills while ``db`` is open. When the agent has
    assigned curated skills, ``load_skill`` is added to the run-only tool
    allowlist. It is never persisted in ``tool_names``. Published instructions
    are not tools and are not added to ``skill_names``.

    Raises HTTP 503 when the snapshot is not executable.
    """
    instruction_skills = instruction_service.load_published_instruction_skills(
        db,
        agent_id=agent.id,
    )
    execution_config = agent_service.snapshot_execution_config(
        agent,
        instruction_skills=instruction_skills,
    )
    try:
        agent_service.validate_execution_config(execution_config)
    except AgentNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    allowed_tools = set(execution_config.tool_names)
    if execution_config.skill_names:
        allowed_tools.add(LOAD_SKILL_TOOL_NAME)

    tool_auth = ToolAuthContext(
        user_id=user_id,
        permissions=permissions,
        agent_id=agent.id,
        allowed_tools=frozenset(allowed_tools),
        allowed_skills=frozenset(execution_config.skill_names),
    )
    return execution_config, tool_auth
