"""Alembic environment.

Creates POSTGRES_SCHEMA before the version table so version_table_schema works.
"""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool, text

from app.core.config import get_settings
from app.models.agent_access_grant import AgentAccessGrant  # noqa: F401 — register metadata
from app.models.agent_group_assignment import AgentGroupAssignment  # noqa: F401 — register metadata
from app.models.base import Base, postgres_schema_name
from app.models.chat_session import ChatSession  # noqa: F401 — register metadata
from app.models.directory_user import DirectoryUser  # noqa: F401 — register metadata
from app.models.group import Group, GroupMembership  # noqa: F401 — register metadata
from app.models.session_run_gate import SessionRunGate  # noqa: F401 — register metadata

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata
settings = get_settings()
SCHEMA = postgres_schema_name()


def get_url() -> str:
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is required for Alembic")
    return settings.database_url


def schema_bootstrap_sql() -> str:
    return f'CREATE SCHEMA IF NOT EXISTS "{SCHEMA}"'


def ensure_schema(connection) -> None:  # noqa: ANN001
    connection.execute(text(schema_bootstrap_sql()))
    connection.commit()


def run_migrations_offline() -> None:
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        version_table_schema=SCHEMA,
        include_schemas=True,
    )

    with context.begin_transaction():
        # Emit schema bootstrap before the version table / revisions (parity with online).
        context.execute(text(schema_bootstrap_sql()))
        context.run_migrations()


def run_migrations_online() -> None:
    configuration = config.get_section(config.config_ini_section) or {}
    configuration["sqlalchemy.url"] = get_url()
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        ensure_schema(connection)
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            version_table_schema=SCHEMA,
            include_schemas=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
