"""Agent catalog CRUD (#19), configuration (#20), and invoke API."""

from __future__ import annotations

import asyncio
import uuid
from contextlib import contextmanager
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.agents.checkpointer import thread_id_for_session
from app.agents.errors import AgentExecutionError, AgentNotConfiguredError
from app.agents.runtime import read_pending_despite_cancellation, run_agent
from app.api.deps import get_current_user, require_permissions
from app.api.execution import execution_bundle
from app.api.execution_records import (
    CANCELLED,
    FAILED,
    SUCCEEDED,
    begin_gated_run_or_http,
    finalize_execution_best_effort,
    pause_for_approval_bounded,
    start_execution_or_503,
    start_lease_heartbeat,
    stop_lease_heartbeat,
)
from app.core.auth import AuthenticatedUser
from app.core.config import get_settings
from app.core.database import get_db
from app.core.permissions import (
    PERM_AGENT_ACCESS_MANAGE,
    PERM_AGENTS_CONFIGURE,
    PERM_AGENTS_EXECUTE,
    PERM_AGENTS_READ,
    PERM_PLATFORM_TECHNICAL,
)
from app.models.agent import Agent, AgentStatus
from app.schemas.agent import (
    AgentCreate,
    AgentListOut,
    AgentOut,
    AgentStatusFilter,
    AgentUpdate,
)
from app.schemas.agent_access_config import (
    AgentAccessConfigGroupOut,
    AgentAccessConfigOut,
    AgentAccessConfigUpdate,
)
from app.schemas.agent_config import AgentConfigurationIn, AgentConfigurationOut
from app.schemas.agent_instruction_skills import (
    InstructionSkillItemOut,
    InstructionSkillsOut,
    InstructionSkillsReplaceIn,
)
from app.schemas.approval import PendingApproval
from app.services import agent_access as access_service
from app.services import agent_access_config as access_config_service
from app.services import agent_executions as execution_service
from app.services import agent_instruction_skills as instruction_service
from app.services import agents as agent_service
from app.services import chat_sessions as session_service

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


def _ensure_execute(
    db: Session,
    *,
    user_id: str,
    agent_id: str,
    permissions: frozenset[str] | set[str] | None = None,
) -> bool:
    """Require execute; return whether the caller also has view."""
    try:
        access_service.ensure_agent_capability(
            db,
            user_id=user_id,
            agent_id=agent_id,
            capability=access_service.AgentCapability.EXECUTE,
            permissions=permissions,
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
        permissions=permissions,
    )


def _ensure_executable_agent(
    db: Session,
    *,
    user_id: str,
    agent_id: str,
    permissions: frozenset[str] | set[str] | None = None,
) -> tuple[Agent, bool]:
    """404 missing → 403 no execute → 409 inactive. Returns agent + has_view."""
    agent = _require_agent(db, agent_id)
    include_history = _ensure_execute(
        db,
        user_id=user_id,
        agent_id=agent_id,
        permissions=permissions,
    )
    if agent.status != AgentStatus.ACTIVE.value:
        raise _http_inactive()
    return agent, include_history


def _ensure_configure(
    db: Session,
    *,
    user_id: str,
    agent_id: str,
    permissions: frozenset[str] | set[str] | None = None,
) -> Agent:
    # Unknown/invalid agent → 404 first (catalog non-disclosure).
    agent = _require_agent(db, agent_id)
    try:
        access_service.ensure_agent_capability(
            db,
            user_id=user_id,
            agent_id=agent_id,
            capability=access_service.AgentCapability.CONFIGURE,
            permissions=permissions,
        )
    except access_service.AgentAccessDenied as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_AGENT_ACCESS_DENIED,
        ) from exc
    return agent


def _configuration_out(agent: Agent) -> AgentConfigurationOut:
    return AgentConfigurationOut(
        system_prompt=agent.system_prompt or "",
        llm_provider=agent.llm_provider,
        llm_model=agent.llm_model,
        temperature=agent.temperature,
        tool_names=[str(name) for name in (agent.tool_names or [])],
        skill_names=[str(name) for name in (agent.skill_names or [])],
        approval_tool_names=[str(name) for name in (agent.approval_tool_names or [])],
    )


@router.post("", response_model=AgentOut, status_code=status.HTTP_201_CREATED)
def create_agent(
    body: AgentCreate,
    user: Annotated[
        AuthenticatedUser,
        Depends(require_permissions(PERM_AGENTS_CONFIGURE, PERM_AGENT_ACCESS_MANAGE)),
    ],
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
            permissions=user.permissions,
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
) -> AgentRunResponse | JSONResponse:
    session_id: uuid.UUID | None = None
    checkpointer = None
    thread_id: str | None = None
    try:
        if body.session_id is None:
            agent_id = get_settings().agent_id
            with _db_session(request) as db:
                agent, include_history = _ensure_executable_agent(
                    db,
                    user_id=user.user_id,
                    agent_id=agent_id,
                    permissions=user.permissions,
                )
                execution_config, tool_auth = execution_bundle(
                    db,
                    agent,
                    user_id=user.user_id,
                    permissions=user.permissions,
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
                session_id = chat_session.id
                agent_id = chat_session.agent_id
                agent, include_history = _ensure_executable_agent(
                    db,
                    user_id=user.user_id,
                    agent_id=agent_id,
                    permissions=user.permissions,
                )
                execution_config, tool_auth = execution_bundle(
                    db,
                    agent,
                    user_id=user.user_id,
                    permissions=user.permissions,
                )
                thread_id = thread_id_for_session(chat_session.id)
    except HTTPException:
        raise
    except AgentNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    execution_id = uuid.uuid4()
    gated = session_id is not None
    if gated:
        assert session_id is not None
        monotonic_start = begin_gated_run_or_http(
            request,
            execution_id=execution_id,
            user_id=user.user_id,
            agent_id=agent_id,
            session_id=session_id,
        )
        heartbeat = start_lease_heartbeat(
            request,
            session_id=session_id,
            execution_id=execution_id,
        )
    else:
        monotonic_start = start_execution_or_503(
            request,
            execution_id=execution_id,
            user_id=user.user_id,
            agent_id=agent_id,
            session_id=None,
        )
        heartbeat = None
    # Default to failed so an unexpected exception still leaves a terminal row.
    terminal_status = FAILED
    error_summary: str | None = execution_service.sanitize_error_summary(
        "Agent execution failed",
    )
    paused: PendingApproval | None = None
    try:
        result = await run_agent(
            body.message,
            tool_auth=tool_auth,
            execution_config=execution_config,
            checkpointer=checkpointer,
            thread_id=thread_id,
            execution_id=execution_id,
        )
        if result.pending is not None:
            paused = result.pending
        else:
            terminal_status = SUCCEEDED
            error_summary = None
    except asyncio.CancelledError:
        if gated and checkpointer is not None and thread_id is not None:
            paused = await read_pending_despite_cancellation(
                checkpointer=checkpointer,
                thread_id=thread_id,
                execution_id=str(execution_id),
                execution_config=execution_config,
            )
        if paused is None:
            terminal_status = CANCELLED
            error_summary = None
        raise
    except AgentNotConfiguredError as exc:
        terminal_status = FAILED
        error_summary = execution_service.sanitize_error_summary(str(exc))
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except AgentExecutionError as exc:
        terminal_status = FAILED
        error_summary = execution_service.sanitize_error_summary(str(exc))
        detail: str | dict[str, str] = str(exc)
        if exc.execution_id is not None:
            detail = {"message": str(exc), "execution_id": exc.execution_id}
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=detail,
        ) from exc
    finally:
        await stop_lease_heartbeat(heartbeat)
        if paused is not None and session_id is not None:
            pause_for_approval_bounded(
                request,
                session_id=session_id,
                execution_id=execution_id,
                monotonic_start=monotonic_start,
                checkpoint_id=paused.checkpoint_id,
                interrupt_id=paused.interrupt_id,
                tool_call_id=paused.tool_call_id,
            )
        else:
            finalize_execution_best_effort(
                request,
                execution_id=execution_id,
                status=terminal_status,
                monotonic_start=monotonic_start,
                error_summary=error_summary,
                session_id=session_id,
            )

    if paused is not None:
        return JSONResponse(
            status_code=status.HTTP_202_ACCEPTED,
            content=paused.model_dump(mode="json"),
        )

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
        permissions=user.permissions,
    ):
        # Catalog non-disclosure: missing view → 404 (distinct from session 403).
        raise _http_agent_not_found()
    return AgentOut.model_validate(agent)


def _access_config_out(view: access_config_service.AccessConfigView) -> AgentAccessConfigOut:
    return AgentAccessConfigOut(
        agent_id=view.agent_id,
        authorization_mode=view.authorization_mode,  # type: ignore[arg-type]
        audience_effective=view.audience_effective,
        audience_mode=view.audience_mode,  # type: ignore[arg-type]
        owning_group_id=view.owning_group_id,
        owning_group_name=view.owning_group_name,
        group_ids=view.group_ids,
        groups=[
            AgentAccessConfigGroupOut(
                group_id=item.group_id,
                name=item.name,
                is_owning=item.is_owning,
            )
            for item in view.groups
        ],
        updated_at=view.updated_at,
    )


@router.get("/{agent_id}/access-config", response_model=AgentAccessConfigOut)
def get_agent_access_config(
    agent_id: str,
    caller: Annotated[
        AuthenticatedUser,
        Depends(require_permissions(PERM_AGENT_ACCESS_MANAGE)),
    ],
    db: Annotated[Session, Depends(get_db)],
) -> AgentAccessConfigOut:
    del caller
    try:
        view = access_config_service.get_access_config(db, agent_id=agent_id)
    except access_config_service.AgentAccessConfigNotFound as exc:
        raise _http_agent_not_found() from exc
    return _access_config_out(view)


@router.put("/{agent_id}/access-config", response_model=AgentAccessConfigOut)
def put_agent_access_config(
    agent_id: str,
    body: AgentAccessConfigUpdate,
    caller: Annotated[
        AuthenticatedUser,
        Depends(require_permissions(PERM_AGENT_ACCESS_MANAGE)),
    ],
    db: Annotated[Session, Depends(get_db)],
) -> AgentAccessConfigOut:
    del caller
    try:
        view = access_config_service.update_access_config(
            db,
            agent_id=agent_id,
            audience_mode=body.audience_mode,
            owning_group_id=body.owning_group_id,
            group_ids=body.group_ids,
        )
    except access_config_service.AgentAccessConfigNotFound as exc:
        raise _http_agent_not_found() from exc
    except access_config_service.GroupNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found",
        ) from exc
    except access_config_service.AgentAccessConfigValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    return _access_config_out(view)


@router.post("/{agent_id}/access-config/activate", response_model=AgentAccessConfigOut)
def activate_agent_access_config(
    agent_id: str,
    caller: Annotated[
        AuthenticatedUser,
        Depends(require_permissions(PERM_AGENT_ACCESS_MANAGE)),
    ],
    db: Annotated[Session, Depends(get_db)],
) -> AgentAccessConfigOut:
    del caller
    try:
        view = access_config_service.activate_access_config(db, agent_id=agent_id)
    except access_config_service.AgentAccessConfigNotFound as exc:
        raise _http_agent_not_found() from exc
    except access_config_service.AgentAccessConfigValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    return _access_config_out(view)


def _instruction_skills_out(
    items: list[instruction_service.InstructionSkillView],
) -> InstructionSkillsOut:
    return InstructionSkillsOut(
        items=[
            InstructionSkillItemOut(
                id=item.id,
                name=item.name,
                description=item.description,
                instructions=item.instructions,
            )
            for item in items
        ],
    )


@router.get("/{agent_id}/instruction-skills", response_model=InstructionSkillsOut)
def get_agent_instruction_skills(
    agent_id: str,
    caller: Annotated[AuthenticatedUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> InstructionSkillsOut:
    _require_agent(db, agent_id)
    try:
        access_service.ensure_instruction_skills_edit(
            db,
            user_id=caller.user_id,
            agent_id=agent_id,
            permissions=caller.permissions,
        )
    except access_service.AgentAccessDenied as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_AGENT_ACCESS_DENIED,
        ) from exc
    try:
        items = instruction_service.list_instruction_skills(db, agent_id=agent_id)
    except instruction_service.InstructionSkillsNotFound as exc:
        raise _http_agent_not_found() from exc
    return _instruction_skills_out(items)


@router.put("/{agent_id}/instruction-skills", response_model=InstructionSkillsOut)
def put_agent_instruction_skills(
    agent_id: str,
    body: InstructionSkillsReplaceIn,
    caller: Annotated[AuthenticatedUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> InstructionSkillsOut:
    _require_agent(db, agent_id)
    try:
        access_service.ensure_instruction_skills_edit(
            db,
            user_id=caller.user_id,
            agent_id=agent_id,
            permissions=caller.permissions,
        )
    except access_service.AgentAccessDenied as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_AGENT_ACCESS_DENIED,
        ) from exc
    try:
        items = instruction_service.replace_instruction_skills(
            db,
            agent_id=agent_id,
            items=body.items,
            user_id=caller.user_id,
            permissions=caller.permissions,
        )
    except instruction_service.InstructionSkillsNotFound as exc:
        raise _http_agent_not_found() from exc
    except access_service.AgentAccessDenied as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_AGENT_ACCESS_DENIED,
        ) from exc
    except instruction_service.InstructionSkillsValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    return _instruction_skills_out(items)


@router.get("/{agent_id}/configuration", response_model=AgentConfigurationOut)
def get_agent_configuration(
    agent_id: str,
    user: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_PLATFORM_TECHNICAL))],
    db: Annotated[Session, Depends(get_db)],
) -> AgentConfigurationOut:
    agent = _ensure_configure(
        db,
        user_id=user.user_id,
        agent_id=agent_id,
        permissions=user.permissions,
    )
    return _configuration_out(agent)


@router.put("/{agent_id}/configuration", response_model=AgentConfigurationOut)
def put_agent_configuration(
    agent_id: str,
    body: AgentConfigurationIn,
    user: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_PLATFORM_TECHNICAL))],
    db: Annotated[Session, Depends(get_db)],
) -> AgentConfigurationOut:
    _ensure_configure(db, user_id=user.user_id, agent_id=agent_id, permissions=user.permissions)
    try:
        agent = agent_service.update_configuration(
            db,
            agent_id=agent_id,
            system_prompt=body.system_prompt,
            llm_provider=body.llm_provider,
            llm_model=body.llm_model,
            temperature=body.temperature,
            tool_names=body.tool_names,
            skill_names=body.skill_names,
            approval_tool_names=body.approval_tool_names,
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
    _ensure_configure(db, user_id=user.user_id, agent_id=agent_id, permissions=user.permissions)
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
    _ensure_configure(db, user_id=user.user_id, agent_id=agent_id, permissions=user.permissions)
    try:
        agent = agent_service.deactivate_agent(db, agent_id=agent_id)
    except agent_service.AgentNotFoundError as exc:
        raise _http_agent_not_found() from exc
    return AgentOut.model_validate(agent)
