"""Widen chat_sessions.user_id for Auth0 subjects.

Revision ID: 20261110_0002
Revises: 20260309_0001
Create Date: 2026-11-10

Keep SCHEMA in sync with app.models.base.DEFAULT_POSTGRES_SCHEMA / POSTGRES_SCHEMA.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.models.base import DEFAULT_POSTGRES_SCHEMA

revision: str = "20261110_0002"
down_revision: Union[str, None] = "20260309_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = DEFAULT_POSTGRES_SCHEMA


def upgrade() -> None:
    op.alter_column(
        "chat_sessions",
        "user_id",
        existing_type=sa.String(length=128),
        type_=sa.String(length=512),
        existing_nullable=False,
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.alter_column(
        "chat_sessions",
        "user_id",
        existing_type=sa.String(length=512),
        type_=sa.String(length=128),
        existing_nullable=False,
        schema=SCHEMA,
    )
