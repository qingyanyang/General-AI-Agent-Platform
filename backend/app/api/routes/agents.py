"""Minimal agent invoke API for testing the LangGraph runtime."""

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.agents.errors import AgentExecutionError, AgentNotConfiguredError
from app.agents.runtime import run_agent

router = APIRouter(prefix="/agents", tags=["agents"])


class AgentRunRequest(BaseModel):
    message: str = Field(min_length=1)


class AgentMessageOut(BaseModel):
    role: str
    content: str


class AgentRunResponse(BaseModel):
    reply: str
    messages: list[AgentMessageOut]


@router.post("/run", response_model=AgentRunResponse)
async def agents_run(body: AgentRunRequest) -> AgentRunResponse:
    try:
        result = await run_agent(body.message)
    except AgentNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except AgentExecutionError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc

    return AgentRunResponse(
        reply=result.reply,
        messages=[
            AgentMessageOut(role=item.role, content=item.content) for item in result.messages
        ],
    )
