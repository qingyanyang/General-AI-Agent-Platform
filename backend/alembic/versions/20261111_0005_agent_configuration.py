"""Add agent configuration columns (#20).

Revision ID: 20261111_0005
Revises: 20261111_0004
Create Date: 2026-11-11

Fixed literal backfill only — does not read env or approved-model catalog.
Demo/runtime uses DeepSeek; backfill provider/model/temperature accordingly.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.models.base import DEFAULT_POSTGRES_SCHEMA

revision: str = "20261111_0005"
down_revision: Union[str, None] = "20261111_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = DEFAULT_POSTGRES_SCHEMA


def upgrade() -> None:
    op.add_column(
        "agents",
        sa.Column(
            "system_prompt",
            sa.Text(),
            nullable=False,
            server_default="",
        ),
        schema=SCHEMA,
    )
    op.add_column(
        "agents",
        sa.Column("llm_provider", sa.String(length=32), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "agents",
        sa.Column("llm_model", sa.String(length=128), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "agents",
        sa.Column("temperature", sa.Float(), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "agents",
        sa.Column("tool_names", sa.JSON(), nullable=True),
        schema=SCHEMA,
    )

    # Fixed literals — never read Settings / APPROVED_LLM_MODELS here.
    op.execute(
        sa.text(
            f"UPDATE {SCHEMA}.agents SET "
            "system_prompt = '', "
            "llm_provider = 'deepseek', "
            "llm_model = 'deepseek-flash', "
            "temperature = 1.0, "
            "tool_names = '[]'"
        )
    )
    op.execute(
        sa.text(
            f"UPDATE {SCHEMA}.agents SET "
            "tool_names = '[\"add\", \"multiply\", \"echo\"]' "
            "WHERE id = 'default'"
        )
    )

    op.alter_column(
        "agents",
        "llm_provider",
        existing_type=sa.String(length=32),
        nullable=False,
        schema=SCHEMA,
    )
    op.alter_column(
        "agents",
        "llm_model",
        existing_type=sa.String(length=128),
        nullable=False,
        schema=SCHEMA,
    )
    op.alter_column(
        "agents",
        "tool_names",
        existing_type=sa.JSON(),
        nullable=False,
        schema=SCHEMA,
    )
    op.alter_column(
        "agents",
        "system_prompt",
        server_default=None,
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("agents", "tool_names", schema=SCHEMA)
    op.drop_column("agents", "temperature", schema=SCHEMA)
    op.drop_column("agents", "llm_model", schema=SCHEMA)
    op.drop_column("agents", "llm_provider", schema=SCHEMA)
    op.drop_column("agents", "system_prompt", schema=SCHEMA)
