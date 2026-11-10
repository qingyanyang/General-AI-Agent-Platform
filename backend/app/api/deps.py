"""FastAPI dependencies.

``get_current_user_id`` returns the ``sub`` of a validated Auth0 API access token.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
from fastapi import HTTPException, Request, status

from app.core.auth import (
    AuthNotConfigured,
    AuthRejected,
    AuthUnavailable,
    JwksCache,
    extract_bearer_token,
    fetch_jwks,
    issuer_for_domain,
    jwks_url_for_domain,
    normalize_auth0_domain,
    verify_access_token,
)
from app.core.config import get_settings

_NOT_CONFIGURED = "Authentication is not configured"
_UNAVAILABLE = "Authentication is temporarily unavailable"
_UNAUTHORIZED = "Not authenticated"
_UNAUTHORIZED_HEADERS = {"WWW-Authenticate": "Bearer"}


def _jwks_cache_lock(request: Request) -> asyncio.Lock:
    lock = getattr(request.app.state, "jwks_cache_lock", None)
    if isinstance(lock, asyncio.Lock):
        return lock
    lock = asyncio.Lock()
    request.app.state.jwks_cache_lock = lock
    return lock


async def jwks_cache_for(request: Request, domain: str) -> JwksCache:
    """Return the process cache for ``domain``, building it from the shared client."""
    existing: Any = getattr(request.app.state, "jwks_cache", None)
    if isinstance(existing, JwksCache) and existing.domain == domain:
        return existing
    async with _jwks_cache_lock(request):
        existing = getattr(request.app.state, "jwks_cache", None)
        if isinstance(existing, JwksCache) and existing.domain == domain:
            return existing
        client = getattr(request.app.state, "auth_http_client", None)
        if not isinstance(client, httpx.AsyncClient):
            raise AuthUnavailable
        url = jwks_url_for_domain(domain)

        async def fetch() -> dict[str, Any]:
            return await fetch_jwks(client, url)

        cache = JwksCache(fetch, domain=domain)
        request.app.state.jwks_cache = cache
        return cache


async def get_current_user_id(request: Request) -> str:
    """Resolve the caller from ``Authorization: Bearer``. ``X-User-Id`` is ignored."""
    settings = get_settings()
    audience = (settings.auth0_audience or "").strip()
    if not audience or not (settings.auth0_domain or "").strip():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=_NOT_CONFIGURED,
        )
    try:
        domain = normalize_auth0_domain(settings.auth0_domain or "")
        token = extract_bearer_token(request.headers.get("authorization"))
        return await verify_access_token(
            token,
            issuer=issuer_for_domain(domain),
            audience=audience,
            jwks=await jwks_cache_for(request, domain),
        )
    except AuthNotConfigured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=_NOT_CONFIGURED,
        ) from None
    except AuthRejected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_UNAUTHORIZED,
            headers=_UNAUTHORIZED_HEADERS,
        ) from None
    except AuthUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=_UNAVAILABLE,
        ) from None
