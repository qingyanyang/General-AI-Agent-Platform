"""Agent access grant API schemas (#17)."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class AgentAccessGrantUpsert(BaseModel):
    user_id: str = Field(min_length=1, max_length=512)
    agent_id: str = Field(min_length=1, max_length=64)
    can_view: bool
    can_configure: bool
    can_execute: bool


class AgentAccessGrantOut(BaseModel):
    id: uuid.UUID
    user_id: str
    agent_id: str
    can_view: bool
    can_configure: bool
    can_execute: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AgentAccessGrantListOut(BaseModel):
    items: list[AgentAccessGrantOut]
    next_cursor: str | None
