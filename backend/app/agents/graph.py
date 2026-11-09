"""LangGraph StateGraph: LLM node, ToolNode, and conditional routing."""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, ToolMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.prebuilt import tools_condition
from pydantic import ValidationError

from app.agents.errors import AgentNotConfiguredError
from app.agents.state import AgentState
from app.agents.tools import (
    ToolNotRegisteredError,
    ToolRegistry,
    ToolValidationError,
    create_default_registry,
)
from app.core.config import get_settings

logger = logging.getLogger(__name__)

DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_DEFAULT_MODEL = "deepseek-flash"
OPENAI_DEFAULT_MODEL = "gpt-4o-mini"


def create_chat_model() -> ChatOpenAI:
    """Build an OpenAI-compatible chat model from settings (OpenAI or DeepSeek)."""
    settings = get_settings()
    provider = settings.llm_provider.strip().lower()
    if provider not in {"openai", "deepseek"}:
        raise AgentNotConfiguredError(
            f"Unsupported LLM_PROVIDER '{settings.llm_provider}'; use 'openai' or 'deepseek'",
        )

    api_key = settings.resolve_llm_api_key()
    if not api_key:
        if provider == "deepseek":
            raise AgentNotConfiguredError(
                "LLM_API_KEY or DEEPSEEK_API_KEY is not configured",
            )
        raise AgentNotConfiguredError("LLM_API_KEY is not configured")

    model = settings.llm_model
    base_url = settings.llm_base_url
    kwargs: dict[str, object] = {
        "model": model,
        "api_key": api_key,
    }

    if provider == "deepseek":
        # Docs: https://api-docs.deepseek.com/ — OpenAI-compatible; tool calling supported.
        kwargs["base_url"] = base_url or DEEPSEEK_BASE_URL
        if model == OPENAI_DEFAULT_MODEL:
            kwargs["model"] = DEEPSEEK_DEFAULT_MODEL
        # Tool-calls guide disables thinking for reliable function calling.
        kwargs["extra_body"] = {"thinking": {"type": "disabled"}}
    elif base_url:
        kwargs["base_url"] = base_url

    return ChatOpenAI(**kwargs)


def _tool_call_args(tool_call: dict[str, Any] | Any) -> dict[str, Any]:
    if isinstance(tool_call, dict):
        args = tool_call.get("args") or {}
    else:
        args = getattr(tool_call, "args", {}) or {}
    return dict(args) if isinstance(args, dict) else {}


def _tool_call_name(tool_call: dict[str, Any] | Any) -> str:
    if isinstance(tool_call, dict):
        return str(tool_call.get("name") or "")
    return str(getattr(tool_call, "name", "") or "")


def _tool_call_id(tool_call: dict[str, Any] | Any) -> str:
    if isinstance(tool_call, dict):
        return str(tool_call.get("id") or "")
    return str(getattr(tool_call, "id", "") or "")


async def _execute_registered_tools(
    state: AgentState,
    registry: ToolRegistry,
) -> dict[str, list[ToolMessage]]:
    """Run only registry-approved tool calls; return ToolMessages (including errors)."""
    last = state["messages"][-1]
    if not isinstance(last, AIMessage) or not last.tool_calls:
        return {"messages": []}

    outputs: list[ToolMessage] = []
    for tool_call in last.tool_calls:
        name = _tool_call_name(tool_call)
        call_id = _tool_call_id(tool_call)
        args = _tool_call_args(tool_call)

        if not registry.has(name):
            outputs.append(
                ToolMessage(
                    content=f"Error: tool '{name}' is not registered and cannot be executed",
                    tool_call_id=call_id,
                    name=name or "unknown",
                )
            )
            continue

        try:
            result = await registry.aexecute(name, args)
            outputs.append(
                ToolMessage(
                    content=str(result),
                    tool_call_id=call_id,
                    name=name,
                )
            )
        except ToolNotRegisteredError:
            outputs.append(
                ToolMessage(
                    content=f"Error: tool '{name}' is not registered and cannot be executed",
                    tool_call_id=call_id,
                    name=name,
                )
            )
        except (ToolValidationError, ValidationError) as exc:
            logger.info("Tool argument validation failed for %s: %s", name, exc)
            outputs.append(
                ToolMessage(
                    content=f"Validation error for tool '{name}': {exc}",
                    tool_call_id=call_id,
                    name=name,
                )
            )
        except Exception:  # noqa: BLE001 — keep agent loop alive on tool failure
            logger.exception("Tool execution failed for %s", name)
            outputs.append(
                ToolMessage(
                    content=f"Tool execution error for '{name}'",
                    tool_call_id=call_id,
                    name=name,
                )
            )

    return {"messages": outputs}


def build_agent_graph(
    *,
    llm: BaseChatModel | None = None,
    registry: ToolRegistry | None = None,
    checkpointer: Any | None = None,
) -> CompiledStateGraph:
    """Compile the agent graph using registry-backed tools only.

    Pass ``checkpointer`` for durable multi-turn runs. Omit it for stateless
    single-shot invokes (even when a saver exists on the app).
    """
    tool_registry = registry if registry is not None else create_default_registry()
    tools = tool_registry.get_langchain_tools()
    model = llm if llm is not None else create_chat_model()
    model_with_tools = model.bind_tools(tools)

    async def llm_node(state: AgentState) -> dict:
        response = await model_with_tools.ainvoke(state["messages"])
        return {"messages": [response]}

    async def tools_node(state: AgentState) -> dict:
        return await _execute_registered_tools(state, tool_registry)

    graph = StateGraph(AgentState)
    graph.add_node("llm", llm_node)
    graph.add_node("tools", tools_node)
    graph.add_edge(START, "llm")
    graph.add_conditional_edges("llm", tools_condition, {"tools": "tools", END: END})
    graph.add_edge("tools", "llm")
    if checkpointer is None:
        return graph.compile()
    return graph.compile(checkpointer=checkpointer)
