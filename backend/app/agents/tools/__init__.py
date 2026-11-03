"""Tool registry and built-in tools for the agent runtime."""

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
    registry.register(add)
    registry.register(multiply)
    registry.register(echo)
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
