"""Agent execution history API schemas (#21)."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.core.model_rates import ModelRate
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


class UsageCompleteness(StrEnum):
    NOT_CAPTURED = "not_captured"
    UNKNOWN = "unknown"
    PARTIAL = "partial"
    COMPLETE = "complete"


class TokenUsageOut(BaseModel):
    completeness: UsageCompleteness
    input_tokens: int | None
    output_tokens: int | None
    total_tokens: int | None


class CurrencyCostOut(BaseModel):
    currency: str
    amount: Decimal

    @field_serializer("amount")
    def serialize_amount(self, amount: Decimal) -> str:
        return format(amount, "f")


class EstimatedCostOut(BaseModel):
    completeness: UsageCompleteness
    totals: list[CurrencyCostOut]


class UsedModelOut(BaseModel):
    provider: str
    model: str


class ExecutionUsageItemOut(ExecutionOut):
    models: list[UsedModelOut]
    tokens: TokenUsageOut
    estimated_model_cost: EstimatedCostOut


class ExecutionUsageOut(BaseModel):
    items: list[ExecutionUsageItemOut]
    next_cursor: str | None = None
    summary: ExecutionSummaryOut


class ModelCallOut(BaseModel):
    id: uuid.UUID
    provider: str
    requested_model: str
    reported_model: str | None
    started_at: datetime
    status: str
    duration_ms: int | None
    tokens: TokenUsageOut
    cached_input_tokens: int | None
    cache_write_tokens: int | None
    estimated_model_cost: EstimatedCostOut
    pricing_snapshot: ModelRate | None


class ToolCallOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    started_at: datetime
    status: str
    duration_ms: int | None


class ExecutionUsageDetailOut(ExecutionUsageItemOut):
    model_calls: list[ModelCallOut]
    tool_calls: list[ToolCallOut]
