"""Unit tests for the tool registry, validation, and safe execution."""

from __future__ import annotations

import asyncio

import pytest
from app.agents.graph import build_agent_graph
from app.agents.runtime import run_agent
from app.agents.tool_policy import (
    AGENT_TOOL_ALLOWLIST,
    BUILTIN_REQUIRED_PERMISSIONS,
    BUILTIN_TOOL_NAMES,
    ToolAuthorizationError,
    reset_tool_auth_context,
    set_tool_auth_context,
)
from app.agents.tools import (
    ToolNotRegisteredError,
    ToolRegistry,
    ToolRegistryError,
    ToolValidationError,
    add,
    create_default_registry,
    multiply,
)
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.tools import tool
from pytest import MonkeyPatch

from tests.chat_helpers import default_tool_auth
from tests.fakes import ScriptedChatModel


def test_register_and_retrieve_tools() -> None:
    registry = ToolRegistry()
    registry.register(add, required_permissions=BUILTIN_REQUIRED_PERMISSIONS)
    registry.register(multiply, required_permissions=BUILTIN_REQUIRED_PERMISSIONS)

    assert registry.has("add")
    assert registry.get("add") is add
    names = {item.name for item in registry.list()}
    assert names == {"add", "multiply"}


def test_duplicate_registration_rejected() -> None:
    registry = ToolRegistry()
    registry.register(add, required_permissions=BUILTIN_REQUIRED_PERMISSIONS)
    with pytest.raises(ToolRegistryError, match="already registered"):
        registry.register(add, required_permissions=BUILTIN_REQUIRED_PERMISSIONS)


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
    auth = default_tool_auth()

    with pytest.raises(ToolValidationError, match="valid number|validation"):
        asyncio.run(registry.aexecute("add", {"a": "not-a-float"}, context=auth))


def test_unregistered_tool_cannot_be_executed() -> None:
    registry = create_default_registry()
    auth = default_tool_auth()

    with pytest.raises(ToolNotRegisteredError, match="not registered"):
        asyncio.run(registry.aexecute("drop_database", {"confirm": True}, context=auth))


def test_omitted_context_raises_authorization_error_not_type_error() -> None:
    registry = create_default_registry()

    with pytest.raises(ToolAuthorizationError, match="missing context"):
        asyncio.run(registry.aexecute("add", {"a": 1, "b": 2}))


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
    result = asyncio.run(
        run_agent("What is 137 * 29?", tool_auth=default_tool_auth(), llm=llm),
    )
    roles = [item.role for item in result.messages]
    assert "tool" in roles
    tool_msg = next(item for item in result.messages if item.role == "tool")
    assert tool_msg.content == "3973.0"
    assert result.reply == "The product is 3973."


def test_unregistered_tool_call_returns_error_tool_message() -> None:
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
    result = asyncio.run(run_agent("hack", tool_auth=default_tool_auth(), llm=llm))
    tool_msg = next(item for item in result.messages if item.role == "tool")
    assert "not registered" in tool_msg.content
    assert result.reply == "I could not use that tool."


def test_tool_execution_failure_does_not_crash_graph(monkeypatch: MonkeyPatch) -> None:
    @tool
    def boom() -> str:
        """Always fails."""
        raise RuntimeError("kaboom")

    registry = ToolRegistry()
    registry.register(boom, required_permissions=BUILTIN_REQUIRED_PERMISSIONS)
    monkeypatch.setitem(
        AGENT_TOOL_ALLOWLIST,
        "default",
        BUILTIN_TOOL_NAMES | frozenset({"boom"}),
    )

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
    graph = build_agent_graph(
        llm=llm,
        registry=registry,
        permitted_tools=frozenset({"boom"}),
    )
    token = set_tool_auth_context(default_tool_auth())
    try:
        result = asyncio.run(graph.ainvoke({"messages": [HumanMessage(content="go")]}))
    finally:
        reset_tool_auth_context(token)
    tool_msg = next(msg for msg in result["messages"] if msg.type == "tool")
    assert tool_msg.content == "Tool execution error for 'boom'"
    assert "kaboom" not in tool_msg.content
    assert result["messages"][-1].content == "Recovered after tool failure."
