"""Platform permission names and Auth0 role matrix (#16).

Server authorization uses the access-token ``permissions`` claim only.
Roles are assigned in the Auth0 Dashboard; the API does not trust a roles claim.
"""

from __future__ import annotations

from typing import Final

PERM_AGENTS_READ: Final = "agents:read"
PERM_AGENTS_CONFIGURE: Final = "agents:configure"
PERM_AGENTS_EXECUTE: Final = "agents:execute"
PERM_AGENT_ACCESS_MANAGE: Final = "agent-access:manage"

ALL_PERMISSIONS: Final[frozenset[str]] = frozenset(
    {
        PERM_AGENTS_READ,
        PERM_AGENTS_CONFIGURE,
        PERM_AGENTS_EXECUTE,
        PERM_AGENT_ACCESS_MANAGE,
    }
)

# Documented Auth0 role → permission mapping (Dashboard assignment).
ROLE_PERMISSIONS: Final[dict[str, frozenset[str]]] = {
    "Admin": ALL_PERMISSIONS,
    "Agent Developer": frozenset(
        {
            PERM_AGENTS_READ,
            PERM_AGENTS_CONFIGURE,
            PERM_AGENTS_EXECUTE,
        }
    ),
    "Agent User": frozenset(
        {
            PERM_AGENTS_READ,
            PERM_AGENTS_EXECUTE,
        }
    ),
}
