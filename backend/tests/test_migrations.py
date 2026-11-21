"""Alembic loads revisions and renders migrations without a live database."""

from __future__ import annotations

import os
import runpy
import subprocess
import sys
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text

_BACKEND = Path(__file__).resolve().parents[1]
_FAKE_DATABASE_URL = "postgresql+psycopg://user:pass@localhost/eap"


def _run(*args: str) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, "DATABASE_URL": _FAKE_DATABASE_URL}
    return subprocess.run(
        [sys.executable, *args],
        cwd=_BACKEND,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


@pytest.mark.parametrize("module", ["app.core.config", "app.models.base"])
def test_settings_and_models_import_first_in_fresh_interpreter(module: str) -> None:
    result = _run("-c", f"import {module}")
    assert result.returncode == 0, result.stderr


def test_alembic_has_single_head_at_execution_usage() -> None:
    result = _run("-m", "alembic", "heads")
    assert result.returncode == 0, result.stderr
    assert result.stdout.split() == ["20261121_0015", "(head)"]


def test_usage_migration_creates_observation_tables_without_backfill() -> None:
    result = _run("-m", "alembic", "upgrade", "20261121_0014:20261121_0015", "--sql")
    assert result.returncode == 0, result.stderr
    assert "ADD COLUMN usage_capture VARCHAR(16)" in result.stdout
    assert "CREATE TABLE agent_platform.execution_model_calls" in result.stdout
    assert "CREATE TABLE agent_platform.execution_tool_calls" in result.stdout
    assert "estimated_cost NUMERIC(38, 18)" in result.stdout
    assert "UPDATE agent_platform.agent_executions" not in result.stdout


def test_usage_migration_round_trips_on_disposable_database() -> None:
    migration = runpy.run_path(str(
        _BACKEND / "alembic/versions/20261121_0015_execution_usage.py",
    ))
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("ATTACH DATABASE ':memory:' AS agent_platform"))
        connection.execute(
            text("CREATE TABLE agent_platform.agent_executions (id UUID PRIMARY KEY)"),
        )
        connection.execute(text("INSERT INTO agent_platform.agent_executions VALUES ('old-run')"))
        context = MigrationContext.configure(connection)
        with Operations.context(context):
            migration["upgrade"]()
            assert connection.execute(
                text("SELECT usage_capture FROM agent_platform.agent_executions"),
            ).one() == (None,)
            assert "execution_model_calls" in inspect(connection).get_table_names("agent_platform")
            migration["downgrade"]()
        assert inspect(connection).get_table_names("agent_platform") == ["agent_executions"]
        assert connection.execute(
            text("SELECT id FROM agent_platform.agent_executions"),
        ).scalar_one() == "old-run"
    engine.dispose()

def test_skill_names_migration_adds_not_null_column_with_empty_default() -> None:
    result = _run("-m", "alembic", "upgrade", "20261111_0006:20261112_0007", "--sql")
    assert result.returncode == 0, result.stderr
    assert (
        "ALTER TABLE agent_platform.agents ADD COLUMN skill_names JSON DEFAULT '[]' NOT NULL"
        in result.stdout
    )


def test_directory_users_migration_creates_subject_table() -> None:
    result = _run("-m", "alembic", "upgrade", "20261112_0008:20261118_0009", "--sql")
    assert result.returncode == 0, result.stderr
    assert "CREATE TABLE agent_platform.directory_users" in result.stdout
    assert "user_id VARCHAR(512) NOT NULL" in result.stdout
    assert "first_seen_at TIMESTAMP WITH TIME ZONE NOT NULL" in result.stdout
    assert "last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL" in result.stdout
    assert "PRIMARY KEY (user_id)" in result.stdout


def test_groups_migration_creates_groups_and_memberships() -> None:
    result = _run("-m", "alembic", "upgrade", "20261118_0009:20261119_0010", "--sql")
    assert result.returncode == 0, result.stderr
    assert "CREATE TABLE agent_platform.groups" in result.stdout
    assert "CREATE TABLE agent_platform.group_memberships" in result.stdout
    assert "uq_groups_name" in result.stdout
    assert "ck_group_memberships_designation" in result.stdout
    assert "fk_group_memberships_user_id" in result.stdout
    assert "ix_group_memberships_user_id" in result.stdout


def test_agent_access_config_migration_adds_staged_audience_fields() -> None:
    result = _run("-m", "alembic", "upgrade", "20261119_0010:20261119_0011", "--sql")
    assert result.returncode == 0, result.stderr
    assert "authorization_mode" in result.stdout
    assert "audience_mode" in result.stdout
    assert "owning_group_id" in result.stdout
    assert "CREATE TABLE agent_platform.agent_group_assignments" in result.stdout
    assert "ck_agents_authorization_mode" in result.stdout
    assert "fk_agents_owning_group_id" in result.stdout


def test_instruction_skills_migration_creates_table() -> None:
    result = _run("-m", "alembic", "upgrade", "20261119_0011:20261120_0012", "--sql")
    assert result.returncode == 0, result.stderr
    assert "CREATE TABLE agent_platform.agent_instruction_skills" in result.stdout
    assert "uq_agent_instruction_skills_agent_position" in result.stdout
    assert "fk_agent_instruction_skills_agent_id" in result.stdout
    assert "ix_agent_instruction_skills_agent_id" in result.stdout


def test_human_approval_migration_adds_gate_and_timing_columns() -> None:
    result = _run("-m", "alembic", "upgrade", "20261112_0007:20261112_0008", "--sql")
    assert result.returncode == 0, result.stderr
    assert "approval_tool_names" in result.stdout
    assert "active_duration_ms" in result.stdout
    assert "session_run_gates" in result.stdout
