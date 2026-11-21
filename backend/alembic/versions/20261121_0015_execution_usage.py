"""Record model usage and tool timing per execution."""

import sqlalchemy as sa
from alembic import op
from app.models.base import DEFAULT_POSTGRES_SCHEMA

revision = "20261121_0015"
down_revision = "20261121_0014"
branch_labels = None
depends_on = None
SCHEMA = DEFAULT_POSTGRES_SCHEMA


def upgrade() -> None:
    op.add_column("agent_executions", sa.Column("usage_capture", sa.String(16)), schema=SCHEMA)
    op.create_table(
        "execution_model_calls",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "execution_id",
            sa.Uuid(),
            sa.ForeignKey(
                f"{SCHEMA}.agent_executions.id",
                ondelete="CASCADE",
            ),
            nullable=False,
        ),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("requested_model", sa.String(128), nullable=False),
        sa.Column("reported_model", sa.String(128)),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_ms", sa.BigInteger()),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("input_tokens", sa.BigInteger()),
        sa.Column("output_tokens", sa.BigInteger()),
        sa.Column("total_tokens", sa.BigInteger()),
        sa.Column("cached_input_tokens", sa.BigInteger()),
        sa.Column("cache_write_tokens", sa.BigInteger()),
        sa.Column("usage_incomplete", sa.Boolean(), nullable=False),
        sa.Column("estimated_cost", sa.Numeric(38, 18)),
        sa.Column("currency", sa.String(3)),
        sa.Column("pricing_snapshot", sa.JSON(none_as_null=True)),
        schema=SCHEMA,
    )
    op.create_table(
        "execution_tool_calls",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "execution_id",
            sa.Uuid(),
            sa.ForeignKey(
                f"{SCHEMA}.agent_executions.id",
                ondelete="CASCADE",
            ),
            nullable=False,
        ),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_ms", sa.BigInteger()),
        sa.Column("status", sa.String(16), nullable=False),
        schema=SCHEMA,
    )
    for table in ("execution_model_calls", "execution_tool_calls"):
        op.create_index(f"ix_{SCHEMA}_{table}_execution_id", table, ["execution_id"], schema=SCHEMA)


def downgrade() -> None:
    op.drop_table("execution_tool_calls", schema=SCHEMA)
    op.drop_table("execution_model_calls", schema=SCHEMA)
    op.drop_column("agent_executions", "usage_capture", schema=SCHEMA)
