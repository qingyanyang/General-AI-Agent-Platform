"""Persisted agent catalog records (#19) and configuration (#20)."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    String,
    Text,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.models.base import Base, postgres_schema_name


class AgentStatus(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"


class AgentAuthorizationMode(StrEnum):
    LEGACY_GRANTS = "legacy_grants"
    AUDIENCE = "audience"


class AgentAudienceMode(StrEnum):
    COMPANY = "company"
    GROUPS = "groups"


class Agent(Base):
    __tablename__ = "agents"
    __table_args__ = (
        Index("ix_agents_status_created_at", "status", "created_at"),
        CheckConstraint(
            "authorization_mode IN ('legacy_grants', 'audience')",
            name="ck_agents_authorization_mode",
        ),
        CheckConstraint(
            "audience_mode IS NULL OR audience_mode IN ('company', 'groups')",
            name="ck_agents_audience_mode",
        ),
        Index("ix_agents_owning_group_id", "owning_group_id"),
        {"schema": postgres_schema_name()},
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default=AgentStatus.ACTIVE.value,
    )
    created_by: Mapped[str] = mapped_column(String(512), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    # Configuration (#20)
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    llm_provider: Mapped[str] = mapped_column(String(32), nullable=False)
    llm_model: Mapped[str] = mapped_column(String(128), nullable=False)
    temperature: Mapped[float | None] = mapped_column(Float, nullable=True)
    tool_names: Mapped[list[Any]] = mapped_column(JSON, nullable=False, default=list)
    skill_names: Mapped[list[Any]] = mapped_column(
        JSON, nullable=False, default=list, server_default=text("'[]'")
    )
    approval_tool_names: Mapped[list[Any]] = mapped_column(
        JSON, nullable=False, default=list, server_default=text("'[]'")
    )
    # Access audience / owning group (Issues 3–4). Effective when authorization_mode=audience.
    authorization_mode: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default=AgentAuthorizationMode.LEGACY_GRANTS.value,
        server_default=text("'legacy_grants'"),
    )
    audience_mode: Mapped[str | None] = mapped_column(String(32), nullable=True)
    owning_group_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey(
            f"{postgres_schema_name()}.groups.id",
            ondelete="SET NULL",
            name="fk_agents_owning_group_id",
        ),
        nullable=True,
    )
