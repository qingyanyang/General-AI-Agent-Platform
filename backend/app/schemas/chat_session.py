"""Chat session API schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

DEFAULT_SESSION_TITLE = "New chat"
AGENT_ID_MAX_LENGTH = 64
TITLE_MAX_LENGTH = 255


class ChatSessionCreate(BaseModel):
    agent_id: str = Field(min_length=1, max_length=AGENT_ID_MAX_LENGTH)
    title: str | None = Field(default=None, max_length=TITLE_MAX_LENGTH)

    @field_validator("agent_id")
    @classmethod
    def strip_agent_id(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("agent_id must be a non-empty string")
        if len(stripped) > AGENT_ID_MAX_LENGTH:
            raise ValueError(f"agent_id must be at most {AGENT_ID_MAX_LENGTH} characters")
        return stripped

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("title must be a non-empty string when provided")
        if len(stripped) > TITLE_MAX_LENGTH:
            raise ValueError(f"title must be at most {TITLE_MAX_LENGTH} characters")
        return stripped


class ChatSessionOut(BaseModel):
    id: uuid.UUID
    user_id: str
    agent_id: str
    title: str
    created_at: datetime
    last_activity_at: datetime

    model_config = {"from_attributes": True}


class ChatSessionListOut(BaseModel):
    items: list[ChatSessionOut]
    next_cursor: str | None
