"""Create groups and group_memberships.

Revision ID: 20261119_0010
Revises: 20261118_0009
Create Date: 2026-11-19

Parent is the Alembic head resolved from the script directory before this file
was added (``20261118_0009``). Keep SCHEMA aligned with
``app.models.base.DEFAULT_POSTGRES_SCHEMA``.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.models.base import DEFAULT_POSTGRES_SCHEMA

revision: str = "20261119_0010"
down_revision: Union[str, None] = "20261118_0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = DEFAULT_POSTGRES_SCHEMA


def upgrade() -> None:
    op.create_table(
        "groups",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
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
        sa.UniqueConstraint("name", name="uq_groups_name"),
        schema=SCHEMA,
    )
    op.create_table(
        "group_memberships",
        sa.Column("group_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.String(length=512), nullable=False),
        sa.Column("designation", sa.String(length=32), nullable=False),
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
        sa.CheckConstraint(
            "designation IN ('member', 'leader')",
            name="ck_group_memberships_designation",
        ),
        sa.ForeignKeyConstraint(
            ["group_id"],
            [f"{SCHEMA}.groups.id"],
            name="fk_group_memberships_group_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            [f"{SCHEMA}.directory_users.user_id"],
            name="fk_group_memberships_user_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("group_id", "user_id"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_group_memberships_user_id",
        "group_memberships",
        ["user_id"],
        unique=False,
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_group_memberships_user_id",
        table_name="group_memberships",
        schema=SCHEMA,
    )
    op.drop_table("group_memberships", schema=SCHEMA)
    op.drop_table("groups", schema=SCHEMA)
