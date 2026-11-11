"""Create agents table and seed default agent (#19).

Revision ID: 20261111_0004
Revises: 20261110_0003
Create Date: 2026-11-11

Keep SCHEMA in sync with app.models.base.DEFAULT_POSTGRES_SCHEMA / POSTGRES_SCHEMA.
Seeds a fixed active agent id=default (does not read runtime AGENT_ID).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.models.base import DEFAULT_POSTGRES_SCHEMA

revision: str = "20261111_0004"
down_revision: Union[str, None] = "20261110_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = DEFAULT_POSTGRES_SCHEMA


def upgrade() -> None:
    op.create_table(
        "agents",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_by", sa.String(length=512), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_agents_status_created_at",
        "agents",
        ["status", "created_at"],
        unique=False,
        schema=SCHEMA,
    )
    op.execute(
        sa.text(
            f"INSERT INTO {SCHEMA}.agents "
            "(id, name, description, status, created_by) "
            "VALUES ('default', 'Default', NULL, 'active', 'system')"
        )
    )


def downgrade() -> None:
    op.drop_index(
        "ix_agents_status_created_at",
        table_name="agents",
        schema=SCHEMA,
    )
    op.drop_table("agents", schema=SCHEMA)
