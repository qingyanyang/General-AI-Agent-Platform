"""Add agent skill_names column (#23).

Revision ID: 20261112_0007
Revises: 20261111_0006
Create Date: 2026-11-12

Empty list means no skills assigned (fail closed).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.models.base import DEFAULT_POSTGRES_SCHEMA

revision: str = "20261112_0007"
down_revision: Union[str, None] = "20261111_0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = DEFAULT_POSTGRES_SCHEMA


def upgrade() -> None:
    op.add_column(
        "agents",
        sa.Column("skill_names", sa.JSON(), nullable=True),
        schema=SCHEMA,
    )
    op.execute(
        sa.text(f"UPDATE {SCHEMA}.agents SET skill_names = '[]' WHERE skill_names IS NULL")
    )
    op.alter_column(
        "agents",
        "skill_names",
        existing_type=sa.JSON(),
        nullable=False,
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("agents", "skill_names", schema=SCHEMA)
