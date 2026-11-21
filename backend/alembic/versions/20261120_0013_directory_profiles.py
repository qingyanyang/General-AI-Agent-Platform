"""Add directory profile columns used by invitations and verified sign-in.

Revision ID: 20261120_0013
Revises: 20261120_0012
Create Date: 2026-11-20
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.models.base import DEFAULT_POSTGRES_SCHEMA

revision: str = "20261120_0013"
down_revision: Union[str, None] = "20261120_0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = DEFAULT_POSTGRES_SCHEMA


def upgrade() -> None:
    op.add_column(
        "directory_users",
        sa.Column("email", sa.String(length=320), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "directory_users",
        sa.Column("display_name", sa.String(length=256), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "directory_users",
        sa.Column(
            "email_verified",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        schema=SCHEMA,
    )
    op.add_column(
        "directory_users",
        sa.Column("role", sa.String(length=32), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "directory_users",
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default="active",
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "uq_directory_users_email",
        "directory_users",
        ["email"],
        unique=True,
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_index("uq_directory_users_email", table_name="directory_users", schema=SCHEMA)
    op.drop_column("directory_users", "status", schema=SCHEMA)
    op.drop_column("directory_users", "role", schema=SCHEMA)
    op.drop_column("directory_users", "email_verified", schema=SCHEMA)
    op.drop_column("directory_users", "display_name", schema=SCHEMA)
    op.drop_column("directory_users", "email", schema=SCHEMA)
