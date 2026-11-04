"""Tool registry and execution errors."""


class ToolError(Exception):
    """Base tool-layer error."""


class ToolRegistryError(ToolError):
    """Invalid registry operation (e.g. duplicate registration)."""


class ToolNotRegisteredError(ToolError):
    """Raised when a tool name is not in the registry."""

    def __init__(self, name: str) -> None:
        self.name = name
        super().__init__(f"Tool '{name}' is not registered")


class ToolValidationError(ToolError):
    """Raised when tool arguments fail schema validation."""
