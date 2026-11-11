"""Create agent_executions table (#21).

Revision ID: 20261111_0006
Revises: 20261111_0005
Create Date: 2026-11-11

Metadata-only execution history. Does not store conversation content.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.models.base import DEFAULT_POSTGRES_SCHEMA

revision: str = "20261111_0006"
down_revision: Union[str, None] = "20261111_0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = DEFAULT_POSTGRES_SCHEMA


def upgrade() -> None:
    op.create_table(
        "agent_executions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.String(length=512), nullable=False),
        sa.Column("agent_id", sa.String(length=64), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_ms", sa.BigInteger(), nullable=True),
        sa.Column("error_summary", sa.Text(), nullable=True),
        sa.Column("langsmith_run_id", sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_agent_executions_user_started",
        "agent_executions",
        ["user_id", "started_at"],
        unique=False,
        schema=SCHEMA,
    )
    op.create_index(
        "ix_agent_executions_agent_started",
        "agent_executions",
        ["agent_id", "started_at"],
        unique=False,
        schema=SCHEMA,
    )
    op.create_index(
        "ix_agent_executions_session_started",
        "agent_executions",
        ["session_id", "started_at"],
        unique=False,
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_agent_executions_session_started",
        table_name="agent_executions",
        schema=SCHEMA,
    )
    op.drop_index(
        "ix_agent_executions_agent_started",
        table_name="agent_executions",
        schema=SCHEMA,
    )
    op.drop_index(
        "ix_agent_executions_user_started",
        table_name="agent_executions",
        schema=SCHEMA,
    )
    op.drop_table("agent_executions", schema=SCHEMA)
