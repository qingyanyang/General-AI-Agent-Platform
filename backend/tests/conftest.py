import pytest
from app.core.config import get_settings
from app.main import app
from fastapi.testclient import TestClient


@pytest.fixture
def client() -> TestClient:
    get_settings.cache_clear()
    return TestClient(app)
