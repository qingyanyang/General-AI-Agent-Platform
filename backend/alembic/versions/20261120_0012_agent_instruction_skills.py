"""Create agent_instruction_skills for published business instructions.

Revision ID: 20261120_0012
Revises: 20261119_0011
Create Date: 2026-11-20

Parent is the Alembic head resolved via ``ScriptDirectory.get_heads()``
immediately before this file was added (``20261119_0011``). Keep SCHEMA
aligned with ``app.models.base.DEFAULT_POSTGRES_SCHEMA``.

Existing agents start with an empty collection (no backfill rows).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.models.base import DEFAULT_POSTGRES_SCHEMA

revision: str = "20261120_0012"
down_revision: Union[str, None] = "20261119_0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = DEFAULT_POSTGRES_SCHEMA


def upgrade() -> None:
    op.create_table(
        "agent_instruction_skills",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("agent_id", sa.String(length=64), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["agent_id"],
            [f"{SCHEMA}.agents.id"],
            name="fk_agent_instruction_skills_agent_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "agent_id",
            "position",
            name="uq_agent_instruction_skills_agent_position",
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_agent_instruction_skills_agent_id",
        "agent_instruction_skills",
        ["agent_id"],
        unique=False,
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_agent_instruction_skills_agent_id",
        table_name="agent_instruction_skills",
        schema=SCHEMA,
    )
    op.drop_table("agent_instruction_skills", schema=SCHEMA)
