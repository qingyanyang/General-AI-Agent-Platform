"""LangSmith environment and per-run trace metadata."""

from __future__ import annotations

import logging
import os
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from uuid import UUID

from langsmith.utils import get_env_var

from app.core.config import Settings

logger = logging.getLogger(__name__)

# The SDK checks LANGSMITH_TRACING_V2 before LANGSMITH_TRACING. Both are set
# from Settings so an ambient LANGCHAIN_TRACING_V2 cannot override the app.
_MANAGED_ENV_VARS = (
    "LANGSMITH_TRACING",
    "LANGSMITH_TRACING_V2",
    "LANGSMITH_API_KEY",
    "LANGSMITH_PROJECT",
    "LANGSMITH_ENDPOINT",
)


def tracing_project_name(settings: Settings) -> str:
    """Project for this environment, unless LANGSMITH_PROJECT is set."""
    project = (settings.langsmith_project or "").strip()
    if project:
        return project
    environment = settings.environment.strip() or "development"
    return f"agent-platform-{environment}"


def tracing_enabled(settings: Settings) -> bool:
    """True only when tracing is requested and an API key is configured."""
    has_key = bool((settings.langsmith_api_key or "").strip())
    if settings.langsmith_tracing and not has_key:
        logger.warning(
            "LANGSMITH_TRACING is enabled but LANGSMITH_API_KEY is unset; tracing disabled",
        )
        return False
    return settings.langsmith_tracing and has_key


def build_run_config(settings: Settings, execution_id: UUID) -> dict[str, Any]:
    """Runnable config. Metadata is only the correlation allowlist."""
    environment = settings.environment.strip() or "development"
    agent_id = settings.agent_id.strip() or "default"
    return {
        "recursion_limit": settings.agent_recursion_limit,
        "run_id": execution_id,
        "run_name": agent_id,
        "metadata": {
            "execution_id": str(execution_id),
            "agent_id": agent_id,
            "environment": environment,
        },
        "tags": [environment],
    }


@contextmanager
def langsmith_tracing(settings: Settings) -> Iterator[None]:
    """Apply LangSmith env for one run, then restore the previous process env."""
    enabled = tracing_enabled(settings)
    previous = {name: os.environ.get(name) for name in _MANAGED_ENV_VARS}
    try:
        _apply_env(settings, enabled=enabled)
        get_env_var.cache_clear()
        yield
    finally:
        for name, value in previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
        get_env_var.cache_clear()


def _apply_env(settings: Settings, *, enabled: bool) -> None:
    os.environ["LANGSMITH_TRACING"] = "true" if enabled else "false"
    os.environ["LANGSMITH_TRACING_V2"] = "true" if enabled else "false"
    if not enabled:
        return
    os.environ["LANGSMITH_API_KEY"] = (settings.langsmith_api_key or "").strip()
    os.environ["LANGSMITH_PROJECT"] = tracing_project_name(settings)
    endpoint = (settings.langsmith_endpoint or "").strip()
    if endpoint:
        os.environ["LANGSMITH_ENDPOINT"] = endpoint
    else:
        os.environ.pop("LANGSMITH_ENDPOINT", None)
