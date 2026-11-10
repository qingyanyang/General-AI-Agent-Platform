"""Helpers for Auth0 access-token tests (local RSA keys, no live Auth0)."""

from __future__ import annotations

import time
from collections.abc import Sequence
from typing import Any

import jwt
from app.core.auth import AuthenticatedUser
from app.core.permissions import ALL_PERMISSIONS
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException, Request, status

AUTH0_DOMAIN = "auth.test.example"
AUTH0_AUDIENCE = "https://api.agent-platform"
AUTH0_ISSUER = f"https://{AUTH0_DOMAIN}/"
USER_ID_MAX_LENGTH = 128


def stub_get_current_user(request: Request) -> AuthenticatedUser:
    """Test-only identity that still reads ``X-User-Id`` and grants all permissions."""
    x_user_id = request.headers.get("x-user-id")
    if x_user_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="X-User-Id header is required",
        )
    user_id = x_user_id.strip()
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="X-User-Id must be a non-empty string",
        )
    if len(user_id) > USER_ID_MAX_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"X-User-Id must be at most {USER_ID_MAX_LENGTH} characters",
        )
    return AuthenticatedUser(user_id=user_id, permissions=ALL_PERMISSIONS)


def stub_get_current_user_id(request: Request) -> str:
    """Backward-compatible subject stub used by older helpers."""
    return stub_get_current_user(request).user_id


def generate_rsa_keypair() -> tuple[rsa.RSAPrivateKey, dict[str, Any]]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_numbers = private_key.public_key().public_numbers()

    def _b64int(value: int) -> str:
        raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
        return jwt.utils.base64url_encode(raw).decode("ascii")

    jwk = {
        "kty": "RSA",
        "kid": "test-key-1",
        "use": "sig",
        "alg": "RS256",
        "n": _b64int(public_numbers.n),
        "e": _b64int(public_numbers.e),
    }
    return private_key, jwk


def jwks_document(*keys: dict[str, Any]) -> dict[str, Any]:
    return {"keys": list(keys)}


def sign_access_token(
    private_key: rsa.RSAPrivateKey,
    *,
    kid: str = "test-key-1",
    subject: str = "auth0|user-1",
    audience: str = AUTH0_AUDIENCE,
    issuer: str = AUTH0_ISSUER,
    expires_in: int = 3600,
    algorithm: str = "RS256",
    permissions: Sequence[str] | None = None,
    include_permissions: bool = True,
    extra_claims: dict[str, Any] | None = None,
    omit_claims: set[str] | None = None,
) -> str:
    now = int(time.time())
    claims: dict[str, Any] = {
        "sub": subject,
        "aud": audience,
        "iss": issuer,
        "exp": now + expires_in,
        "iat": now,
    }
    if include_permissions:
        claims["permissions"] = (
            list(permissions) if permissions is not None else sorted(ALL_PERMISSIONS)
        )
    if extra_claims:
        claims.update(extra_claims)
    for claim in omit_claims or set():
        claims.pop(claim, None)
    pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return jwt.encode(
        claims,
        pem,
        algorithm=algorithm,
        headers={"kid": kid, "alg": algorithm},
    )


def bearer_headers(token: str, *, extra: dict[str, str] | None = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}"}
    if extra:
        headers.update(extra)
    return headers
