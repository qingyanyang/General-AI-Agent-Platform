"""Group and membership API schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

GROUP_NAME_MAX_LENGTH = 120
GROUP_DESCRIPTION_MAX_LENGTH = 4000
DesignationLiteral = Literal["member", "leader"]


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=GROUP_NAME_MAX_LENGTH)
    description: str | None = Field(default=None, max_length=GROUP_DESCRIPTION_MAX_LENGTH)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("name must be a non-empty string")
        if len(stripped) > GROUP_NAME_MAX_LENGTH:
            raise ValueError(f"name must be at most {GROUP_NAME_MAX_LENGTH} characters")
        return stripped

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class GroupOut(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class GroupListItemOut(GroupOut):
    designation: DesignationLiteral | None
    member_count: int = 0
    agent_count: int = 0


class GroupListOut(BaseModel):
    items: list[GroupListItemOut]
    next_cursor: str | None


class GroupDetailOut(GroupOut):
    designation: DesignationLiteral | None
    member_count: int = 0
    agent_count: int = 0


class GroupAgentOut(BaseModel):
    agent_id: str
    agent_name: str | None
    is_owning: bool


class GroupAgentListOut(BaseModel):
    items: list[GroupAgentOut]


class GroupAgentAssign(BaseModel):
    agent_id: str = Field(min_length=1, max_length=64)


class MembershipUpsert(BaseModel):
    user_id: str = Field(min_length=1, max_length=512)
    designation: DesignationLiteral


class MembershipOut(BaseModel):
    group_id: uuid.UUID
    user_id: str
    designation: DesignationLiteral
    display_name: str | None = None
    email: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MembershipListOut(BaseModel):
    items: list[MembershipOut]
    next_cursor: str | None
