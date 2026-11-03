"""Safe built-in tools for demonstration and testing."""

from langchain_core.tools import tool


@tool
def add(a: float, b: float) -> float:
    """Add two numbers and return the sum."""
    return a + b


@tool
def multiply(a: float, b: float) -> float:
    """Multiply two numbers and return the product."""
    return a * b


@tool
def echo(text: str) -> str:
    """Echo the provided text unchanged (for schema / wiring tests)."""
    return text
