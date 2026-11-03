"""Registered tools for the demo agent runtime."""

from langchain_core.tools import tool


@tool
def add(a: float, b: float) -> float:
    """Add two numbers and return the sum."""
    return a + b


AGENT_TOOLS = [add]
