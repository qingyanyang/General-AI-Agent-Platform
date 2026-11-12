import pytest
from app.agents.graph import (
    DEEPSEEK_BASE_URL,
    DEEPSEEK_DEFAULT_MODEL,
    create_chat_model,
)
from app.core.config import ApprovedLlmCatalogError, Settings, get_settings
from pytest import MonkeyPatch


def test_settings_load_cors_origins(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173, http://127.0.0.1:5173")
    get_settings.cache_clear()

    settings = Settings(_env_file=None)
    assert settings.cors_origins == [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("postgresql://u:p@host:5432/db", "postgresql+psycopg://u:p@host:5432/db"),
        ("postgres://u:p@host/db", "postgresql+psycopg://u:p@host/db"),
        (" postgresql+psycopg://u:p@host/db ", "postgresql+psycopg://u:p@host/db"),
        ("sqlite+pysqlite:///:memory:", "sqlite+pysqlite:///:memory:"),
    ],
)
def test_database_url_uses_installed_psycopg_driver(raw: str, expected: str) -> None:
    assert Settings(_env_file=None, database_url=raw).database_url == expected


def test_langsmith_settings_default_off() -> None:
    settings = Settings(_env_file=None)

    assert settings.langsmith_tracing is False
    assert settings.langsmith_api_key is None
    assert settings.langsmith_project is None
    assert settings.langsmith_endpoint is None
    assert settings.agent_id == "default"


def test_langsmith_settings_load_from_env(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("LANGSMITH_TRACING", "true")
    monkeypatch.setenv("LANGSMITH_API_KEY", "ls-key")
    monkeypatch.setenv("LANGSMITH_PROJECT", "prod-project")
    monkeypatch.setenv("LANGSMITH_ENDPOINT", "https://eu.api.smith.langchain.com")
    monkeypatch.setenv("AGENT_ID", "takeoff")
    get_settings.cache_clear()

    settings = Settings(_env_file=None)

    assert settings.langsmith_tracing is True
    assert settings.langsmith_api_key == "ls-key"
    assert settings.langsmith_project == "prod-project"
    assert settings.langsmith_endpoint == "https://eu.api.smith.langchain.com"
    assert settings.agent_id == "takeoff"
    get_settings.cache_clear()


def test_settings_load_environment(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("ENVIRONMENT", "demo")
    get_settings.cache_clear()

    settings = Settings(_env_file=None)
    assert settings.environment == "demo"


def test_resolve_llm_api_key_prefers_llm_api_key(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "deepseek")
    monkeypatch.setenv("LLM_API_KEY", "primary-key")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "deepseek-key")
    get_settings.cache_clear()

    settings = Settings(_env_file=None)
    assert settings.resolve_llm_api_key() == "primary-key"
    get_settings.cache_clear()


def test_resolve_llm_api_key_falls_back_to_deepseek(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "deepseek")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.setenv("DEEPSEEK_API_KEY", "deepseek-key")
    get_settings.cache_clear()

    settings = Settings(_env_file=None)
    assert settings.resolve_llm_api_key() == "deepseek-key"
    get_settings.cache_clear()


def test_default_approved_llm_remaps_deepseek_openai_default() -> None:
    settings = Settings(
        _env_file=None,
        llm_provider="deepseek",
        llm_model="gpt-4o-mini",
    )
    approved = settings.default_approved_llm()
    assert approved.provider == "deepseek"
    assert approved.model == DEEPSEEK_DEFAULT_MODEL


def test_default_approved_llm_rejects_unapproved_after_resolve() -> None:
    settings = Settings(
        _env_file=None,
        llm_provider="deepseek",
        llm_model="not-a-real-model",
    )
    with pytest.raises(ApprovedLlmCatalogError, match="not in APPROVED_LLM_MODELS"):
        settings.default_approved_llm()


def test_create_chat_model_deepseek_defaults(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "deepseek")
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.delenv("LLM_MODEL", raising=False)
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    get_settings.cache_clear()

    captured: dict[str, object] = {}

    def fake_chat_openai(**kwargs: object) -> object:
        captured.update(kwargs)
        return object()

    monkeypatch.setattr("app.agents.graph.ChatOpenAI", fake_chat_openai)
    create_chat_model()

    assert captured["api_key"] == "test-key"
    assert captured["base_url"] == DEEPSEEK_BASE_URL
    assert captured["model"] == DEEPSEEK_DEFAULT_MODEL
    assert captured["extra_body"] == {"thinking": {"type": "disabled"}}
    get_settings.cache_clear()


def test_create_chat_model_deepseek_respects_explicit_model(
    monkeypatch: MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "deepseek")
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setenv("LLM_MODEL", "deepseek-v4-pro")
    get_settings.cache_clear()

    captured: dict[str, object] = {}

    def fake_chat_openai(**kwargs: object) -> object:
        captured.update(kwargs)
        return object()

    monkeypatch.setattr("app.agents.graph.ChatOpenAI", fake_chat_openai)
    create_chat_model()

    assert captured["model"] == "deepseek-v4-pro"
    get_settings.cache_clear()
