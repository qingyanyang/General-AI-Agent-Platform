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


def test_alembic_has_single_head_at_skill_names() -> None:
    result = _run("-m", "alembic", "heads")
    assert result.returncode == 0, result.stderr
    assert result.stdout.split() == ["20261112_0007", "(head)"]


def test_skill_names_migration_adds_not_null_column_with_empty_default() -> None:
    result = _run("-m", "alembic", "upgrade", "20261111_0006:20261112_0007", "--sql")
    assert result.returncode == 0, result.stderr
    assert (
        "ALTER TABLE agent_platform.agents ADD COLUMN skill_names JSON DEFAULT '[]' NOT NULL"
        in result.stdout
    )
