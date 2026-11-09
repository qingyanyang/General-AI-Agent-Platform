"""Database engine and session helpers.

Engine creation is lazy so importing the app (and `/health`) does not require
DATABASE_URL. Tables are schema-qualified (POSTGRES_SCHEMA); no search_path.
"""

from __future__ import annotations

from collections.abc import Generator
from functools import lru_cache

from fastapi import HTTPException, status
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings


@lru_cache
def get_engine() -> Engine:
    settings = get_settings()
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is missing")
    return create_engine(
        settings.database_url,
        pool_pre_ping=True,
    )


def get_session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), autoflush=False, autocommit=False)


def check_database() -> None:
    with get_engine().connect() as connection:
        connection.execute(text("SELECT 1"))


def get_db() -> Generator[Session, None, None]:
    settings = get_settings()
    if not settings.database_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database is not configured",
        )
    session = get_session_factory()()
    try:
        yield session
    finally:
        session.close()
