"""Alembic loads revisions and renders migrations without a live database."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

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


def test_alembic_has_single_head_at_agent_access_config() -> None:
    result = _run("-m", "alembic", "heads")
    assert result.returncode == 0, result.stderr
    assert result.stdout.split() == ["20261119_0011", "(head)"]


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


def test_human_approval_migration_adds_gate_and_timing_columns() -> None:
    result = _run("-m", "alembic", "upgrade", "20261112_0007:20261112_0008", "--sql")
    assert result.returncode == 0, result.stderr
    assert "approval_tool_names" in result.stdout
    assert "active_duration_ms" in result.stdout
    assert "session_run_gates" in result.stdout
