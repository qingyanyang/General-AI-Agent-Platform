import asyncio
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.agents.checkpointer import checkpointer_lifespan
from app.agents.tools.mcp import discover_approved_mcp_tools
from app.api.router import api_router
from app.core.auth import AUTH_HTTP_TIMEOUT
from app.core.config import get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging

configure_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    async with httpx.AsyncClient(
        timeout=AUTH_HTTP_TIMEOUT,
        follow_redirects=False,
    ) as auth_http_client:
        app.state.auth_http_client = auth_http_client
        app.state.jwks_cache = None
        app.state.jwks_cache_lock = asyncio.Lock()
        async with checkpointer_lifespan(settings) as (pool, checkpointer):
            app.state.checkpoint_pool = pool
            app.state.checkpointer = checkpointer
            await discover_approved_mcp_tools(settings)
            yield
        app.state.jwks_cache = None
        app.state.jwks_cache_lock = None
        app.state.auth_http_client = None


_settings = get_settings()

app = FastAPI(
    title="Enterprise AI Agent Platform",
    version="0.1.0",
    lifespan=lifespan,
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
