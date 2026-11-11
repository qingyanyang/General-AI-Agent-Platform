"""Agent catalog persistence, configuration (#20), and queries (#19)."""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import Select, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.agents.errors import AgentNotConfiguredError
from app.agents.tools import create_default_registry
from app.core.auth import USER_ID_MAX_LENGTH
from app.core.config import (
    ApprovedLlmCatalogError,
    ApprovedLlmModel,
    get_settings,
)
from app.models.agent import Agent, AgentStatus
from app.schemas.agent import AgentStatusFilter
from app.schemas.agent_config import SYSTEM_PROMPT_MAX_LENGTH
from app.schemas.chat_session import AGENT_ID_MAX_LENGTH
from app.services import agent_access as access_service

INACTIVE_AGENT_DETAIL = "Agent is inactive"
DEFAULT_AGENT_ID = "default"
# Match Alembic 20261111_0005 fixed literals for unit-test ensure_default_agent.
_MIGRATION_DEFAULT_PROVIDER = "deepseek"
_MIGRATION_DEFAULT_MODEL = "deepseek-flash"
_MIGRATION_DEFAULT_TEMPERATURE = 1.0
_MIGRATION_DEFAULT_TOOLS: list[str] = ["add", "multiply", "echo"]
_CURSOR_SEP = "|"


class AgentNotFoundError(Exception):
    """Agent id does not exist."""


class AgentInactiveError(Exception):
    """Agent exists but is inactive; new executions are blocked."""


class AgentConflictError(Exception):
    """Agent id already exists."""


class AgentValidationError(Exception):
    """Invalid agent payload or pagination cursor."""


class AgentToolAssignDenied(Exception):
    """Caller lacks required_permissions to assign a tool."""

    def __init__(self, tool_name: str) -> None:
        self.tool_name = tool_name
        super().__init__(f"not authorized to assign tool '{tool_name}'")


@dataclass(frozen=True, slots=True)
class AgentExecutionConfig:
    """Immutable snapshot of agent runtime configuration (no DB after build)."""

    agent_id: str
    system_prompt: str
    llm_provider: str
    llm_model: str
    temperature: float | None
    tool_names: tuple[str, ...]


@dataclass(frozen=True)
class AgentPage:
    items: list[Agent]
    next_cursor: str | None


def _utcnow() -> datetime:
    return datetime.now(UTC)


def validate_agent_id(agent_id: str) -> str:
    """Match session/grant agent_id rules: strip, non-empty, max length."""
    if not isinstance(agent_id, str):
        raise AgentValidationError("id must be a non-empty string")
    stripped = agent_id.strip()
    if not stripped:
        raise AgentValidationError("id must be a non-empty string")
    if len(stripped) > AGENT_ID_MAX_LENGTH:
        raise AgentValidationError(
            f"id must be at most {AGENT_ID_MAX_LENGTH} characters",
        )
    return stripped


def validate_created_by(user_id: str) -> str:
    if not isinstance(user_id, str) or not user_id:
        raise AgentValidationError("created_by must be a non-empty string")
    if len(user_id) > USER_ID_MAX_LENGTH:
        raise AgentValidationError(
            f"created_by must be at most {USER_ID_MAX_LENGTH} characters",
        )
    return user_id


def get_agent(db: Session, agent_id: str) -> Agent | None:
    return db.get(Agent, validate_agent_id(agent_id))


def require_agent(db: Session, agent_id: str) -> Agent:
    agent = get_agent(db, agent_id)
    if agent is None:
        raise AgentNotFoundError
    return agent


def require_active_agent(db: Session, agent_id: str) -> Agent:
    """Raise NotFound if missing; Inactive if status is not active."""
    agent = require_agent(db, agent_id)
    if agent.status != AgentStatus.ACTIVE.value:
        raise AgentInactiveError
    return agent


def _default_create_config_fields() -> dict[str, object]:
    """Application create defaults from settings catalog (not Alembic literals)."""
    try:
        approved = get_settings().default_approved_llm()
    except ApprovedLlmCatalogError as exc:
        raise AgentValidationError(str(exc)) from exc
    temperature: float | None
    if approved.supports_temperature:
        assert approved.temperature_min is not None
        assert approved.temperature_max is not None
        temperature = (approved.temperature_min + approved.temperature_max) / 2.0
    else:
        temperature = None
    return {
        "system_prompt": "",
        "llm_provider": approved.provider,
        "llm_model": approved.model,
        "temperature": temperature,
        "tool_names": [],
    }


def ensure_default_agent(db: Session) -> Agent:
    """Idempotent seed used by unit tests (migrations seed Postgres)."""
    existing = db.get(Agent, DEFAULT_AGENT_ID)
    if existing is not None:
        return existing
    now = _utcnow()
    agent = Agent(
        id=DEFAULT_AGENT_ID,
        name="Default",
        description=None,
        status=AgentStatus.ACTIVE.value,
        created_by="system",
        created_at=now,
        updated_at=now,
        system_prompt="",
        llm_provider=_MIGRATION_DEFAULT_PROVIDER,
        llm_model=_MIGRATION_DEFAULT_MODEL,
        temperature=_MIGRATION_DEFAULT_TEMPERATURE,
        tool_names=list(_MIGRATION_DEFAULT_TOOLS),
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return agent


def create_agent(
    db: Session,
    *,
    agent_id: str,
    name: str,
    description: str | None,
    created_by: str,
) -> Agent:
    """Create agent and creator grant in one transaction."""
    agent_id = validate_agent_id(agent_id)
    created_by = validate_created_by(created_by)
    if db.get(Agent, agent_id) is not None:
        raise AgentConflictError

    now = _utcnow()
    config_fields = _default_create_config_fields()
    agent = Agent(
        id=agent_id,
        name=name,
        description=description,
        status=AgentStatus.ACTIVE.value,
        created_by=created_by,
        created_at=now,
        updated_at=now,
        system_prompt=str(config_fields["system_prompt"]),
        llm_provider=str(config_fields["llm_provider"]),
        llm_model=str(config_fields["llm_model"]),
        temperature=config_fields["temperature"],  # type: ignore[arg-type]
        tool_names=list(config_fields["tool_names"]),  # type: ignore[arg-type]
    )
    db.add(agent)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise AgentConflictError from exc

    try:
        access_service.upsert_grant(
            db,
            user_id=created_by,
            agent_id=agent_id,
            can_view=True,
            can_configure=True,
            can_execute=True,
        )
    except Exception:
        db.rollback()
        raise
    db.refresh(agent)
    return agent


def update_agent(
    db: Session,
    *,
    agent_id: str,
    name: str | None = None,
    update_name: bool = False,
    description: str | None = None,
    update_description: bool = False,
) -> Agent:
    agent = require_agent(db, agent_id)
    if update_name:
        if name is None or not name.strip():
            raise AgentValidationError("name must be a non-empty string")
        agent.name = name.strip()
    if update_description:
        agent.description = description
    agent.updated_at = _utcnow()
    db.commit()
    db.refresh(agent)
    return agent


def deactivate_agent(db: Session, *, agent_id: str) -> Agent:
    agent = require_agent(db, agent_id)
    if agent.status != AgentStatus.INACTIVE.value:
        agent.status = AgentStatus.INACTIVE.value
        agent.updated_at = _utcnow()
        db.commit()
        db.refresh(agent)
    return agent


def _validate_temperature(
    approved: ApprovedLlmModel,
    temperature: float | None,
) -> None:
    if not approved.supports_temperature:
        if temperature is not None:
            raise AgentValidationError(
                f"model '{approved.provider}/{approved.model}' does not support temperature",
            )
        return
    assert approved.temperature_min is not None
    assert approved.temperature_max is not None
    if temperature is None:
        raise AgentValidationError(
            f"temperature is required for model '{approved.provider}/{approved.model}'",
        )
    if temperature < approved.temperature_min or temperature > approved.temperature_max:
        raise AgentValidationError(
            f"temperature must be between {approved.temperature_min} and "
            f"{approved.temperature_max} for '{approved.provider}/{approved.model}'",
        )


def update_configuration(
    db: Session,
    *,
    agent_id: str,
    system_prompt: str,
    llm_provider: str,
    llm_model: str,
    temperature: float | None,
    tool_names: list[str],
    caller_permissions: frozenset[str],
) -> Agent:
    """Replace configuration under a row lock; check tool-add permissions vs old set."""
    agent_id = validate_agent_id(agent_id)
    if len(system_prompt) > SYSTEM_PROMPT_MAX_LENGTH:
        raise AgentValidationError(
            f"system_prompt must be at most {SYSTEM_PROMPT_MAX_LENGTH} characters",
        )

    settings = get_settings()
    approved = settings.get_approved_llm(llm_provider, llm_model)
    if approved is None:
        raise AgentValidationError(
            f"LLM '{llm_provider}/{llm_model}' is not in APPROVED_LLM_MODELS",
        )
    _validate_temperature(approved, temperature)

    registry = create_default_registry()
    for name in tool_names:
        if not registry.has(name):
            raise AgentValidationError(f"unknown tool '{name}'")

    stmt = select(Agent).where(Agent.id == agent_id).with_for_update()
    agent = db.scalar(stmt)
    if agent is None:
        raise AgentNotFoundError

    old_tools = {str(item) for item in (agent.tool_names or [])}
    new_tools = set(tool_names)
    for name in new_tools - old_tools:
        required = registry.required_permissions_for(name)
        if not required <= caller_permissions:
            raise AgentToolAssignDenied(name)

    agent.system_prompt = system_prompt
    agent.llm_provider = approved.provider
    agent.llm_model = approved.model
    agent.temperature = temperature
    agent.tool_names = list(tool_names)
    agent.updated_at = _utcnow()
    db.commit()
    db.refresh(agent)
    return agent


def snapshot_execution_config(agent: Agent) -> AgentExecutionConfig:
    """Build an immutable config snapshot from a loaded Agent row."""
    tools = tuple(str(name) for name in (agent.tool_names or []))
    return AgentExecutionConfig(
        agent_id=agent.id,
        system_prompt=agent.system_prompt or "",
        llm_provider=agent.llm_provider,
        llm_model=agent.llm_model,
        temperature=agent.temperature,
        tool_names=tools,
    )


def validate_execution_config(config: AgentExecutionConfig) -> None:
    """Validate snapshot for execution; raise AgentNotConfiguredError on failure."""
    settings = get_settings()
    approved = settings.get_approved_llm(config.llm_provider, config.llm_model)
    if approved is None:
        raise AgentNotConfiguredError(
            f"Agent configuration is invalid: LLM "
            f"'{config.llm_provider}/{config.llm_model}' is not approved",
        )
    try:
        _validate_temperature(approved, config.temperature)
    except AgentValidationError as exc:
        raise AgentNotConfiguredError(
            f"Agent configuration is invalid: {exc}",
        ) from exc

    registry = create_default_registry()
    for name in config.tool_names:
        if not registry.has(name):
            raise AgentNotConfiguredError(
                f"Agent configuration is invalid: tool '{name}' is not registered",
            )

    if not settings.resolve_llm_api_key_for_provider(config.llm_provider):
        raise AgentNotConfiguredError(
            "LLM API key is not configured; cannot run the agent",
        )


def encode_agent_cursor(created_at: datetime, agent_id: str) -> str:
    raw = f"{created_at.isoformat()}{_CURSOR_SEP}{agent_id}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def decode_agent_cursor(cursor: str) -> tuple[datetime, str]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        stamp_text, agent_id = raw.split(_CURSOR_SEP, 1)
        stamped = datetime.fromisoformat(stamp_text)
        if stamped.tzinfo is None:
            stamped = stamped.replace(tzinfo=UTC)
        return stamped, agent_id
    except (ValueError, binascii.Error, UnicodeError) as exc:
        raise AgentValidationError("Malformed pagination cursor") from exc


def list_agents_for_user(
    db: Session,
    *,
    user_id: str,
    status: AgentStatusFilter,
    limit: int,
    cursor: str | None,
) -> AgentPage:
    """List agents the user can view, optionally filtered by status."""
    viewable = access_service.viewable_agent_ids(db, user_id=user_id)
    if not viewable:
        return AgentPage(items=[], next_cursor=None)

    stmt: Select[tuple[Agent]] = select(Agent).where(Agent.id.in_(viewable))
    if status is AgentStatusFilter.ACTIVE:
        stmt = stmt.where(Agent.status == AgentStatus.ACTIVE.value)
    elif status is AgentStatusFilter.INACTIVE:
        stmt = stmt.where(Agent.status == AgentStatus.INACTIVE.value)

    stmt = stmt.order_by(Agent.created_at.desc(), Agent.id.desc())
    if cursor is not None:
        cursor_created, cursor_id = decode_agent_cursor(cursor)
        stmt = stmt.where(
            (Agent.created_at < cursor_created)
            | ((Agent.created_at == cursor_created) & (Agent.id < cursor_id)),
        )

    rows = list(db.scalars(stmt.limit(limit + 1)).all())
    next_cursor: str | None = None
    if len(rows) > limit:
        last = rows[limit - 1]
        next_cursor = encode_agent_cursor(last.created_at, last.id)
        rows = rows[:limit]
    return AgentPage(items=rows, next_cursor=next_cursor)
