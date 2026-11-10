from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


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
    log_level: str = "INFO"

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


@lru_cache
def get_settings() -> Settings:
    return Settings()
