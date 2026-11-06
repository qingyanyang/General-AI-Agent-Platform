"""Unit tests for the tool registry, validation, and safe execution."""

from __future__ import annotations

import asyncio

import pytest
from app.agents.graph import build_agent_graph
from app.agents.tools import (
    ToolNotRegisteredError,
    ToolRegistry,
    ToolRegistryError,
    ToolValidationError,
    add,
    create_default_registry,
    echo,
    multiply,
)
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.tools import tool

from tests.fakes import ScriptedChatModel


def test_register_and_retrieve_tools() -> None:
    registry = ToolRegistry()
    registry.register(add)
    registry.register(multiply)

    assert registry.has("add")
    assert registry.get("add") is add
    names = {item.name for item in registry.list()}
    assert names == {"add", "multiply"}


def test_duplicate_registration_rejected() -> None:
    registry = ToolRegistry()
    registry.register(add)
    with pytest.raises(ToolRegistryError, match="already registered"):
        registry.register(add)


def test_registered_tools_expose_input_schemas() -> None:
    registry = create_default_registry()
    metadata = {item.name: item for item in registry.list()}

    assert "add" in metadata
    assert metadata["add"].description
    assert "properties" in metadata["add"].args_schema
    assert "a" in metadata["add"].args_schema["properties"]
    assert "b" in metadata["add"].args_schema["properties"]

    assert "echo" in metadata
    assert "text" in metadata["echo"].args_schema["properties"]


def test_invalid_tool_arguments_raise_validation_error() -> None:
    registry = create_default_registry()

    with pytest.raises(ToolValidationError, match="valid number|validation"):
        asyncio.run(registry.aexecute("add", {"a": "not-a-float"}))


def test_unregistered_tool_cannot_be_executed() -> None:
    registry = create_default_registry()

    with pytest.raises(ToolNotRegisteredError, match="not registered"):
        asyncio.run(registry.aexecute("drop_database", {"confirm": True}))


def test_default_registry_includes_builtins() -> None:
    registry = create_default_registry()
    tools = {tool.name for tool in registry.get_langchain_tools()}
    assert tools == {"add", "multiply", "echo"}


def test_langgraph_invokes_registered_tool() -> None:
    llm = ScriptedChatModel(
        script=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "multiply",
                        "args": {"a": 137, "b": 29},
                        "id": "call_mul_1",
                        "type": "tool_call",
                    }
                ],
            ),
            AIMessage(content="The product is 3973."),
        ]
    )
    graph = build_agent_graph(llm=llm, registry=create_default_registry())
    result = asyncio.run(graph.ainvoke({"messages": [HumanMessage(content="What is 137 * 29?")]}))
    messages = result["messages"]
    roles = [msg.type for msg in messages]
    assert "tool" in roles
    tool_msg = next(msg for msg in messages if msg.type == "tool")
    assert tool_msg.content == "3973.0"
    assert messages[-1].content == "The product is 3973."


def test_unregistered_tool_call_returns_error_tool_message() -> None:
    registry = ToolRegistry()
    registry.register(echo)
    llm = ScriptedChatModel(
        script=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "not_a_real_tool",
                        "args": {},
                        "id": "call_bad_1",
                        "type": "tool_call",
                    }
                ],
            ),
            AIMessage(content="I could not use that tool."),
        ]
    )
    graph = build_agent_graph(llm=llm, registry=registry)
    result = asyncio.run(graph.ainvoke({"messages": [HumanMessage(content="hack")]}))
    tool_msg = next(msg for msg in result["messages"] if msg.type == "tool")
    assert "not registered" in tool_msg.content
    assert result["messages"][-1].content == "I could not use that tool."


def test_tool_execution_failure_does_not_crash_graph() -> None:
    @tool
    def boom() -> str:
        """Always fails."""
        raise RuntimeError("kaboom")

    registry = ToolRegistry()
    registry.register(boom)
    llm = ScriptedChatModel(
        script=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "boom",
                        "args": {},
                        "id": "call_boom_1",
                        "type": "tool_call",
                    }
                ],
            ),
            AIMessage(content="Recovered after tool failure."),
        ]
    )
    graph = build_agent_graph(llm=llm, registry=registry)
    result = asyncio.run(graph.ainvoke({"messages": [HumanMessage(content="go")]}))
    tool_msg = next(msg for msg in result["messages"] if msg.type == "tool")
    assert tool_msg.content == "Tool execution error for 'boom'"
    assert "kaboom" not in tool_msg.content
    assert result["messages"][-1].content == "Recovered after tool failure."
