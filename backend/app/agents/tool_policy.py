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
    # Persisted agent tool assignments (#20). Empty ⇒ no tools (never all-tools).
    allowed_tools: frozenset[str] = frozenset()


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


def permitted_tool_names(
    registry: ToolRegistry,
    context: ToolAuthContext,
) -> frozenset[str]:
    """Intersection of persisted allowlist, registry, and user permissions."""
    permitted: set[str] = set()
    for name in context.allowed_tools:
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
    if name not in context.allowed_tools:
        raise ToolAuthorizationError(name, "not authorized for this agent")
    required = registry.required_permissions_for(name)
    if not required <= context.permissions:
        raise ToolAuthorizationError(name, "not authorized (missing permissions)")
