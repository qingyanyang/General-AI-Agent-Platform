"""Platform permission names and Auth0 role matrix.

Server authorization uses the access-token ``permissions`` claim only.
Roles are assigned in the Auth0 Dashboard; the API does not trust a roles claim.

Target roles (Issue 4): Super Admin, Admin, User. Do not treat Agent Developer
as a target role. Group leadership never grants ``platform:technical``.
"""

from __future__ import annotations

from typing import Final

PERM_AGENTS_READ: Final = "agents:read"
PERM_AGENTS_CONFIGURE: Final = "agents:configure"
PERM_AGENTS_EXECUTE: Final = "agents:execute"
PERM_AGENT_ACCESS_MANAGE: Final = "agent-access:manage"
PERM_PLATFORM_TECHNICAL: Final = "platform:technical"

ALL_PERMISSIONS: Final[frozenset[str]] = frozenset(
    {
        PERM_AGENTS_READ,
        PERM_AGENTS_CONFIGURE,
        PERM_AGENTS_EXECUTE,
        PERM_AGENT_ACCESS_MANAGE,
        PERM_PLATFORM_TECHNICAL,
    }
)

# Documented Auth0 role → permission mapping (Dashboard assignment only).
ROLE_PERMISSIONS: Final[dict[str, frozenset[str]]] = {
    "Super Admin": ALL_PERMISSIONS,
    "Admin": frozenset(
        {
            PERM_AGENTS_READ,
            PERM_AGENTS_CONFIGURE,
            PERM_AGENTS_EXECUTE,
            PERM_AGENT_ACCESS_MANAGE,
        }
    ),
    "User": frozenset(
        {
            PERM_AGENTS_READ,
            PERM_AGENTS_EXECUTE,
        }
    ),
}
