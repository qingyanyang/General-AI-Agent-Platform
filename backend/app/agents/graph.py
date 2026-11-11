"""LangGraph StateGraph: LLM node, ToolNode, and conditional routing."""

from __future__ import annotations

import asyncio
import logging
from contextvars import ContextVar
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
from app.agents.tool_policy import ToolAuthorizationError, get_tool_auth_context
from app.agents.tools import (
    ToolNotRegisteredError,
    ToolRegistry,
    ToolValidationError,
    create_default_registry,
)
from app.core.config import get_settings

logger = logging.getLogger(__name__)

# Tasks currently executing a graph node. stream_agent sets this so a cancelled
# producer can cancel nodes LangGraph scheduled with their own tasks.
inflight_node_tasks: ContextVar[set[asyncio.Task[Any]] | None] = ContextVar(
    "inflight_node_tasks",
    default=None,
)

_AUTH_DENIED_CONTENT = "Error: tool '{name}' is not authorized"


def _note_inflight_task() -> None:
    bucket = inflight_node_tasks.get()
    task = asyncio.current_task()
    if bucket is not None and task is not None:
        bucket.add(task)


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

    context = get_tool_auth_context()
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
            result = await registry.aexecute(name, args, context=context)
            outputs.append(
                ToolMessage(
                    content=str(result),
                    tool_call_id=call_id,
                    name=name,
                )
            )
        except ToolAuthorizationError as exc:
            agent_id = context.agent_id if context is not None else None
            logger.info(
                "Tool authorization denied for %s agent_id=%s reason=%s",
                name,
                agent_id,
                exc.reason,
            )
            outputs.append(
                ToolMessage(
                    content=_AUTH_DENIED_CONTENT.format(name=name),
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


# Production-path cache (llm/registry defaulted). Keyed by checkpointer + permitted tools.
_graph_cache: dict[tuple[int | None, frozenset[str]], CompiledStateGraph] = {}


def clear_agent_graph_cache() -> None:
    """Drop cached compiled graphs (tests / settings changes)."""
    _graph_cache.clear()


def build_agent_graph(
    *,
    llm: BaseChatModel | None = None,
    registry: ToolRegistry | None = None,
    checkpointer: Any | None = None,
    permitted_tools: frozenset[str] | None = None,
) -> CompiledStateGraph:
    """Compile the agent graph using registry-backed tools only.

    Pass ``checkpointer`` for durable multi-turn runs. Omit it for stateless
    single-shot invokes (even when a saver exists on the app).

    ``permitted_tools`` is the model-visible allowlist for this run. ``None`` or
    empty binds no tools (unbound model — never ``bind_tools([])``). There is
    no unfiltered full-registry fallback.

    When ``llm`` and ``registry`` are omitted, compiled graphs are cached per
    checkpointer instance and permitted set for the process lifetime.
    """
    permitted = frozenset(permitted_tools or ())
    use_cache = llm is None and registry is None
    cache_key: tuple[int | None, frozenset[str]] = (
        id(checkpointer) if checkpointer is not None else None,
        permitted,
    )
    if use_cache and cache_key in _graph_cache:
        return _graph_cache[cache_key]

    tool_registry = registry if registry is not None else create_default_registry()
    tools = tool_registry.get_langchain_tools(permitted)
    model = llm if llm is not None else create_chat_model()
    # Providers may reject bind_tools([]); keep unbound model when empty.
    model_with_tools = model.bind_tools(tools) if tools else model

    async def llm_node(state: AgentState) -> dict:
        _note_inflight_task()
        merged = None
        async for chunk in model_with_tools.astream(state["messages"]):
            merged = chunk if merged is None else merged + chunk
        if merged is None:
            return {"messages": [AIMessage(content="")]}
        return {"messages": [merged]}

    async def tools_node(state: AgentState) -> dict:
        _note_inflight_task()
        return await _execute_registered_tools(state, tool_registry)

    graph = StateGraph(AgentState)
    graph.add_node("llm", llm_node)
    graph.add_node("tools", tools_node)
    graph.add_edge(START, "llm")
    graph.add_conditional_edges("llm", tools_condition, {"tools": "tools", END: END})
    graph.add_edge("tools", "llm")
    compiled = graph.compile() if checkpointer is None else graph.compile(checkpointer=checkpointer)
    if use_cache:
        _graph_cache[cache_key] = compiled
    return compiled
