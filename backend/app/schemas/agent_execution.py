"""Agent execution history API schemas (#21)."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.chat_session import AGENT_ID_MAX_LENGTH


class ExecutionStatusFilter(StrEnum):
    RUNNING = "running"
    AWAITING_APPROVAL = "awaiting_approval"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ExecutionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: str
    agent_id: str = Field(max_length=AGENT_ID_MAX_LENGTH)
    session_id: uuid.UUID | None
    status: str
    started_at: datetime
    completed_at: datetime | None
    duration_ms: int | None
    error_summary: str | None
    langsmith_run_id: str


class ExecutionListOut(BaseModel):
    items: list[ExecutionOut]
    next_cursor: str | None = None


class ExecutionSummaryOut(BaseModel):
    total: int
    by_status: dict[str, int]


class ExecutionUsageOut(ExecutionListOut):
    summary: ExecutionSummaryOut
