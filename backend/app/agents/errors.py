"""Agent runtime errors mapped to HTTP by the API layer."""


class AgentError(Exception):
    """Base agent runtime error."""


class AgentNotConfiguredError(AgentError):
    """Raised when the LLM / agent cannot run (e.g. missing API key)."""


class AgentExecutionError(AgentError):
    """Raised when graph or LLM execution fails."""
