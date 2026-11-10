"""Auth0 API access-token validation.

Identity is the ``sub`` claim of an RS256 token whose audience is this API.
JWKS documents are fetched only from the configured Auth0 hostname.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import urlsplit

import httpx
import jwt
from jwt.algorithms import RSAAlgorithm

logger = logging.getLogger(__name__)

USER_ID_MAX_LENGTH = 512
JWKS_CACHE_TTL_SECONDS = 600.0
JWKS_REFRESH_COOLDOWN_SECONDS = 30.0
AUTH_HTTP_TIMEOUT = httpx.Timeout(5.0, connect=2.0)

_HOSTNAME_RE = re.compile(
    r"^(?=.{1,253}$)"
    r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)"
    r"(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+$"
)
_JWKS_PATH = "/.well-known/jwks.json"


class AuthRejected(Exception):
    """The caller did not present a valid API access token."""


class AuthNotConfigured(Exception):
    """Auth0 settings are missing or not a usable hostname and audience."""


class AuthUnavailable(Exception):
    """The signing keys could not be retrieved, so verification did not finish."""


def normalize_auth0_domain(value: str) -> str:
    """Return a lowercase hostname, or raise if the value is not one.

    Schemes, paths, query strings, fragments, userinfo, and ports are rejected.
    """
    raw = value.strip()
    if not raw or any(char in raw for char in "/?#@:\\") or any(char.isspace() for char in raw):
        raise AuthNotConfigured
    domain = raw.lower().rstrip(".")
    if not _HOSTNAME_RE.fullmatch(domain):
        raise AuthNotConfigured
    return domain


def issuer_for_domain(domain: str) -> str:
    return f"https://{domain}/"


def jwks_url_for_domain(domain: str) -> str:
    return f"https://{domain}{_JWKS_PATH}"


def extract_bearer_token(authorization: str | None) -> str:
    """Return the token from a single ``Bearer`` credential."""
    if authorization is None:
        raise AuthRejected
    scheme, separator, token = authorization.partition(" ")
    if separator != " " or scheme.lower() != "bearer" or not token or token != token.strip():
        raise AuthRejected
    if " " in token:
        raise AuthRejected
    return token


def keys_from_jwks(payload: dict[str, Any]) -> dict[str, Any]:
    """Index RSA signature keys by ``kid``."""
    raw_keys = payload.get("keys")
    if not isinstance(raw_keys, list):
        raise AuthUnavailable
    keys: dict[str, Any] = {}
    for item in raw_keys:
        if not isinstance(item, dict):
            continue
        if item.get("kty") != "RSA" or item.get("use") not in (None, "sig"):
            continue
        if item.get("alg") not in (None, "RS256"):
            continue
        kid = item.get("kid")
        if not isinstance(kid, str) or not kid:
            continue
        try:
            keys[kid] = RSAAlgorithm.from_jwk(item)
        except (jwt.InvalidKeyError, ValueError, TypeError):
            continue
    return keys


def _assert_jwks_url(url: str) -> None:
    parsed = urlsplit(url)
    if (
        parsed.scheme != "https"
        or parsed.path != _JWKS_PATH
        or parsed.query
        or parsed.fragment
        or parsed.username
        or parsed.password
        or parsed.port is not None
        or not _HOSTNAME_RE.fullmatch(parsed.hostname or "")
    ):
        raise AuthUnavailable


async def fetch_jwks(client: httpx.AsyncClient, url: str) -> dict[str, Any]:
    """GET one JWKS document. Network and document failures are ``AuthUnavailable``."""
    _assert_jwks_url(url)
    try:
        response = await client.get(url)
    except httpx.HTTPError as exc:
        logger.warning("Auth0 JWKS request failed")
        raise AuthUnavailable from exc
    if response.status_code != 200:
        logger.warning("Auth0 JWKS request returned HTTP %s", response.status_code)
        raise AuthUnavailable
    try:
        payload = response.json()
    except ValueError as exc:
        logger.warning("Auth0 JWKS response was not JSON")
        raise AuthUnavailable from exc
    if not isinstance(payload, dict):
        raise AuthUnavailable
    try:
        return keys_from_jwks(payload)
    except AuthUnavailable:
        logger.warning("Auth0 JWKS response had no key set")
        raise


class JwksCache:
    """In-memory JWKS cache with a TTL and a refresh cooldown.

    A cached ``kid`` is reused until the TTL expires. An unknown ``kid`` refreshes
    at most once per cooldown, including across sequential requests. Concurrent
    callers share the refresh already in progress because the lock is held for
    the fetch.

    During the cooldown the last refresh outcome is preserved: a successful
    document that lacked the ``kid`` stays ``AuthRejected`` (401), and a failed
    refresh stays ``AuthUnavailable`` (503).
    """

    def __init__(
        self,
        fetch: Callable[[], Awaitable[dict[str, Any]]],
        *,
        domain: str = "",
        ttl_seconds: float = JWKS_CACHE_TTL_SECONDS,
        cooldown_seconds: float = JWKS_REFRESH_COOLDOWN_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.domain = domain
        self.ttl_seconds = ttl_seconds
        self.cooldown_seconds = cooldown_seconds
        self._fetch = fetch
        self._clock = clock
        self._keys: dict[str, Any] = {}
        self._fetched_at: float | None = None
        self._last_fetch_failed = False
        self._lock = asyncio.Lock()

    async def get_key(self, kid: str) -> Any:
        async with self._lock:
            now = self._clock()
            fresh = (
                self._fetched_at is not None
                and not self._last_fetch_failed
                and now - self._fetched_at < self.ttl_seconds
            )
            if fresh and kid in self._keys:
                return self._keys[kid]
            cooling = (
                self._fetched_at is not None and now - self._fetched_at < self.cooldown_seconds
            )
            if cooling:
                if self._last_fetch_failed:
                    raise AuthUnavailable
                raise AuthRejected
            try:
                keys = await self._fetch()
            except AuthUnavailable:
                self._mark_failed()
                raise
            except Exception as exc:
                logger.warning("Auth0 JWKS refresh failed")
                self._mark_failed()
                raise AuthUnavailable from exc
            self._keys = keys
            self._fetched_at = self._clock()
            self._last_fetch_failed = False
            key = keys.get(kid)
            if key is None:
                raise AuthRejected
            return key

    def _mark_failed(self) -> None:
        self._fetched_at = self._clock()
        self._last_fetch_failed = True
        self._keys = {}


def _unverified_header(token: str) -> dict[str, Any]:
    try:
        header = jwt.get_unverified_header(token)
    except jwt.InvalidTokenError as exc:
        raise AuthRejected from exc
    if not isinstance(header, dict):
        raise AuthRejected
    return header


async def verify_access_token(
    token: str,
    *,
    issuer: str,
    audience: str,
    jwks: JwksCache,
) -> str:
    """Validate one access token and return its subject.

    Missing ``kid`` and algorithms other than RS256 fail before any JWKS fetch.
    """
    header = _unverified_header(token)
    kid = header.get("kid")
    if header.get("alg") != "RS256" or not isinstance(kid, str) or not kid:
        raise AuthRejected
    key = await jwks.get_key(kid)
    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=audience,
            issuer=issuer,
            options={"require": ["exp", "iss", "aud", "sub"]},
        )
    except jwt.InvalidTokenError as exc:
        raise AuthRejected from exc
    subject = claims.get("sub")
    if (
        not isinstance(subject, str)
        or not subject
        or subject != subject.strip()
        or len(subject) > USER_ID_MAX_LENGTH
    ):
        raise AuthRejected
    return subject
