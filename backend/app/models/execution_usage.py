"""Content-free observations scoped to one Agent execution."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, ForeignKey, Numeric, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, postgres_schema_name

_SCHEMA = postgres_schema_name()


class ExecutionModelCall(Base):
    __tablename__ = "execution_model_calls"
    __table_args__ = {"schema": _SCHEMA}

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    execution_id: Mapped[UUID] = mapped_column(
        ForeignKey(f"{_SCHEMA}.agent_executions.id", ondelete="CASCADE"),
        index=True,
    )
    provider: Mapped[str] = mapped_column(String(32))
    requested_model: Mapped[str] = mapped_column(String(128))
    reported_model: Mapped[str | None] = mapped_column(String(128))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    duration_ms: Mapped[int | None] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(String(16))
    input_tokens: Mapped[int | None] = mapped_column(BigInteger)
    output_tokens: Mapped[int | None] = mapped_column(BigInteger)
    total_tokens: Mapped[int | None] = mapped_column(BigInteger)
    cached_input_tokens: Mapped[int | None] = mapped_column(BigInteger)
    cache_write_tokens: Mapped[int | None] = mapped_column(BigInteger)
    usage_incomplete: Mapped[bool] = mapped_column(Boolean, default=False)
    estimated_cost: Mapped[Decimal | None] = mapped_column(Numeric(38, 18))
    currency: Mapped[str | None] = mapped_column(String(3))
    pricing_snapshot: Mapped[dict | None] = mapped_column(JSON(none_as_null=True))


class ExecutionToolCall(Base):
    __tablename__ = "execution_tool_calls"
    __table_args__ = {"schema": _SCHEMA}

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    execution_id: Mapped[UUID] = mapped_column(
        ForeignKey(f"{_SCHEMA}.agent_executions.id", ondelete="CASCADE"),
        index=True,
    )
    name: Mapped[str] = mapped_column(String(128))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    duration_ms: Mapped[int | None] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(String(16))
