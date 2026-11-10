"""Create agent_access_grants for per-agent capabilities (#17).

Revision ID: 20261110_0003
Revises: 20261110_0002
Create Date: 2026-11-10

Keep SCHEMA in sync with app.models.base.DEFAULT_POSTGRES_SCHEMA / POSTGRES_SCHEMA.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.models.base import DEFAULT_POSTGRES_SCHEMA

revision: str = "20261110_0003"
down_revision: Union[str, None] = "20261110_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = DEFAULT_POSTGRES_SCHEMA


def upgrade() -> None:
    op.create_table(
        "agent_access_grants",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.String(length=512), nullable=False),
        sa.Column("agent_id", sa.String(length=64), nullable=False),
        sa.Column("can_view", sa.Boolean(), nullable=False),
        sa.Column("can_configure", sa.Boolean(), nullable=False),
        sa.Column("can_execute", sa.Boolean(), nullable=False),
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
        sa.UniqueConstraint(
            "user_id",
            "agent_id",
            name="uq_agent_access_grants_user_agent",
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_agent_access_grants_user_id",
        "agent_access_grants",
        ["user_id"],
        unique=False,
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_agent_access_grants_user_id",
        table_name="agent_access_grants",
        schema=SCHEMA,
    )
    op.drop_table("agent_access_grants", schema=SCHEMA)
