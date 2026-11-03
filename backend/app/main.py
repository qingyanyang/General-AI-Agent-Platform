from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging

configure_logging()

_settings = get_settings()

app = FastAPI(
    title="Enterprise AI Agent Platform",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origins or ["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)
app.include_router(api_router)
