"""Per-user agent capability grants (#17)."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Index, String, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, postgres_schema_name


class AgentAccessGrant(Base):
    __tablename__ = "agent_access_grants"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "agent_id",
            name="uq_agent_access_grants_user_agent",
        ),
        Index("ix_agent_access_grants_user_id", "user_id"),
        {"schema": postgres_schema_name()},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[str] = mapped_column(String(512), nullable=False)
    agent_id: Mapped[str] = mapped_column(String(64), nullable=False)
    can_view: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    can_configure: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    can_execute: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
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
