"""Agent catalog API schemas (#19)."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.chat_session import AGENT_ID_MAX_LENGTH

NAME_MAX_LENGTH = 255
DESCRIPTION_MAX_LENGTH = 4000


class AgentStatusFilter(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    ALL = "all"


class AgentCreate(BaseModel):
    id: str = Field(min_length=1, max_length=AGENT_ID_MAX_LENGTH)
    name: str = Field(min_length=1, max_length=NAME_MAX_LENGTH)
    description: str | None = Field(default=None, max_length=DESCRIPTION_MAX_LENGTH)

    @field_validator("id")
    @classmethod
    def strip_id(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("id must be a non-empty string")
        if len(stripped) > AGENT_ID_MAX_LENGTH:
            raise ValueError(f"id must be at most {AGENT_ID_MAX_LENGTH} characters")
        return stripped

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("name must be a non-empty string")
        if len(stripped) > NAME_MAX_LENGTH:
            raise ValueError(f"name must be at most {NAME_MAX_LENGTH} characters")
        return stripped

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class AgentUpdate(BaseModel):
    """PATCH body: only name/description.

    Omitted fields stay unchanged. Explicit ``description: null`` clears description.
    Use ``model_fields_set`` at the call site to distinguish omit vs null.
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=NAME_MAX_LENGTH)
    description: str | None = Field(default=None, max_length=DESCRIPTION_MAX_LENGTH)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("name must be a non-empty string")
        return stripped

    @field_validator("description")
    @classmethod
    def strip_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip()


class AgentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str | None
    status: str
    created_by: str
    created_at: datetime
    updated_at: datetime


class AgentListOut(BaseModel):
    items: list[AgentOut]
    next_cursor: str | None
