"""Groups and per-group Member/Leader designations."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, postgres_schema_name


class GroupDesignation(StrEnum):
    MEMBER = "member"
    LEADER = "leader"


class Group(Base):
    __tablename__ = "groups"
    __table_args__ = (
        UniqueConstraint("name", name="uq_groups_name"),
        {"schema": postgres_schema_name()},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
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


class GroupMembership(Base):
    __tablename__ = "group_memberships"
    __table_args__ = (
        CheckConstraint(
            "designation IN ('member', 'leader')",
            name="ck_group_memberships_designation",
        ),
        Index("ix_group_memberships_user_id", "user_id"),
        {"schema": postgres_schema_name()},
    )

    group_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey(
            f"{postgres_schema_name()}.groups.id",
            ondelete="CASCADE",
            name="fk_group_memberships_group_id",
        ),
        primary_key=True,
    )
    user_id: Mapped[str] = mapped_column(
        String(512),
        ForeignKey(
            f"{postgres_schema_name()}.directory_users.user_id",
            ondelete="RESTRICT",
            name="fk_group_memberships_user_id",
        ),
        primary_key=True,
    )
    designation: Mapped[str] = mapped_column(String(32), nullable=False)
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
