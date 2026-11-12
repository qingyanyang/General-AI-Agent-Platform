"""Approved MCP server names and URLs. No network I/O."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

import httpx

_SERVER_NAME = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
_REMOTE_NAME = re.compile(r"^[A-Za-z0-9_-]+$")
_MAX_REGISTRY_NAME_LENGTH = 64


@dataclass(frozen=True, slots=True)
class ApprovedMcpServer:
    """One allowlist entry. The client may open only this URL."""

    name: str
    url: str


def parse_approved_mcp_servers(value: str | list[Any] | None) -> tuple[ApprovedMcpServer, ...]:
    """Parse ``APPROVED_MCP_SERVERS``. Empty means no MCP servers."""
    if value is None or value == "":
        return ()
    raw_list = value if isinstance(value, list) else _load_json_array(value)
    servers: list[ApprovedMcpServer] = []
    seen_names: set[str] = set()
    for item in raw_list:
        if not isinstance(item, dict):
            raise ValueError("APPROVED_MCP_SERVERS entries must be objects")
        name = str(item.get("name", "")).strip()
        if not _SERVER_NAME.fullmatch(name) or "__" in name:
            raise ValueError(
                "MCP server name must match ^[a-z][a-z0-9_]{0,31}$ and must not contain '__'",
            )
        if name in seen_names:
            raise ValueError(f"duplicate MCP server name '{name}'")
        seen_names.add(name)
        url = _normalize_http_url(str(item.get("url", "")))
        servers.append(ApprovedMcpServer(name=name, url=url))
    return tuple(servers)


def registry_name_for(server_name: str, remote_name: str) -> str | None:
    """Model-facing tool name, or None when the pair is not a safe provider tool name.

    ``__`` is the separator. Either side containing ``__`` would make two different
    pairs share one registry name, so those tools are not registered.
    """
    if "__" in server_name or "__" in remote_name:
        return None
    if not _SERVER_NAME.fullmatch(server_name) or not _REMOTE_NAME.fullmatch(remote_name):
        return None
    composed = f"{server_name}__{remote_name}"
    if len(composed) > _MAX_REGISTRY_NAME_LENGTH:
        return None
    return composed


def url_is_approved_target(approved_url: str, candidate: httpx.URL) -> bool:
    """Allow the approved URL, or that URL with only a trailing slash added or removed."""
    approved = httpx.URL(approved_url)
    if candidate.userinfo:
        return False
    if (approved.scheme, approved.host, approved.port) != (
        candidate.scheme,
        candidate.host,
        candidate.port,
    ):
        return False
    if candidate.query != approved.query:
        return False
    return _path_is_trailing_slash_variant(approved.path or "/", candidate.path or "/")


def _path_is_trailing_slash_variant(approved: str, candidate: str) -> bool:
    if not approved.startswith("/"):
        approved = f"/{approved}"
    if not candidate.startswith("/"):
        candidate = f"/{candidate}"
    if candidate == approved:
        return True
    if approved.endswith("/"):
        return candidate == approved[:-1]
    return candidate == f"{approved}/"


def _load_json_array(value: str) -> list[Any]:
    try:
        loaded = json.loads(value)
    except json.JSONDecodeError as exc:
        raise ValueError("APPROVED_MCP_SERVERS must be a JSON array") from exc
    if not isinstance(loaded, list):
        raise ValueError("APPROVED_MCP_SERVERS must be a JSON array")
    return loaded


def _normalize_http_url(raw: str) -> str:
    stripped = raw.strip()
    if not stripped or any(char.isspace() for char in stripped):
        raise ValueError("MCP server URL must be http or https")
    url = httpx.URL(stripped)
    if url.scheme not in {"http", "https"} or not url.host:
        raise ValueError("MCP server URL must be http or https")
    if url.userinfo:
        raise ValueError("MCP server URL must not include credentials")
    if url.fragment:
        raise ValueError("MCP server URL must not include a fragment")
    return str(url.copy_with(fragment=None))
