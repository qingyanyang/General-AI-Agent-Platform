"""Create chat_sessions table.

Revision ID: 20260309_0001
Revises:
Create Date: 2026-03-09

Schema is created in alembic/env.py before the version table.
Keep SCHEMA in sync with app.models.base.DEFAULT_POSTGRES_SCHEMA / POSTGRES_SCHEMA.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.models.base import DEFAULT_POSTGRES_SCHEMA

revision: str = "20260309_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = DEFAULT_POSTGRES_SCHEMA


def upgrade() -> None:
    op.create_table(
        "chat_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.String(length=128), nullable=False),
        sa.Column("agent_id", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "last_activity_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_chat_sessions_user_last_activity",
        "chat_sessions",
        ["user_id", "last_activity_at"],
        unique=False,
        schema=SCHEMA,
        postgresql_ops={"last_activity_at": "DESC"},
    )
    op.create_index(
        "ix_chat_sessions_user_id_id",
        "chat_sessions",
        ["user_id", "id"],
        unique=False,
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_chat_sessions_user_id_id",
        table_name="chat_sessions",
        schema=SCHEMA,
    )
    op.drop_index(
        "ix_chat_sessions_user_last_activity",
        table_name="chat_sessions",
        schema=SCHEMA,
    )
    op.drop_table("chat_sessions", schema=SCHEMA)
