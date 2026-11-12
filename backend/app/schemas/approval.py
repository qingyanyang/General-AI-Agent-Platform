"""Human approval payloads for a paused tool call (#24)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class PendingApproval(BaseModel):
    """One gated tool call waiting for a decision."""

    execution_id: str
    interrupt_id: str
    checkpoint_id: str
    tool_call_id: str
    tool_name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class ApprovalDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tool_call_id: str = Field(min_length=1, max_length=128)


class ApprovalListOut(BaseModel):
    items: list[PendingApproval]
