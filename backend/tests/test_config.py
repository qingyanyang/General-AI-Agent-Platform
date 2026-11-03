from app.core.config import Settings, get_settings
from pytest import MonkeyPatch


def test_settings_load_cors_origins(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173, http://127.0.0.1:5173")
    get_settings.cache_clear()

    settings = Settings(_env_file=None)
    assert settings.cors_origins == [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]


def test_settings_load_environment(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("ENVIRONMENT", "demo")
    get_settings.cache_clear()

    settings = Settings(_env_file=None)
    assert settings.environment == "demo"
