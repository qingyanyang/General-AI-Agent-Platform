"""Declarative base for schema-qualified tables."""

from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings

# Shared with Alembic migrations — keep POSTGRES_SCHEMA aligned with this default.
DEFAULT_POSTGRES_SCHEMA = "agent_platform"


def postgres_schema_name() -> str:
    return get_settings().postgres_schema.strip() or DEFAULT_POSTGRES_SCHEMA


class Base(DeclarativeBase):
    """Application declarative base."""
