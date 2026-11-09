"""Declarative base for schema-qualified tables."""

from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings


def postgres_schema_name() -> str:
    return get_settings().postgres_schema.strip() or "agent_platform"


class Base(DeclarativeBase):
    """Application declarative base."""
