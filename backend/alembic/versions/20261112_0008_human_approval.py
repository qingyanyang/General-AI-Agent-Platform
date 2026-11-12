"""Approval tool names, execution timing, and session run gates (#24).

Revision ID: 20261112_0008
Revises: 20261112_0007
Create Date: 2026-11-12

Parent is the Alembic head resolved when this revision was added.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.models.base import DEFAULT_POSTGRES_SCHEMA

revision: str = "20261112_0008"
down_revision: Union[str, None] = "20261112_0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = DEFAULT_POSTGRES_SCHEMA


def upgrade() -> None:
    op.add_column(
        "agents",
        sa.Column(
            "approval_tool_names",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'"),
        ),
        schema=SCHEMA,
    )
    op.add_column(
        "agent_executions",
        sa.Column(
            "active_duration_ms",
            sa.BigInteger(),
            nullable=False,
            server_default="0",
        ),
        schema=SCHEMA,
    )
    op.add_column(
        "agent_executions",
        sa.Column("running_since", sa.DateTime(timezone=True), nullable=True),
        schema=SCHEMA,
    )
    op.create_table(
        "session_run_gates",
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("state", sa.String(length=32), nullable=False),
        sa.Column("execution_id", sa.Uuid(), nullable=True),
        sa.Column("checkpoint_id", sa.String(length=128), nullable=True),
        sa.Column("interrupt_id", sa.String(length=128), nullable=True),
        sa.Column("tool_call_id", sa.String(length=128), nullable=True),
        sa.Column("running_since", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lease_heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("session_id"),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_table("session_run_gates", schema=SCHEMA)
    op.drop_column("agent_executions", "running_since", schema=SCHEMA)
    op.drop_column("agent_executions", "active_duration_ms", schema=SCHEMA)
    op.drop_column("agents", "approval_tool_names", schema=SCHEMA)
