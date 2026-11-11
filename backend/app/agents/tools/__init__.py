"""Tool registry and built-in tools for the agent runtime."""

from app.agents.tool_policy import BUILTIN_REQUIRED_PERMISSIONS
from app.agents.tools.builtins import add, echo, multiply
from app.agents.tools.errors import (
    ToolError,
    ToolNotRegisteredError,
    ToolRegistryError,
    ToolValidationError,
)
from app.agents.tools.registry import ToolMetadata, ToolRegistry


def create_default_registry() -> ToolRegistry:
    """Build a registry pre-loaded with safe built-in tools."""
    registry = ToolRegistry()
    registry.register(add, required_permissions=BUILTIN_REQUIRED_PERMISSIONS)
    registry.register(multiply, required_permissions=BUILTIN_REQUIRED_PERMISSIONS)
    registry.register(echo, required_permissions=BUILTIN_REQUIRED_PERMISSIONS)
    return registry


__all__ = [
    "ToolError",
    "ToolMetadata",
    "ToolNotRegisteredError",
    "ToolRegistry",
    "ToolRegistryError",
    "ToolValidationError",
    "add",
    "create_default_registry",
    "echo",
    "multiply",
]
