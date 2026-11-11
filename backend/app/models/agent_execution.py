"""Persisted agent execution metadata (#21)."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import BigInteger, DateTime, Index, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, postgres_schema_name


class AgentExecutionStatus(StrEnum):
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class AgentExecution(Base):
    """One invoke/stream turn. Metadata only — no conversation content."""

    __tablename__ = "agent_executions"
    __table_args__ = (
        Index("ix_agent_executions_user_started", "user_id", "started_at"),
        Index("ix_agent_executions_agent_started", "agent_id", "started_at"),
        Index("ix_agent_executions_session_started", "session_id", "started_at"),
        {"schema": postgres_schema_name()},
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(512), nullable=False)
    agent_id: Mapped[str] = mapped_column(String(64), nullable=False)
    session_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    duration_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    error_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    langsmith_run_id: Mapped[str] = mapped_column(String(64), nullable=False)
