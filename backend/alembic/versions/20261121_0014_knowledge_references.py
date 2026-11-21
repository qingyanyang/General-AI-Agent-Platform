"""Persist agent knowledge references."""

import sqlalchemy as sa
from alembic import op

from app.models.base import DEFAULT_POSTGRES_SCHEMA

revision = "20261121_0014"
down_revision = "20261120_0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agents",
        sa.Column("knowledge_references", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        schema=DEFAULT_POSTGRES_SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("agents", "knowledge_references", schema=DEFAULT_POSTGRES_SCHEMA)
