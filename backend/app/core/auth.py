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
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import httpx
import jwt
from jwt.algorithms import RSAAlgorithm

logger = logging.getLogger(__name__)

USER_ID_MAX_LENGTH = 512
JWT_CLOCK_SKEW_SECONDS = 5
JWKS_CACHE_TTL_SECONDS = 600.0
JWKS_REFRESH_COOLDOWN_SECONDS = 30.0
AUTH_HTTP_TIMEOUT = httpx.Timeout(5.0, connect=2.0)


@dataclass(frozen=True, slots=True)
class AuthenticatedUser:
    """Caller identity from a validated Auth0 API access token."""

    user_id: str
    permissions: frozenset[str]
    email: str | None = None
    display_name: str | None = None
    # None means the token did not say. False is an explicit unverified claim.
    email_verified: bool | None = None


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
        raise AuthRejected("missing Authorization header")
    scheme, separator, token = authorization.partition(" ")
    if separator != " " or scheme.lower() != "bearer" or not token or token != token.strip():
        raise AuthRejected("invalid Bearer header format")
    if " " in token:
        raise AuthRejected("invalid Bearer header format")
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
        response = await client.get(url, follow_redirects=False)
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
    refresh stays ``AuthUnavailable`` (503) unless that ``kid`` was already
    cached — then the stale key is reused.
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
                    return self._stale_or_unavailable(kid)
                raise AuthRejected("signing key ID absent from cached JWKS")
            try:
                keys = await self._fetch()
            except AuthUnavailable:
                self._mark_failed()
                return self._stale_or_unavailable(kid)
            except Exception as exc:
                logger.warning("Auth0 JWKS refresh failed")
                self._mark_failed()
                try:
                    return self._stale_or_unavailable(kid)
                except AuthUnavailable:
                    raise AuthUnavailable from exc
            self._keys = keys
            self._fetched_at = self._clock()
            self._last_fetch_failed = False
            key = keys.get(kid)
            if key is None:
                raise AuthRejected("signing key ID absent from refreshed JWKS")
            return key

    def _mark_failed(self) -> None:
        """Record a failed refresh. Keep existing keys for stale fallback."""
        self._fetched_at = self._clock()
        self._last_fetch_failed = True

    def _stale_or_unavailable(self, kid: str) -> Any:
        key = self._keys.get(kid)
        if key is not None:
            return key
        raise AuthUnavailable


def _unverified_header(token: str) -> dict[str, Any]:
    try:
        header = jwt.get_unverified_header(token)
    except jwt.InvalidTokenError as exc:
        raise AuthRejected(f"JWT header: {type(exc).__name__}") from exc
    if not isinstance(header, dict):
        raise AuthRejected("invalid JWT header")
    return header


def profile_from_access_claims(
    claims: dict[str, Any],
    audience: str,
) -> tuple[str | None, str | None, bool | None]:
    """Read email, name, and verification from namespaced or standard claims.

    Email is returned only when verification is explicitly true. Auth0 access
    tokens carry these on ``{audience}/email`` and ``{audience}/email_verified``
    after the post-login Action adds them.
    """
    namespace = audience.rstrip("/")
    verified_raw = claims.get(f"{namespace}/email_verified")
    if not isinstance(verified_raw, bool):
        verified_raw = claims.get("email_verified")
    verified = verified_raw if isinstance(verified_raw, bool) else None

    email_raw = claims.get(f"{namespace}/email")
    if not isinstance(email_raw, str):
        email_raw = claims.get("email")
    email: str | None = None
    if isinstance(email_raw, str):
        candidate = email_raw.strip().lower()
        if (
            "@" in candidate
            and " " not in candidate
            and len(candidate) <= 320
        ):
            email = candidate
    if verified is not True:
        email = None

    name_raw = claims.get(f"{namespace}/name")
    if not isinstance(name_raw, str):
        name_raw = claims.get("name")
    name = name_raw.strip() if isinstance(name_raw, str) else ""
    if not name:
        display_name = None
    else:
        display_name = name[:256]
    return email, display_name, verified


def parse_permissions_claim(raw: Any) -> frozenset[str]:
    """Return permissions from the Auth0 ``permissions`` claim.

    Only a JSON array of non-empty strings is accepted. Missing claims, wrong
    types, null, or **any** invalid element yield an empty set (fail closed).
    Values are kept exactly as issued — no trim or normalization.
    """
    if not isinstance(raw, list):
        return frozenset()
    permissions: set[str] = set()
    for item in raw:
        if not isinstance(item, str) or not item:
            return frozenset()
        permissions.add(item)
    return frozenset(permissions)


async def verify_access_token(
    token: str,
    *,
    issuer: str,
    audience: str,
    jwks: JwksCache,
) -> AuthenticatedUser:
    """Validate one access token and return identity plus permissions.

    Missing ``kid`` and algorithms other than RS256 fail before any JWKS fetch.
    """
    header = _unverified_header(token)
    kid = header.get("kid")
    if header.get("alg") != "RS256" or not isinstance(kid, str) or not kid:
        raise AuthRejected("JWT requires RS256 and a signing key ID")
    key = await jwks.get_key(kid)
    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=audience,
            issuer=issuer,
            leeway=JWT_CLOCK_SKEW_SECONDS,
            options={"require": ["exp", "iss", "aud", "sub"]},
        )
    except jwt.InvalidTokenError as exc:
        raise AuthRejected(f"JWT verification: {type(exc).__name__}") from exc
    email, display_name, email_verified = profile_from_access_claims(claims, audience)
    subject = claims.get("sub")
    if (
        not isinstance(subject, str)
        or not subject
        or subject != subject.strip()
        or len(subject) > USER_ID_MAX_LENGTH
    ):
        raise AuthRejected("invalid JWT subject")
    return AuthenticatedUser(
        user_id=subject,
        permissions=parse_permissions_claim(claims.get("permissions")),
        email=email,
        display_name=display_name,
        email_verified=email_verified,
    )
