"""LangGraph PostgreSQL checkpointer lifecycle helpers.

Checkpoint tables live in CHECKPOINTS_SCHEMA (default ``langgraph``), separate
from ORM tables in POSTGRES_SCHEMA. DDL is owned by AsyncPostgresSaver.setup().
"""

from __future__ import annotations

import logging
import re
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from app.core.config import Settings

logger = logging.getLogger(__name__)

_SCHEMA_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def psycopg_conninfo(database_url: str) -> str:
    """Convert a SQLAlchemy-style URL to a psycopg conninfo string."""
    url = database_url.strip()
    if url.startswith("postgresql+psycopg://"):
        return "postgresql://" + url.removeprefix("postgresql+psycopg://")
    if url.startswith("postgres+psycopg://"):
        return "postgresql://" + url.removeprefix("postgres+psycopg://")
    return url


def thread_id_for_session(session_id: uuid.UUID) -> str:
    """LangGraph thread id for a chat session (1:1 with session primary key)."""
    return str(session_id)


def quote_ident(identifier: str) -> str:
    """Validate and double-quote a Postgres identifier (schema name)."""
    if not _SCHEMA_NAME_RE.fullmatch(identifier):
        raise ValueError(
            f"Invalid Postgres identifier {identifier!r}; "
            "use letters, digits, and underscores only",
        )
    return f'"{identifier}"'


async def ensure_checkpoints_schema(conninfo: str, schema: str) -> None:
    """Create the checkpoint schema if it does not exist."""
    quoted = quote_ident(schema)
    async with await AsyncConnection.connect(
        conninfo,
        autocommit=True,
        prepare_threshold=0,
        row_factory=dict_row,
    ) as conn:
        await conn.execute(f"CREATE SCHEMA IF NOT EXISTS {quoted}")


def _pool_kwargs(schema: str) -> dict:
    # Validate identifier; search_path in libpq options must not include SQL quotes.
    if not _SCHEMA_NAME_RE.fullmatch(schema):
        raise ValueError(f"Invalid checkpoints schema name {schema!r}")
    return {
        "autocommit": True,
        "prepare_threshold": 0,
        "row_factory": dict_row,
        "options": f"-csearch_path={schema}",
    }


async def open_checkpointer(
    settings: Settings,
) -> tuple[AsyncConnectionPool, AsyncPostgresSaver]:
    """Open a pooled AsyncPostgresSaver and run setup().

    On failure after resources are allocated, closes the pool before re-raising.
    """
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is required to open the checkpointer")

    schema = settings.checkpoints_schema.strip() or "langgraph"
    conninfo = psycopg_conninfo(settings.database_url)
    await ensure_checkpoints_schema(conninfo, schema)

    pool: AsyncConnectionPool | None = None
    try:
        pool = AsyncConnectionPool(
            conninfo=conninfo,
            kwargs=_pool_kwargs(schema),
            open=False,
        )
        await pool.open()
        checkpointer = AsyncPostgresSaver(conn=pool)
        await checkpointer.setup()
        return pool, checkpointer
    except Exception:
        if pool is not None:
            await pool.close()
        raise


async def close_checkpointer(pool: AsyncConnectionPool | None) -> None:
    if pool is not None:
        await pool.close()


@asynccontextmanager
async def checkpointer_lifespan(
    settings: Settings,
) -> AsyncIterator[tuple[AsyncConnectionPool | None, AsyncPostgresSaver | None]]:
    """Yield (pool, saver) for app lifespan. Absent DATABASE_URL → (None, None)."""
    if not settings.database_url:
        logger.info("DATABASE_URL unset; LangGraph checkpointer disabled (stateless only)")
        yield None, None
        return

    pool, checkpointer = await open_checkpointer(settings)
    try:
        yield pool, checkpointer
    finally:
        await close_checkpointer(pool)
