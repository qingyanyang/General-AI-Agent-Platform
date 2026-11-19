"""Staged agent ↔ group access assignments (Issue 3).

Rows are configuration only while ``agents.authorization_mode`` is
``legacy_grants``. Chat enforcement begins in Issue 4.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, postgres_schema_name


class AgentGroupAssignment(Base):
    __tablename__ = "agent_group_assignments"
    __table_args__ = (
        Index("ix_agent_group_assignments_group_id", "group_id"),
        {"schema": postgres_schema_name()},
    )

    agent_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey(
            f"{postgres_schema_name()}.agents.id",
            ondelete="CASCADE",
            name="fk_agent_group_assignments_agent_id",
        ),
        primary_key=True,
    )
    group_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey(
            f"{postgres_schema_name()}.groups.id",
            ondelete="CASCADE",
            name="fk_agent_group_assignments_group_id",
        ),
        primary_key=True,
    )
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
