"""Published per-agent business Instruction Skills (Issue 5)."""

from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Index, Integer, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, postgres_schema_name


class AgentInstructionSkill(Base):
    __tablename__ = "agent_instruction_skills"
    __table_args__ = (
        UniqueConstraint(
            "agent_id",
            "position",
            name="uq_agent_instruction_skills_agent_position",
        ),
        Index("ix_agent_instruction_skills_agent_id", "agent_id"),
        {"schema": postgres_schema_name()},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    agent_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey(
            f"{postgres_schema_name()}.agents.id",
            ondelete="CASCADE",
            name="fk_agent_instruction_skills_agent_id",
        ),
        nullable=False,
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    instructions: Mapped[str] = mapped_column(Text, nullable=False)
