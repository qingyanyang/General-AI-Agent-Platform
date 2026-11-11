"""Agent catalog CRUD (#19), configuration (#20), and invoke API."""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.agents.checkpointer import thread_id_for_session
from app.agents.errors import AgentExecutionError, AgentNotConfiguredError
from app.agents.runtime import run_agent
from app.agents.tool_policy import ToolAuthContext
from app.api.deps import require_permissions
from app.core.auth import AuthenticatedUser
from app.core.config import get_settings
from app.core.database import get_db
from app.core.permissions import (
    PERM_AGENTS_CONFIGURE,
    PERM_AGENTS_EXECUTE,
    PERM_AGENTS_READ,
)
from app.models.agent import Agent, AgentStatus
from app.schemas.agent import (
    AgentCreate,
    AgentListOut,
    AgentOut,
    AgentStatusFilter,
    AgentUpdate,
)
from app.schemas.agent_config import AgentConfigurationIn, AgentConfigurationOut
from app.services import agent_access as access_service
from app.services import agents as agent_service
from app.services import chat_sessions as session_service
from app.services.agents import AgentExecutionConfig

router = APIRouter(prefix="/agents", tags=["agents"])

_AGENT_ACCESS_DENIED = "Agent access denied"


class AgentRunRequest(BaseModel):
    message: str = Field(min_length=1)
    session_id: uuid.UUID | None = None


class AgentMessageOut(BaseModel):
    role: str
    content: str


class AgentRunResponse(BaseModel):
    reply: str
    execution_id: str
    messages: list[AgentMessageOut]


@contextmanager
def _db_session(request: Request) -> Session:
    """Open a DB session; honor FastAPI dependency_overrides used in tests."""
    override = request.app.dependency_overrides.get(get_db)
    generator = override() if override is not None else get_db()
    session = next(generator)
    try:
        yield session
    finally:
        generator.close()


def _http_inactive() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=agent_service.INACTIVE_AGENT_DETAIL,
    )


def _http_agent_not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Agent not found",
    )


def _require_agent(db: Session, agent_id: str) -> Agent:
    """Load agent; missing/invalid id → 404."""
    try:
        return agent_service.require_agent(db, agent_id)
    except (agent_service.AgentNotFoundError, agent_service.AgentValidationError) as exc:
        raise _http_agent_not_found() from exc


def _ensure_execute(db: Session, *, user_id: str, agent_id: str) -> bool:
    """Require execute; return whether the caller also has view."""
    try:
        access_service.ensure_agent_capability(
            db,
            user_id=user_id,
            agent_id=agent_id,
            capability=access_service.AgentCapability.EXECUTE,
        )
    except access_service.AgentAccessDenied as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_AGENT_ACCESS_DENIED,
        ) from exc
    return access_service.user_has_capability(
        db,
        user_id=user_id,
        agent_id=agent_id,
        capability=access_service.AgentCapability.VIEW,
    )


def _ensure_executable_agent(
    db: Session,
    *,
    user_id: str,
    agent_id: str,
) -> tuple[Agent, bool]:
    """404 missing → 403 no execute → 409 inactive. Returns agent + has_view."""
    agent = _require_agent(db, agent_id)
    include_history = _ensure_execute(db, user_id=user_id, agent_id=agent_id)
    if agent.status != AgentStatus.ACTIVE.value:
        raise _http_inactive()
    return agent, include_history


def _ensure_configure(db: Session, *, user_id: str, agent_id: str) -> Agent:
    # Unknown/invalid agent → 404 first (catalog non-disclosure).
    agent = _require_agent(db, agent_id)
    try:
        access_service.ensure_agent_capability(
            db,
            user_id=user_id,
            agent_id=agent_id,
            capability=access_service.AgentCapability.CONFIGURE,
        )
    except access_service.AgentAccessDenied as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_AGENT_ACCESS_DENIED,
        ) from exc
    return agent


def _execution_bundle(
    agent: Agent,
    *,
    user_id: str,
    permissions: frozenset[str],
) -> tuple[AgentExecutionConfig, ToolAuthContext]:
    """Snapshot + validate config, then build tool auth (no further DB reads)."""
    execution_config = agent_service.snapshot_execution_config(agent)
    try:
        agent_service.validate_execution_config(execution_config)
    except AgentNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    tool_auth = ToolAuthContext(
        user_id=user_id,
        permissions=permissions,
        agent_id=agent.id,
        allowed_tools=frozenset(execution_config.tool_names),
    )
    return execution_config, tool_auth


def _configuration_out(agent: Agent) -> AgentConfigurationOut:
    return AgentConfigurationOut(
        system_prompt=agent.system_prompt or "",
        llm_provider=agent.llm_provider,
        llm_model=agent.llm_model,
        temperature=agent.temperature,
        tool_names=[str(name) for name in (agent.tool_names or [])],
    )


@router.post("", response_model=AgentOut, status_code=status.HTTP_201_CREATED)
def create_agent(
    body: AgentCreate,
    user: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENTS_CONFIGURE))],
    db: Annotated[Session, Depends(get_db)],
) -> AgentOut:
    try:
        agent = agent_service.create_agent(
            db,
            agent_id=body.id,
            name=body.name,
            description=body.description,
            created_by=user.user_id,
        )
    except agent_service.AgentConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Agent already exists",
        ) from exc
    except agent_service.AgentValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    return AgentOut.model_validate(agent)


@router.get("", response_model=AgentListOut)
def list_agents(
    user: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENTS_READ))],
    db: Annotated[Session, Depends(get_db)],
    status_filter: Annotated[
        AgentStatusFilter,
        Query(alias="status"),
    ] = AgentStatusFilter.ACTIVE,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: Annotated[str | None, Query()] = None,
) -> AgentListOut:
    try:
        page = agent_service.list_agents_for_user(
            db,
            user_id=user.user_id,
            status=status_filter,
            limit=limit,
            cursor=cursor,
        )
    except agent_service.AgentValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    return AgentListOut(
        items=[AgentOut.model_validate(item) for item in page.items],
        next_cursor=page.next_cursor,
    )


# Literal `/run` must stay registered before `/{agent_id}` routes that could
# otherwise capture the path segment in some routers.
@router.post("/run", response_model=AgentRunResponse)
async def agents_run(
    body: AgentRunRequest,
    request: Request,
    user: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENTS_EXECUTE))],
) -> AgentRunResponse:
    try:
        if body.session_id is None:
            agent_id = get_settings().agent_id
            with _db_session(request) as db:
                agent, include_history = _ensure_executable_agent(
                    db,
                    user_id=user.user_id,
                    agent_id=agent_id,
                )
                execution_config, tool_auth = _execution_bundle(
                    agent,
                    user_id=user.user_id,
                    permissions=user.permissions,
                )
            result = await run_agent(
                body.message,
                tool_auth=tool_auth,
                execution_config=execution_config,
            )
        else:
            checkpointer = getattr(request.app.state, "checkpointer", None)
            if checkpointer is None:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Conversation persistence is not configured",
                )
            with _db_session(request) as db:
                chat_session = session_service.get_active_session_for_user(
                    db,
                    user_id=user.user_id,
                    session_id=body.session_id,
                )
                agent_id = chat_session.agent_id
                agent, include_history = _ensure_executable_agent(
                    db,
                    user_id=user.user_id,
                    agent_id=agent_id,
                )
                execution_config, tool_auth = _execution_bundle(
                    agent,
                    user_id=user.user_id,
                    permissions=user.permissions,
                )
                thread_id = thread_id_for_session(chat_session.id)
            result = await run_agent(
                body.message,
                tool_auth=tool_auth,
                execution_config=execution_config,
                checkpointer=checkpointer,
                thread_id=thread_id,
            )
    except HTTPException:
        raise
    except AgentNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except AgentExecutionError as exc:
        detail: str | dict[str, str] = str(exc)
        if exc.execution_id is not None:
            detail = {"message": str(exc), "execution_id": exc.execution_id}
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=detail,
        ) from exc

    if include_history:
        messages = [
            AgentMessageOut(role=item.role, content=item.content) for item in result.messages
        ]
    else:
        # Execute-only: current-turn assistant reply only — not checkpoint history.
        messages = [AgentMessageOut(role="assistant", content=result.reply)]

    return AgentRunResponse(
        reply=result.reply,
        execution_id=result.execution_id,
        messages=messages,
    )


@router.get("/{agent_id}", response_model=AgentOut)
def get_agent(
    agent_id: str,
    user: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENTS_READ))],
    db: Annotated[Session, Depends(get_db)],
) -> AgentOut:
    agent = _require_agent(db, agent_id)
    if not access_service.user_has_capability(
        db,
        user_id=user.user_id,
        agent_id=agent.id,
        capability=access_service.AgentCapability.VIEW,
    ):
        # Catalog non-disclosure: missing view → 404 (distinct from session 403).
        raise _http_agent_not_found()
    return AgentOut.model_validate(agent)


@router.get("/{agent_id}/configuration", response_model=AgentConfigurationOut)
def get_agent_configuration(
    agent_id: str,
    user: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENTS_CONFIGURE))],
    db: Annotated[Session, Depends(get_db)],
) -> AgentConfigurationOut:
    agent = _ensure_configure(db, user_id=user.user_id, agent_id=agent_id)
    return _configuration_out(agent)


@router.put("/{agent_id}/configuration", response_model=AgentConfigurationOut)
def put_agent_configuration(
    agent_id: str,
    body: AgentConfigurationIn,
    user: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENTS_CONFIGURE))],
    db: Annotated[Session, Depends(get_db)],
) -> AgentConfigurationOut:
    _ensure_configure(db, user_id=user.user_id, agent_id=agent_id)
    try:
        agent = agent_service.update_configuration(
            db,
            agent_id=agent_id,
            system_prompt=body.system_prompt,
            llm_provider=body.llm_provider,
            llm_model=body.llm_model,
            temperature=body.temperature,
            tool_names=body.tool_names,
            caller_permissions=user.permissions,
        )
    except agent_service.AgentNotFoundError as exc:
        raise _http_agent_not_found() from exc
    except agent_service.AgentToolAssignDenied as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except agent_service.AgentValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    return _configuration_out(agent)


@router.patch("/{agent_id}", response_model=AgentOut)
def update_agent(
    agent_id: str,
    body: AgentUpdate,
    user: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENTS_CONFIGURE))],
    db: Annotated[Session, Depends(get_db)],
) -> AgentOut:
    _ensure_configure(db, user_id=user.user_id, agent_id=agent_id)
    try:
        agent = agent_service.update_agent(
            db,
            agent_id=agent_id,
            name=body.name,
            update_name="name" in body.model_fields_set,
            description=body.description,
            update_description="description" in body.model_fields_set,
        )
    except agent_service.AgentNotFoundError as exc:
        raise _http_agent_not_found() from exc
    except agent_service.AgentValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    return AgentOut.model_validate(agent)


@router.post("/{agent_id}/deactivate", response_model=AgentOut)
def deactivate_agent(
    agent_id: str,
    user: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENTS_CONFIGURE))],
    db: Annotated[Session, Depends(get_db)],
) -> AgentOut:
    _ensure_configure(db, user_id=user.user_id, agent_id=agent_id)
    try:
        agent = agent_service.deactivate_agent(db, agent_id=agent_id)
    except agent_service.AgentNotFoundError as exc:
        raise _http_agent_not_found() from exc
    return AgentOut.model_validate(agent)
