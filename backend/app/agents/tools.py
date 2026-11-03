"""Registered tools for the demo agent runtime."""

from langchain_core.tools import tool


@tool
def add(a: float, b: float) -> float:
    """Add two numbers and return the sum."""
    return a + b

# for testing purposes only
# @tool 
# def get_test_code() -> str:
#     """Retrieve the current runtime test code."""
#     return "EAP-TEST-742"

AGENT_TOOLS = [add]
