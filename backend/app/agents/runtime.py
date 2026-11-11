"""Async agent execution with recursion limits and error mapping."""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator, Awaitable, Iterator
from dataclasses import dataclass
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langgraph.errors import GraphRecursionError

from app.agents.errors import AgentExecutionError, AgentNotConfiguredError
from app.agents.graph import (
    build_agent_graph,
    create_chat_model_for_agent,
    inflight_node_tasks,
)
from app.agents.messages import (
    extract_assistant_reply,
    message_content_text,
    normalize_message_views,
)
from app.agents.tool_policy import (
    ToolAuthContext,
    permitted_tool_names,
    reset_tool_auth_context,
    set_tool_auth_context,
)
from app.agents.tools import create_default_registry
from app.agents.tracing import build_run_config, langsmith_tracing
from app.core.config import get_settings
from app.schemas.chat_message import (
    ChatMessageOut,
    StreamError,
    StreamEvent,
    StreamMessageDelta,
    StreamToolEnd,
    StreamToolStart,
)
from app.services.agents import AgentExecutionConfig

logger = logging.getLogger(__name__)

_RECURSION_MESSAGE = "Agent stopped: recursion limit exceeded (possible tool-calling loop)"
_EXECUTION_FAILED_MESSAGE = "Agent execution failed"
_CANCELLED_TOOL_CONTENT = "Tool execution cancelled"


def ensure_llm_configured() -> None:
    """Raise when a live model would be built without an API key."""
    if not get_settings().resolve_llm_api_key():
        raise AgentNotConfiguredError(
            "LLM API key is not configured; cannot run the agent",
        )


@dataclass
class StreamOutcome:
    """Filled by ``stream_agent`` when the graph finishes.

    ``message`` is the authoritative final reply. The HTTP layer updates
    activity and emits ``done`` only after a successful outcome.
    """

    execution_id: str = ""
    message: ChatMessageOut | None = None
    failed: bool = False


@dataclass(frozen=True)
class AgentMessageView:
    role: str
    content: str


@dataclass(frozen=True)
class AgentResult:
    reply: str
    messages: list[AgentMessageView]
    execution_id: str


def _normalize_messages(messages: list[BaseMessage]) -> list[AgentMessageView]:
    return [
        AgentMessageView(role=role, content=content)
        for role, content in normalize_message_views(messages)
    ]


async def run_agent(
    message: str,
    *,
    tool_auth: ToolAuthContext,
    execution_config: AgentExecutionConfig,
    llm: BaseChatModel | None = None,
    checkpointer: Any | None = None,
    thread_id: str | None = None,
) -> AgentResult:
    """Run the agent graph for a user message.

    Stateless path (``thread_id is None``): compile without a checkpointer.
    Durable path (``thread_id`` set): require ``checkpointer`` and compile with it.
    Each turn passes only the new ``HumanMessage``; checkpoint restore retains history.

    ``tool_auth`` and ``execution_config`` are required. Config is an immutable
    snapshot from the API layer — this function does not open a DB session.
    """
    settings = get_settings()
    resolved_llm = llm
    if resolved_llm is None:
        resolved_llm = create_chat_model_for_agent(
            provider=execution_config.llm_provider,
            model=execution_config.llm_model,
            temperature=execution_config.temperature,
        )

    if thread_id is not None and checkpointer is None:
        raise AgentNotConfiguredError(
            "Conversation persistence is not configured",
        )

    execution_id = uuid.uuid4()
    execution_id_text = str(execution_id)
    use_checkpointer = thread_id is not None
    registry = create_default_registry()
    permitted = permitted_tool_names(registry, tool_auth)
    auth_token = set_tool_auth_context(tool_auth)
    try:
        try:
            graph = build_agent_graph(
                llm=resolved_llm,
                registry=registry,
                checkpointer=checkpointer if use_checkpointer else None,
                permitted_tools=permitted,
                system_prompt=execution_config.system_prompt,
            )
            config = build_run_config(
                settings,
                execution_id,
                thread_id=thread_id if use_checkpointer else None,
            )
            with langsmith_tracing(settings):
                result = await graph.ainvoke(
                    {"messages": [HumanMessage(content=message)]},
                    config=config,
                )
        except AgentNotConfiguredError:
            raise
        except GraphRecursionError as exc:
            raise AgentExecutionError(
                _RECURSION_MESSAGE,
                execution_id=execution_id_text,
            ) from exc
        except Exception as exc:  # noqa: BLE001 — map unexpected LLM/graph failures
            logger.exception(_EXECUTION_FAILED_MESSAGE)
            raise AgentExecutionError(
                _EXECUTION_FAILED_MESSAGE,
                execution_id=execution_id_text,
            ) from exc
    finally:
        reset_tool_auth_context(auth_token)

    messages = list(result.get("messages", []))
    return AgentResult(
        reply=extract_assistant_reply(messages),
        messages=_normalize_messages(messages),
        execution_id=execution_id_text,
    )


def _require_checkpointer_for_thread(
    thread_id: str | None,
    checkpointer: Any | None,
) -> None:
    if thread_id is not None and checkpointer is None:
        raise AgentNotConfiguredError(
            "Conversation persistence is not configured",
        )


def _tool_call_name(tool_call: Any) -> str:
    if isinstance(tool_call, dict):
        return str(tool_call.get("name") or "")
    return str(getattr(tool_call, "name", "") or "")


def _tool_call_id(tool_call: Any) -> str:
    if isinstance(tool_call, dict):
        return str(tool_call.get("id") or "")
    return str(getattr(tool_call, "id", "") or "")


def _messages_from_update(update: Any) -> list[BaseMessage]:
    if isinstance(update, dict):
        raw = update.get("messages") or []
    elif isinstance(update, list):
        raw = update
    else:
        return []
    return [item for item in raw if isinstance(item, BaseMessage)]


def _events_from_stream_item(
    item: Any,
    execution_id: str,
    collected: list[BaseMessage],
    deltas: dict[str, str],
) -> Iterator[StreamEvent]:
    if not isinstance(item, tuple):
        return
    if len(item) == 2:
        mode, data = item
    elif len(item) == 3:
        _, mode, data = item
    else:
        return

    if mode == "messages":
        if not isinstance(data, tuple) or len(data) != 2:
            return
        token, metadata = data
        if not isinstance(token, AIMessage):
            return
        node = metadata.get("langgraph_node") if isinstance(metadata, dict) else None
        if node not in (None, "llm"):
            return
        text = message_content_text(token)
        if not text:
            return
        message_id = token.id or ""
        prior = deltas.get(message_id, "")
        # LangGraph may replay the aggregated message under the same id.
        if prior and text == prior:
            return
        deltas[message_id] = prior + text
        yield StreamMessageDelta(execution_id=execution_id, content=text)
        return

    if mode != "updates" or not isinstance(data, dict):
        return
    for node, update in data.items():
        if node == "__metadata__":
            continue
        messages = _messages_from_update(update)
        collected.extend(messages)
        if node == "llm":
            for message in messages:
                if isinstance(message, AIMessage) and message.tool_calls:
                    for tool_call in message.tool_calls:
                        yield StreamToolStart(
                            execution_id=execution_id,
                            tool_call_id=_tool_call_id(tool_call),
                            name=_tool_call_name(tool_call),
                        )
        elif node == "tools":
            for message in messages:
                if isinstance(message, ToolMessage):
                    yield StreamToolEnd(
                        execution_id=execution_id,
                        tool_call_id=message.tool_call_id or "",
                        name=message.name or "",
                        content=message_content_text(message),
                    )


def _unanswered_tool_calls(messages: list[BaseMessage]) -> list[tuple[str, str]]:
    """Tool calls with no matching ``ToolMessage``, as ``(name, tool_call_id)``."""
    answered = {
        message.tool_call_id
        for message in messages
        if isinstance(message, ToolMessage) and message.tool_call_id
    }
    pending: list[tuple[str, str]] = []
    for message in messages:
        if not isinstance(message, AIMessage):
            continue
        for tool_call in message.tool_calls:
            call_id = _tool_call_id(tool_call)
            if call_id in answered:
                continue
            pending.append((_tool_call_name(tool_call), call_id))
            answered.add(call_id)
    return pending


async def _append_cancelled_tool_messages(graph: Any, config: dict[str, Any]) -> None:
    """Record a result for tool calls left open by a cancelled run.

    Chat Completions rejects a later turn whose history has an assistant
    ``tool_calls`` message without a tool result for every id.
    """
    snapshot = await graph.aget_state(config)
    messages = snapshot.values.get("messages") or []
    pending = _unanswered_tool_calls(messages)
    if not pending:
        return
    await graph.aupdate_state(
        config,
        {
            "messages": [
                ToolMessage(
                    content=_CANCELLED_TOOL_CONTENT,
                    tool_call_id=call_id,
                    name=name,
                )
                for name, call_id in pending
            ]
        },
        as_node="tools",
    )


async def _await_despite_cancellation(awaitable: Awaitable[None]) -> None:
    """Run ``awaitable`` to completion when this task is already cancelled.

    A second ``cancel()`` must not abandon the shielded task. Pending
    cancellation is cleared only so this wait can finish; the caller still
    propagates ``CancelledError``.
    """
    task = asyncio.ensure_future(awaitable)
    current = asyncio.current_task()
    while not task.done():
        if current is not None:
            while current.uncancel():
                pass
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            continue
    error = task.exception()
    if error is not None:
        raise error


async def _stop_stream(
    inflight: set[asyncio.Task[Any]],
    graph_iter: AsyncIterator[Any] | None,
    graph: Any | None,
    config: dict[str, Any] | None,
    *,
    repair_tool_calls: bool,
) -> None:
    for task in list(inflight):
        if not task.done():
            task.cancel()
    if inflight:
        await asyncio.gather(*inflight, return_exceptions=True)
    if graph_iter is not None:
        try:
            await graph_iter.aclose()
        except Exception:  # noqa: BLE001 — close failure must not hide a successful run
            if not repair_tool_calls:
                raise
            logger.exception("Failed to close graph stream after cancellation")
    if repair_tool_calls and graph is not None and config is not None:
        try:
            await _append_cancelled_tool_messages(graph, config)
        except Exception:  # noqa: BLE001 — cancellation must still propagate
            logger.exception("Failed to record cancelled tool calls")


async def stream_agent(
    message: str,
    *,
    tool_auth: ToolAuthContext,
    execution_config: AgentExecutionConfig,
    llm: BaseChatModel | None = None,
    checkpointer: Any | None = None,
    thread_id: str | None = None,
    outcome: StreamOutcome | None = None,
) -> AsyncIterator[StreamEvent]:
    """Stream one agent turn.

    Yields ``message.delta``, ``tool.start``, and ``tool.end``. On success the
    authoritative reply is stored on ``outcome`` and ``done`` is left to the
    caller. Failures yield ``error``. ``CancelledError`` closes the graph
    iterator and propagates without an error event. A cancel that leaves a
    tool call without a result writes ``Tool execution cancelled`` for each
    pending id so the next turn stays valid.

    ``tool_auth`` and ``execution_config`` are required. Config is an immutable
    snapshot — this function does not open a DB session. Callers must validate
    the snapshot before starting SSE so failures return HTTP 503.

    The caller must own this generator. Closing it from a second task while it
    is running is not supported; cancel the task that is iterating it.
    """
    if outcome is None:
        outcome = StreamOutcome()
    resolved_llm = llm
    if resolved_llm is None:
        resolved_llm = create_chat_model_for_agent(
            provider=execution_config.llm_provider,
            model=execution_config.llm_model,
            temperature=execution_config.temperature,
        )
    _require_checkpointer_for_thread(thread_id, checkpointer)

    settings = get_settings()
    execution_id = uuid.uuid4()
    outcome.execution_id = str(execution_id)
    outcome.failed = False
    outcome.message = None
    use_checkpointer = thread_id is not None
    collected: list[BaseMessage] = []
    deltas: dict[str, str] = {}
    graph_iter: AsyncIterator[Any] | None = None
    graph: Any | None = None
    config: dict[str, Any] | None = None
    repair_tool_calls = False
    inflight: set[asyncio.Task[Any]] = set()
    registry = create_default_registry()
    permitted = permitted_tool_names(registry, tool_auth)
    inflight_token = inflight_node_tasks.set(inflight)
    auth_token = set_tool_auth_context(tool_auth)
    try:
        try:
            graph = build_agent_graph(
                llm=resolved_llm,
                registry=registry,
                checkpointer=checkpointer if use_checkpointer else None,
                permitted_tools=permitted,
                system_prompt=execution_config.system_prompt,
            )
            config = build_run_config(
                settings,
                execution_id,
                thread_id=thread_id if use_checkpointer else None,
            )
            with langsmith_tracing(settings):
                graph_iter = graph.astream(
                    {"messages": [HumanMessage(content=message)]},
                    config=config,
                    stream_mode=["messages", "updates"],
                ).__aiter__()
                while True:
                    try:
                        item = await graph_iter.__anext__()
                    except StopAsyncIteration:
                        break
                    for event in _events_from_stream_item(
                        item,
                        outcome.execution_id,
                        collected,
                        deltas,
                    ):
                        yield event
            outcome.message = ChatMessageOut(
                role="assistant",
                content=extract_assistant_reply(collected),
            )
        except asyncio.CancelledError:
            repair_tool_calls = use_checkpointer
            raise
        except AgentNotConfiguredError as exc:
            outcome.failed = True
            yield StreamError(execution_id=outcome.execution_id, message=str(exc))
        except GraphRecursionError:
            outcome.failed = True
            yield StreamError(execution_id=outcome.execution_id, message=_RECURSION_MESSAGE)
        except Exception:  # noqa: BLE001 — map unexpected LLM/graph failures
            logger.exception(_EXECUTION_FAILED_MESSAGE)
            outcome.failed = True
            yield StreamError(
                execution_id=outcome.execution_id,
                message=_EXECUTION_FAILED_MESSAGE,
            )
        finally:
            try:
                await _await_despite_cancellation(
                    _stop_stream(
                        inflight,
                        graph_iter,
                        graph,
                        config,
                        repair_tool_calls=repair_tool_calls,
                    )
                )
            finally:
                inflight_node_tasks.reset(inflight_token)
    finally:
        reset_tool_auth_context(auth_token)
