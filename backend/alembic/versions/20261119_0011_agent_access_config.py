"""Add staged agent audience, owning group, and group assignments.

Revision ID: 20261119_0011
Revises: 20261119_0010
Create Date: 2026-11-19

Parent is the Alembic head resolved from the script directory before this file
was added (``20261119_0010``). Keep SCHEMA aligned with
``app.models.base.DEFAULT_POSTGRES_SCHEMA``.

Staged settings are not enforced for Chat until Issue 4. Existing agents are
backfilled to ``authorization_mode = legacy_grants``.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.models.base import DEFAULT_POSTGRES_SCHEMA

revision: str = "20261119_0011"
down_revision: Union[str, None] = "20261119_0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = DEFAULT_POSTGRES_SCHEMA


def upgrade() -> None:
    op.add_column(
        "agents",
        sa.Column(
            "authorization_mode",
            sa.String(length=32),
            server_default="legacy_grants",
            nullable=False,
        ),
        schema=SCHEMA,
    )
    op.add_column(
        "agents",
        sa.Column("audience_mode", sa.String(length=32), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "agents",
        sa.Column("owning_group_id", sa.Uuid(), nullable=True),
        schema=SCHEMA,
    )
    op.create_check_constraint(
        "ck_agents_authorization_mode",
        "agents",
        "authorization_mode IN ('legacy_grants', 'audience')",
        schema=SCHEMA,
    )
    op.create_check_constraint(
        "ck_agents_audience_mode",
        "agents",
        "audience_mode IS NULL OR audience_mode IN ('company', 'groups')",
        schema=SCHEMA,
    )
    op.create_foreign_key(
        "fk_agents_owning_group_id",
        "agents",
        "groups",
        ["owning_group_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_agents_owning_group_id",
        "agents",
        ["owning_group_id"],
        unique=False,
        schema=SCHEMA,
    )
    op.create_table(
        "agent_group_assignments",
        sa.Column("agent_id", sa.String(length=64), nullable=False),
        sa.Column("group_id", sa.Uuid(), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["agent_id"],
            [f"{SCHEMA}.agents.id"],
            name="fk_agent_group_assignments_agent_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["group_id"],
            [f"{SCHEMA}.groups.id"],
            name="fk_agent_group_assignments_group_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("agent_id", "group_id"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_agent_group_assignments_group_id",
        "agent_group_assignments",
        ["group_id"],
        unique=False,
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_agent_group_assignments_group_id",
        table_name="agent_group_assignments",
        schema=SCHEMA,
    )
    op.drop_table("agent_group_assignments", schema=SCHEMA)
    op.drop_index("ix_agents_owning_group_id", table_name="agents", schema=SCHEMA)
    op.drop_constraint(
        "fk_agents_owning_group_id",
        "agents",
        schema=SCHEMA,
        type_="foreignkey",
    )
    op.drop_constraint(
        "ck_agents_audience_mode",
        "agents",
        schema=SCHEMA,
        type_="check",
    )
    op.drop_constraint(
        "ck_agents_authorization_mode",
        "agents",
        schema=SCHEMA,
        type_="check",
    )
    op.drop_column("agents", "owning_group_id", schema=SCHEMA)
    op.drop_column("agents", "audience_mode", schema=SCHEMA)
    op.drop_column("agents", "authorization_mode", schema=SCHEMA)
