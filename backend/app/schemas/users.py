"""Directory and invitation API schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

RoleLiteral = Literal["user", "admin", "super-admin"]
StatusLiteral = Literal["active", "pending", "disabled"]
MutableStatusLiteral = Literal["active", "disabled"]


class DirectoryUserOut(BaseModel):
    user_id: str
    email: str | None
    display_name: str | None
    email_verified: bool
    role: str | None
    status: str
    first_seen_at: datetime
    last_seen_at: datetime

    model_config = {"from_attributes": True}


class UserMembershipOut(BaseModel):
    group_id: uuid.UUID
    group_name: str
    designation: Literal["member", "leader"]


class UserDetailOut(DirectoryUserOut):
    memberships: list[UserMembershipOut]


class AccessSourceOut(BaseModel):
    kind: Literal["company", "group", "grant"]
    group_id: uuid.UUID | None = None
    name: str | None = None


class EffectiveAccessOut(BaseModel):
    agent_id: str
    agent_name: str | None
    can_use: bool
    can_edit_prompt: bool
    sources: list[AccessSourceOut]


class EffectiveAccessListOut(BaseModel):
    items: list[EffectiveAccessOut]


class UserListOut(BaseModel):
    items: list[DirectoryUserOut]
    next_cursor: str | None


class InvitationCreate(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    role: RoleLiteral
    group_id: uuid.UUID | None = None


class UserUpdate(BaseModel):
    role: RoleLiteral | None = None
    status: MutableStatusLiteral | None = None
