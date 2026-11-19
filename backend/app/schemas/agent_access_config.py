"""Staged agent audience / owning-group API schemas (Issue 3)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

AudienceModeLiteral = Literal["company", "groups"]
AuthorizationModeLiteral = Literal["legacy_grants", "audience"]


class AgentAccessConfigUpdate(BaseModel):
    """Full replacement of staged access configuration.

    All three fields are required (``owning_group_id`` may be null).
    ``authorization_mode`` and other unknown fields are rejected.
    """

    model_config = ConfigDict(extra="forbid")

    audience_mode: AudienceModeLiteral
    owning_group_id: uuid.UUID | None
    group_ids: list[uuid.UUID]


class AgentAccessConfigGroupOut(BaseModel):
    group_id: uuid.UUID
    name: str
    is_owning: bool


class AgentAccessConfigOut(BaseModel):
    agent_id: str
    authorization_mode: AuthorizationModeLiteral
    audience_effective: bool
    audience_mode: AudienceModeLiteral | None
    owning_group_id: uuid.UUID | None
    owning_group_name: str | None
    group_ids: list[uuid.UUID]
    groups: list[AgentAccessConfigGroupOut]
    updated_at: datetime
