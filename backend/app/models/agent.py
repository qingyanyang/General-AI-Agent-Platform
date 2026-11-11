"""Persisted agent catalog records (#19)."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, postgres_schema_name


class AgentStatus(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"


class Agent(Base):
    __tablename__ = "agents"
    __table_args__ = (
        Index("ix_agents_status_created_at", "status", "created_at"),
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
