"""Group and membership API schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

GROUP_NAME_MAX_LENGTH = 120
DesignationLiteral = Literal["member", "leader"]


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=GROUP_NAME_MAX_LENGTH)
    description: str | None = None

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("name must be a non-empty string")
        if len(stripped) > GROUP_NAME_MAX_LENGTH:
            raise ValueError(f"name must be at most {GROUP_NAME_MAX_LENGTH} characters")
        return stripped


class GroupOut(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class GroupListItemOut(GroupOut):
    designation: DesignationLiteral | None


class GroupListOut(BaseModel):
    items: list[GroupListItemOut]
    next_cursor: str | None


class GroupDetailOut(GroupOut):
    designation: DesignationLiteral | None


class MembershipUpsert(BaseModel):
    user_id: str = Field(min_length=1, max_length=512)
    designation: DesignationLiteral


class MembershipOut(BaseModel):
    group_id: uuid.UUID
    user_id: str
    designation: DesignationLiteral
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MembershipListOut(BaseModel):
    items: list[MembershipOut]
    next_cursor: str | None
