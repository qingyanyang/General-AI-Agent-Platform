"""Tool registry and built-in tools for the agent runtime."""

from app.agents.tool_policy import BUILTIN_REQUIRED_PERMISSIONS
from app.agents.tools.builtins import add, echo, multiply
from app.agents.tools.errors import (
    ToolConnectionError,
    ToolError,
    ToolExecutionError,
    ToolNotRegisteredError,
    ToolRegistryError,
    ToolValidationError,
)
from app.agents.tools.mcp import mcp_tools_from_catalog
from app.agents.tools.registry import ToolMetadata, ToolRegistry


def create_default_registry() -> ToolRegistry:
    """Build a registry of built-ins plus the startup MCP catalog."""
    registry = ToolRegistry()
    registry.register(add, required_permissions=BUILTIN_REQUIRED_PERMISSIONS)
    registry.register(multiply, required_permissions=BUILTIN_REQUIRED_PERMISSIONS)
    registry.register(echo, required_permissions=BUILTIN_REQUIRED_PERMISSIONS)
    for tool in mcp_tools_from_catalog():
        if registry.has(tool.name):
            continue
        registry.register(tool, required_permissions=BUILTIN_REQUIRED_PERMISSIONS)
    return registry


__all__ = [
    "ToolConnectionError",
    "ToolError",
    "ToolExecutionError",
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
