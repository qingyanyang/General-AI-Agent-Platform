"""Agent runtime errors mapped to HTTP by the API layer."""


class AgentError(Exception):
    """Base agent runtime error."""


class AgentNotConfiguredError(AgentError):
    """Raised when the LLM / agent cannot run (e.g. missing API key)."""


class AgentExecutionError(AgentError):
    """Raised when graph or LLM execution fails."""

    def __init__(self, message: str, *, execution_id: str | None = None) -> None:
        super().__init__(message)
        self.execution_id = execution_id
