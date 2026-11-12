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
    """Raised when tool arguments or successful outputs fail schema validation."""


class ToolConnectionError(ToolError):
    """Transport, connectivity, or deadline failure. The remote tool did not report a result."""

    def __init__(self, name: str) -> None:
        self.name = name
        super().__init__(f"Tool connection error for '{name}'")


class ToolExecutionError(ToolError):
    """The remote tool ran and reported a failure, or returned content we will not pass on."""

    def __init__(self, name: str) -> None:
        self.name = name
        super().__init__(f"Tool execution error for '{name}'")
