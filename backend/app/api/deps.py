"""FastAPI dependencies.

``get_current_user`` is the single Auth0 authentication path. Permission and
ownership checks share that authenticated identity.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable, Coroutine
from typing import Annotated, Any

import httpx
from fastapi import Depends, HTTPException, Request, status

from app.core.auth import (
    AuthenticatedUser,
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
from app.services import directory_users

logger = logging.getLogger(__name__)

_NOT_CONFIGURED = "Authentication is not configured"
_UNAVAILABLE = "Authentication is temporarily unavailable"
_DIRECTORY_UNAVAILABLE = "Directory persistence is unavailable"
_UNAUTHORIZED = "Not authenticated"
_FORBIDDEN = "Permission denied"
_EMAIL_UNVERIFIED = "Verify your email before continuing."
_ACCOUNT_DISABLED = "This account is disabled."
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


async def get_current_user(request: Request) -> AuthenticatedUser:
    """Validate ``Authorization: Bearer`` once. ``X-User-Id`` is ignored.

    Directory persistence runs only after ``verify_access_token`` returns, in
    its own committed session. Token checks do not touch the database.
    """
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
        user = await verify_access_token(
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
    except AuthRejected as exc:
        logger.info("Auth0 token rejected: %s", exc)
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
    if user.email_verified is False or (
        settings.auth0_require_verified_email and user.email_verified is not True
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_EMAIL_UNVERIFIED,
        )
    try:
        account_status = await asyncio.to_thread(
            directory_users.record_authenticated_subject,
            user.user_id,
            email=user.email,
            display_name=user.display_name,
            email_verified=user.email_verified is True,
        )
    except directory_users.DirectoryPersistenceError:
        logger.exception("Directory persistence failed after authentication")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=_DIRECTORY_UNAVAILABLE,
        ) from None
    if account_status == "disabled":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_ACCOUNT_DISABLED,
        )
    return user


async def get_current_user_id(
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
) -> str:
    """Thin wrapper over ``get_current_user`` for subject-only call sites."""
    return user.user_id


def require_permissions(
    *required: str,
) -> Callable[..., Coroutine[Any, Any, AuthenticatedUser]]:
    """Require every listed permission (exact match). Fail closed with 403."""

    async def _enforce(
        user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    ) -> AuthenticatedUser:
        if not required or any(permission not in user.permissions for permission in required):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=_FORBIDDEN,
            )
        return user

    return _enforce
