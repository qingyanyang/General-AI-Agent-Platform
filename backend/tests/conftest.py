"""Shared pytest fixtures."""

from __future__ import annotations

import os
from collections.abc import Generator

import pytest
from app.agents.graph import clear_agent_graph_cache
from app.agents.tools.mcp import clear_mcp_catalog, set_mcp_http_client_factory
from app.api.deps import get_current_user
from app.core.config import get_settings
from app.core.database import get_db
from app.main import app
from app.models.agent import Agent  # noqa: F401
from app.models.agent_access_grant import AgentAccessGrant  # noqa: F401
from app.models.agent_execution import AgentExecution  # noqa: F401
from app.models.base import Base, postgres_schema_name
from app.models.chat_session import ChatSession  # noqa: F401
from app.models.directory_user import DirectoryUser  # noqa: F401
from app.models.session_run_gate import SessionRunGate  # noqa: F401
from app.services.agents import ensure_default_agent
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from tests.auth_helpers import stub_get_current_user


@pytest.fixture(autouse=True)
def _clear_agent_graph_cache(monkeypatch: pytest.MonkeyPatch) -> Generator[None, None, None]:
    clear_agent_graph_cache()
    clear_mcp_catalog()
    set_mcp_http_client_factory(None)
    monkeypatch.setenv("APPROVED_MCP_SERVERS", "")
    get_settings.cache_clear()
    yield
    clear_agent_graph_cache()
    clear_mcp_catalog()
    set_mcp_http_client_factory(None)
    get_settings.cache_clear()


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Generator[TestClient, None, None]:
    """HTTP client with checkpointer disabled (no DATABASE_URL for unit tests)."""
    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    get_settings.cache_clear()
    app.dependency_overrides[get_current_user] = stub_get_current_user
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    get_settings.cache_clear()


@pytest.fixture
def db_engine(monkeypatch: pytest.MonkeyPatch):
    """In-memory SQLite; schema_translate_map keeps model metadata schema-qualified."""
    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    get_settings.cache_clear()
    schema = postgres_schema_name()
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        execution_options={"schema_translate_map": {schema: None}},
    )

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_connection, _connection_record) -> None:  # noqa: ANN001
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)
    engine.dispose()
    get_settings.cache_clear()


@pytest.fixture
def db_session(db_engine) -> Generator[Session, None, None]:
    factory = sessionmaker(bind=db_engine, autoflush=False, autocommit=False)
    session = factory()
    try:
        # Mirror Alembic seed so session/grant tests have an active default agent.
        ensure_default_agent(session)
        yield session
    finally:
        session.close()


@pytest.fixture
def api_client(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[TestClient, None, None]:
    """TestClient with DB dependency overridden to the SQLite session."""

    def _override_db() -> Generator[Session, None, None]:
        yield db_session

    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    get_settings.cache_clear()
    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = stub_get_current_user
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    get_settings.cache_clear()


def checkpoint_test_database_url() -> str | None:
    """Dedicated Postgres URL for checkpointer integration tests (no app DB fallback)."""
    value = os.environ.get("CHECKPOINT_TEST_DATABASE_URL", "").strip()
    return value or None


def business_database_url() -> str | None:
    """Dedicated Postgres URL for business-table tests (no app DB or checkpoint DB fallback)."""
    value = os.environ.get("TEST_DATABASE_URL", "").strip()
    return value or None
