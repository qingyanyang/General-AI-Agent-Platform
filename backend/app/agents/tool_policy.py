"""Server-side tool authorization: allowlists, permissions, and runtime context."""

from __future__ import annotations

from contextvars import ContextVar, Token
from dataclasses import dataclass
from typing import TYPE_CHECKING

from app.core.permissions import PERM_AGENTS_EXECUTE

if TYPE_CHECKING:
    from app.agents.tools.registry import ToolRegistry


@dataclass(frozen=True, slots=True)
class ToolAuthContext:
    """Trusted backend identity for tool authorization (never from the model)."""

    user_id: str
    permissions: frozenset[str]
    agent_id: str


class ToolAuthorizationError(Exception):
    """Raised when a tool call is not authorized; the tool must not run."""

    def __init__(self, name: str, reason: str = "not authorized") -> None:
        self.name = name
        self.reason = reason
        super().__init__(f"Tool '{name}' is {reason}")


# Built-in tool names registered by create_default_registry().
BUILTIN_TOOL_NAMES: frozenset[str] = frozenset({"add", "multiply", "echo"})

# Default required permissions for built-in tools (issue #18 decision 1A).
BUILTIN_REQUIRED_PERMISSIONS: frozenset[str] = frozenset({PERM_AGENTS_EXECUTE})

# Code/config allowlist by agent_id (separate from #17 access grants).
# Unknown agent_id → empty set (fail closed).
AGENT_TOOL_ALLOWLIST: dict[str, frozenset[str]] = {
    "default": BUILTIN_TOOL_NAMES,
    # Strict subset for authorization tests (tools not listed → denied).
    "reporting": frozenset({"echo"}),
}

_tool_auth_context: ContextVar[ToolAuthContext | None] = ContextVar(
    "tool_auth_context",
    default=None,
)


def set_tool_auth_context(context: ToolAuthContext) -> Token[ToolAuthContext | None]:
    """Bind auth context for the current task (and asyncio children)."""
    return _tool_auth_context.set(context)


def reset_tool_auth_context(token: Token[ToolAuthContext | None]) -> None:
    """Restore the previous ContextVar value after a run."""
    _tool_auth_context.reset(token)


def get_tool_auth_context() -> ToolAuthContext | None:
    """Return the ContextVar value, or None if unset."""
    return _tool_auth_context.get()


def agent_tool_allowlist(agent_id: str) -> frozenset[str]:
    """Allowlisted tool names for ``agent_id``; unknown agents get nothing."""
    return AGENT_TOOL_ALLOWLIST.get(agent_id, frozenset())


def permitted_tool_names(
    registry: ToolRegistry,
    context: ToolAuthContext,
) -> frozenset[str]:
    """Intersection of allowlist, registry, and user permissions."""
    allowed = agent_tool_allowlist(context.agent_id)
    permitted: set[str] = set()
    for name in allowed:
        if not registry.has(name):
            continue
        required = registry.required_permissions_for(name)
        if required <= context.permissions:
            permitted.add(name)
    return frozenset(permitted)


def authorize_tool_call(
    *,
    name: str,
    registry: ToolRegistry,
    context: ToolAuthContext | None,
) -> None:
    """Raise ToolAuthorizationError unless context may execute ``name``.

    Used only inside the registry execution path.
    """
    if context is None:
        raise ToolAuthorizationError(name, "not authorized (missing context)")
    if name not in agent_tool_allowlist(context.agent_id):
        raise ToolAuthorizationError(name, "not authorized for this agent")
    required = registry.required_permissions_for(name)
    if not required <= context.permissions:
        raise ToolAuthorizationError(name, "not authorized (missing permissions)")
