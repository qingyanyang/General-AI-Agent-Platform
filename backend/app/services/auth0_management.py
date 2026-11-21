"""Auth0 Management API calls used to invite people and assign platform roles.

The running API does not trust a roles claim. Assigning a role here changes the
permissions Auth0 puts on the next access token.
"""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass
from urllib.parse import quote

import httpx

from app.core.config import Settings, get_settings

_ROLE_NAMES = {
    "user": "User",
    "admin": "Admin",
    "super-admin": "Super Admin",
}
_TOKEN_SKEW_SECONDS = 30.0


class Auth0DirectoryError(Exception):
    """The Management API could not complete the request."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class Auth0NotConfigured(Auth0DirectoryError):
    """Management API credentials are missing."""


class Auth0IdentityConflict(Auth0DirectoryError):
    """More than one Auth0 user still has this email."""


@dataclass(frozen=True, slots=True)
class Auth0Account:
    user_id: str
    email: str
    email_verified: bool
    name: str | None


class Auth0Directory:
    """Small Management API client. One token is cached per process."""

    def __init__(self, settings: Settings, client: httpx.Client | None = None) -> None:
        domain = (settings.auth0_domain or "").strip()
        client_id = (settings.auth0_mgmt_client_id or "").strip()
        client_secret = (settings.auth0_mgmt_client_secret or "").strip()
        if not domain or not client_id or not client_secret:
            raise Auth0NotConfigured(
                "User invitations need an Auth0 Management API application.",
            )
        self._domain = domain
        self._client_id = client_id
        self._client_secret = client_secret
        self._connection = settings.auth0_db_connection.strip() or "Username-Password-Authentication"
        self._client = client or httpx.Client(timeout=httpx.Timeout(10.0, connect=3.0))
        self._owns_client = client is None
        self._token = ""
        self._token_until = 0.0
        self._cached_role_ids: dict[str, str] | None = None

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def find_by_email(self, email: str) -> list[Auth0Account]:
        payload = self._request(
            "GET",
            "/api/v2/users-by-email",
            params={"email": email},
        )
        if not isinstance(payload, list):
            raise Auth0DirectoryError("Auth0 returned an unexpected user list.")
        accounts: list[Auth0Account] = []
        for item in payload:
            account = _account_from_payload(item, fallback_email=email)
            if account is not None:
                accounts.append(account)
        return accounts

    def lookup_account(self, user_id: str) -> tuple[bool, Auth0Account | None]:
        """Return ``(False, None)`` when Auth0 has no user for this ``sub`` (HTTP 404)."""
        payload = self._request(
            "GET",
            f"/api/v2/users/{quote(user_id, safe='')}",
            allow_404=True,
        )
        if payload is None:
            return False, None
        if not isinstance(payload, dict):
            raise Auth0DirectoryError("Auth0 returned an unexpected user.")
        return True, _account_from_payload(payload, fallback_email=None)

    def get_account(self, user_id: str) -> Auth0Account | None:
        present, account = self.lookup_account(user_id)
        if not present:
            return None
        return account

    def platform_role(self, user_id: str) -> str | None:
        """Map Auth0 role names User / Admin / Super Admin onto the local role string."""
        role_ids = self._role_ids()
        if not role_ids:
            return None
        current = self._user_role_ids(user_id)
        if role_ids.get("Super Admin") in current:
            return "super-admin"
        if role_ids.get("Admin") in current:
            return "admin"
        if role_ids.get("User") in current:
            return "user"
        return None

    def create_user(self, email: str) -> Auth0Account:
        password = f"{secrets.token_urlsafe(18)}Aa1!"
        payload = self._request(
            "POST",
            "/api/v2/users",
            json={
                "connection": self._connection,
                "email": email,
                "password": password,
                "email_verified": False,
                "verify_email": True,
            },
        )
        if not isinstance(payload, dict) or not isinstance(payload.get("user_id"), str):
            raise Auth0DirectoryError("Auth0 did not return the new user.")
        return Auth0Account(
            user_id=payload["user_id"],
            email=email,
            email_verified=False,
            name=None,
        )

    def assign_role(self, user_id: str, role: str) -> None:
        role_name = _ROLE_NAMES.get(role)
        if role_name is None:
            raise Auth0DirectoryError("Choose User, Admin, or Super Admin.")
        role_ids = self._role_ids()
        target = role_ids.get(role_name)
        if target is None:
            raise Auth0DirectoryError(f"Auth0 has no role named {role_name}.")
        current = self._user_role_ids(user_id)
        platform_ids = set(role_ids.values())
        remove = [role_id for role_id in current if role_id in platform_ids and role_id != target]
        encoded = quote(user_id, safe="")
        if remove:
            self._request(
                "DELETE",
                f"/api/v2/users/{encoded}/roles",
                json={"roles": remove},
            )
        if target not in current:
            self._request(
                "POST",
                f"/api/v2/users/{encoded}/roles",
                json={"roles": [target]},
            )

    def _role_ids(self) -> dict[str, str]:
        if self._cached_role_ids is not None:
            return self._cached_role_ids
        payload = self._request("GET", "/api/v2/roles", params={"per_page": 50})
        if not isinstance(payload, list):
            raise Auth0DirectoryError("Auth0 returned an unexpected role list.")
        found: dict[str, str] = {}
        for item in payload:
            if not isinstance(item, dict):
                continue
            name = item.get("name")
            role_id = item.get("id")
            if isinstance(name, str) and isinstance(role_id, str) and name in _ROLE_NAMES.values():
                found[name] = role_id
        self._cached_role_ids = found
        return found

    def _user_role_ids(self, user_id: str) -> set[str]:
        payload = self._request(
            "GET",
            f"/api/v2/users/{quote(user_id, safe='')}/roles",
            params={"per_page": 50},
        )
        if not isinstance(payload, list):
            raise Auth0DirectoryError("Auth0 returned an unexpected role list.")
        return {
            item["id"]
            for item in payload
            if isinstance(item, dict) and isinstance(item.get("id"), str)
        }

    def _access_token(self) -> str:
        now = time.monotonic()
        if self._token and now < self._token_until:
            return self._token
        response = self._client.post(
            f"https://{self._domain}/oauth/token",
            json={
                "grant_type": "client_credentials",
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "audience": f"https://{self._domain}/api/v2/",
            },
        )
        if response.status_code != 200:
            raise Auth0DirectoryError("Auth0 did not issue a Management API token.")
        body = response.json()
        token = body.get("access_token") if isinstance(body, dict) else None
        if not isinstance(token, str) or not token:
            raise Auth0DirectoryError("Auth0 did not issue a Management API token.")
        expires_in = body.get("expires_in") if isinstance(body, dict) else 3600
        lifetime = float(expires_in) if isinstance(expires_in, (int, float)) else 3600.0
        self._token = token
        self._token_until = now + max(0.0, lifetime - _TOKEN_SKEW_SECONDS)
        return token

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str | int] | None = None,
        json: dict[str, object] | None = None,
        allow_404: bool = False,
    ) -> object:
        response = self._client.request(
            method,
            f"https://{self._domain}{path}",
            params=params,
            json=json,
            headers={"Authorization": f"Bearer {self._access_token()}"},
        )
        if response.status_code == 404 and allow_404:
            return None
        if response.status_code >= 400:
            message = _error_message(response)
            raise Auth0DirectoryError(message)
        if response.status_code == 204 or not response.content:
            return None
        return response.json()


def _account_from_payload(
    item: object,
    *,
    fallback_email: str | None,
) -> Auth0Account | None:
    if not isinstance(item, dict):
        return None
    user_id = item.get("user_id")
    if not isinstance(user_id, str) or not user_id:
        return None
    raw_email = item.get("email")
    email = (
        raw_email.strip().lower()
        if isinstance(raw_email, str) and raw_email.strip()
        else fallback_email
    )
    if not email:
        return None
    name = item.get("name")
    return Auth0Account(
        user_id=user_id,
        email=email,
        email_verified=item.get("email_verified") is True,
        name=name.strip() if isinstance(name, str) and name.strip() else None,
    )


def _error_message(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        body = None
    if isinstance(body, dict):
        message = body.get("message") or body.get("error_description")
        if isinstance(message, str) and message.strip():
            return message.strip()
    return "Auth0 could not update that user."


def open_auth0_directory() -> Auth0Directory:
    return Auth0Directory(get_settings())
