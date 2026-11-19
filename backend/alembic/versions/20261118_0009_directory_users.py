"""Create directory_users for validated access-token subjects.

Revision ID: 20261118_0009
Revises: 20261112_0008
Create Date: 2026-11-18

Parent is the Alembic head resolved from the script directory before this file
was added (``20261112_0008``). Keep SCHEMA aligned with
``app.models.base.DEFAULT_POSTGRES_SCHEMA``.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.models.base import DEFAULT_POSTGRES_SCHEMA

revision: str = "20261118_0009"
down_revision: Union[str, None] = "20261112_0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = DEFAULT_POSTGRES_SCHEMA


def upgrade() -> None:
    op.create_table(
        "directory_users",
        sa.Column("user_id", sa.String(length=512), nullable=False),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("user_id"),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_table("directory_users", schema=SCHEMA)
