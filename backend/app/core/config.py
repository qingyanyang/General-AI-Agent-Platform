"""Application settings loaded from environment variables / `.env`."""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.mcp_allowlist import ApprovedMcpServer, parse_approved_mcp_servers

# Process-default convenience: DeepSeek + unset/OpenAI default model → flash.
_OPENAI_DEFAULT_MODEL = "gpt-4o-mini"
_DEEPSEEK_DEFAULT_MODEL = "deepseek-flash"

# Defaults cover models used in this repo. Override via APPROVED_LLM_MODELS JSON.
_DEFAULT_APPROVED_LLM_MODELS: list[dict[str, Any]] = [
    {
        "provider": "openai",
        "model": "gpt-4o-mini",
        "temperature_min": 0.0,
        "temperature_max": 2.0,
    },
    {
        "provider": "deepseek",
        "model": "deepseek-flash",
        "temperature_min": 0.0,
        "temperature_max": 2.0,
    },
    {
        "provider": "deepseek",
        "model": "deepseek-chat",
        "temperature_min": 0.0,
        "temperature_max": 2.0,
    },
]


@dataclass(frozen=True, slots=True)
class ApprovedLlmModel:
    provider: str
    model: str
    temperature_min: float | None
    temperature_max: float | None

    @property
    def supports_temperature(self) -> bool:
        return self.temperature_min is not None and self.temperature_max is not None


class ApprovedLlmCatalogError(ValueError):
    """Configured default LLM is missing from the approved catalog."""


def _parse_approved_entry(raw: dict[str, Any]) -> ApprovedLlmModel:
    provider = str(raw.get("provider", "")).strip().lower()
    model = str(raw.get("model", "")).strip()
    if not provider or not model:
        raise ValueError("approved LLM entry requires provider and model")
    t_min = raw.get("temperature_min")
    t_max = raw.get("temperature_max")
    if t_min is None or t_max is None:
        return ApprovedLlmModel(
            provider=provider,
            model=model,
            temperature_min=None,
            temperature_max=None,
        )
    return ApprovedLlmModel(
        provider=provider,
        model=model,
        temperature_min=float(t_min),
        temperature_max=float(t_max),
    )


def _parse_approved_catalog(value: str | list[Any] | None) -> tuple[ApprovedLlmModel, ...]:
    if value is None or value == "":
        raw_list: list[Any] = list(_DEFAULT_APPROVED_LLM_MODELS)
    elif isinstance(value, list):
        raw_list = value
    else:
        loaded = json.loads(value)
        if not isinstance(loaded, list):
            raise ValueError("APPROVED_LLM_MODELS must be a JSON array")
        raw_list = loaded
    if not raw_list:
        raise ValueError("APPROVED_LLM_MODELS must not be empty")
    return tuple(_parse_approved_entry(item) for item in raw_list)


class Settings(BaseSettings):
    """Application settings loaded from environment variables / `.env`."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Container App / local: ENVIRONMENT
    environment: str = "development"
    database_url: str | None = None
    postgres_schema: str = "agent_platform"
    # Separate schema for LangGraph checkpoint tables (not ORM / Alembic).
    checkpoints_schema: str = "langgraph"
    cors_allowed_origins: str = "http://localhost:5173"
    # openai (default) | deepseek — DeepSeek uses the OpenAI-compatible Chat Completions API
    llm_provider: str = "openai"
    llm_api_key: str | None = None
    # Optional DeepSeek-specific key (DEEPSEEK_API_KEY); used when llm_api_key is unset
    deepseek_api_key: str | None = None
    llm_model: str = "gpt-4o-mini"
    llm_base_url: str | None = None
    # JSON array of {provider, model, temperature_min?, temperature_max?}
    approved_llm_models: str | list[Any] = ""
    agent_recursion_limit: int = 10
    # Stable id included in LangSmith metadata. One graph exists today.
    agent_id: str = "default"
    # LangSmith tracing is off unless LANGSMITH_TRACING=true and LANGSMITH_API_KEY is set.
    langsmith_tracing: bool = False
    langsmith_api_key: str | None = None
    langsmith_project: str | None = None
    langsmith_endpoint: str | None = None
    # Auth0 API access tokens. Domain is a hostname only (no scheme or path).
    auth0_domain: str | None = None
    auth0_audience: str | None = None
    # Reject tokens that do not carry an explicit email_verified=true claim.
    # Turn this on after the Auth0 post-login Action adds that claim.
    auth0_require_verified_email: bool = False
    # Machine-to-machine application allowed to read users and assign roles.
    auth0_mgmt_client_id: str | None = None
    auth0_mgmt_client_secret: str | None = None
    auth0_db_connection: str = "Username-Password-Authentication"
    log_level: str = "INFO"
    # JSON array of {name, url}. Empty means no MCP tools. No credentials in this version.
    approved_mcp_servers: str | list[Any] = ""
    # One deadline for connect, initialize, list_tools pagination, and call_tool.
    mcp_timeout_seconds: float = 10.0
    # Bound on shielded session/transport close after the operation deadline.
    mcp_cleanup_timeout_seconds: float = 2.0

    @field_validator("database_url")
    @classmethod
    def _use_psycopg_driver(cls, value: str | None) -> str | None:
        # Only psycopg 3 is installed; bare postgresql:// would make SQLAlchemy load psycopg2.
        if value is None:
            return None
        url = value.strip()
        for scheme in ("postgresql://", "postgres://"):
            if url.startswith(scheme):
                return "postgresql+psycopg://" + url.removeprefix(scheme)
        return url

    @field_validator("approved_llm_models", mode="before")
    @classmethod
    def _keep_approved_raw(cls, value: Any) -> Any:
        return value

    @field_validator("approved_mcp_servers", mode="before")
    @classmethod
    def _validate_mcp_servers(cls, value: Any) -> Any:
        parse_approved_mcp_servers(value)
        return value

    @field_validator("mcp_timeout_seconds", "mcp_cleanup_timeout_seconds")
    @classmethod
    def _positive_mcp_timeout(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("MCP timeout must be greater than 0")
        return value

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_allowed_origins.split(",") if origin.strip()]

    def resolve_llm_api_key(self) -> str | None:
        """Primary LLM_API_KEY, or DEEPSEEK_API_KEY when provider is deepseek."""
        if self.llm_api_key:
            return self.llm_api_key
        if self.llm_provider.strip().lower() == "deepseek":
            return self.deepseek_api_key
        return None

    def resolve_llm_api_key_for_provider(self, provider: str) -> str | None:
        """API key for an agent-configured provider (process-wide keys only)."""
        normalized = provider.strip().lower()
        if self.llm_api_key:
            return self.llm_api_key
        if normalized == "deepseek":
            return self.deepseek_api_key
        return None

    def approved_mcp_server_list(self) -> tuple[ApprovedMcpServer, ...]:
        return parse_approved_mcp_servers(self.approved_mcp_servers)

    def approved_llm_catalog(self) -> tuple[ApprovedLlmModel, ...]:
        return _parse_approved_catalog(self.approved_llm_models)

    def get_approved_llm(self, provider: str, model: str) -> ApprovedLlmModel | None:
        provider_key = provider.strip().lower()
        model_key = model.strip()
        for entry in self.approved_llm_catalog():
            if entry.provider == provider_key and entry.model == model_key:
                return entry
        return None

    def resolved_process_llm(self) -> tuple[str, str]:
        """Normalize process LLM settings (DeepSeek OpenAI-default → flash)."""
        provider = self.llm_provider.strip().lower()
        model = self.llm_model.strip()
        if provider == "deepseek" and model == _OPENAI_DEFAULT_MODEL:
            model = _DEEPSEEK_DEFAULT_MODEL
        return provider, model

    def default_approved_llm(self) -> ApprovedLlmModel:
        """Resolved process LLM must be in the catalog — no silent catalog fallback."""
        provider, model = self.resolved_process_llm()
        entry = self.get_approved_llm(provider, model)
        if entry is None:
            raise ApprovedLlmCatalogError(
                f"Configured default LLM '{provider}/{model}' is not in APPROVED_LLM_MODELS",
            )
        return entry


@lru_cache
def get_settings() -> Settings:
    return Settings()
