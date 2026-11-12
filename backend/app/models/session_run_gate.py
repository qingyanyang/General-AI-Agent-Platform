"""One run lock per chat session (#24)."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, postgres_schema_name


class SessionRunGate(Base):
    """Serializes message, run, and approval decisions for one session.

    ``lease_heartbeat_at`` is a diagnostic. A quiet heartbeat does not release the gate.
    """

    __tablename__ = "session_run_gates"
    __table_args__ = ({"schema": postgres_schema_name()},)

    session_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    state: Mapped[str] = mapped_column(String(32), nullable=False)
    execution_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    checkpoint_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    interrupt_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    tool_call_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    running_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lease_heartbeat_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
