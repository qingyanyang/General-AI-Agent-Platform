"""Async agent execution with recursion limits and error mapping."""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langgraph.errors import GraphRecursionError

from app.agents.errors import AgentExecutionError, AgentNotConfiguredError
from app.agents.graph import build_agent_graph, inflight_node_tasks
from app.agents.messages import (
    extract_assistant_reply,
    message_content_text,
    normalize_message_views,
)
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

logger = logging.getLogger(__name__)

_RECURSION_MESSAGE = "Agent stopped: recursion limit exceeded (possible tool-calling loop)"
_EXECUTION_FAILED_MESSAGE = "Agent execution failed"


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
    llm: BaseChatModel | None = None,
    checkpointer: Any | None = None,
    thread_id: str | None = None,
) -> AgentResult:
    """Run the agent graph for a user message.

    Stateless path (``thread_id is None``): compile without a checkpointer.
    Durable path (``thread_id`` set): require ``checkpointer`` and compile with it.
    Each turn passes only the new ``HumanMessage``; checkpoint restore retains history.
    """
    settings = get_settings()
    if llm is None:
        ensure_llm_configured()

    if thread_id is not None and checkpointer is None:
        raise AgentNotConfiguredError(
            "Conversation persistence is not configured",
        )

    execution_id = uuid.uuid4()
    execution_id_text = str(execution_id)
    use_checkpointer = thread_id is not None
    try:
        graph = build_agent_graph(
            llm=llm,
            checkpointer=checkpointer if use_checkpointer else None,
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


async def stream_agent(
    message: str,
    *,
    llm: BaseChatModel | None = None,
    checkpointer: Any | None = None,
    thread_id: str | None = None,
    outcome: StreamOutcome | None = None,
) -> AsyncIterator[StreamEvent]:
    """Stream one agent turn.

    Yields ``message.delta``, ``tool.start``, and ``tool.end``. On success the
    authoritative reply is stored on ``outcome`` and ``done`` is left to the
    caller. Failures yield ``error``. ``CancelledError`` closes the graph
    iterator and propagates without an error event.

    The caller must own this generator. Closing it from a second task while it
    is running is not supported; cancel the task that is iterating it.
    """
    if outcome is None:
        outcome = StreamOutcome()
    if llm is None:
        ensure_llm_configured()
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
    inflight: set[asyncio.Task[Any]] = set()
    inflight_token = inflight_node_tasks.set(inflight)
    try:
        graph = build_agent_graph(
            llm=llm,
            checkpointer=checkpointer if use_checkpointer else None,
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
        for task in inflight:
            if not task.done():
                task.cancel()
        if inflight:
            await asyncio.gather(*inflight, return_exceptions=True)
        if graph_iter is not None:
            await graph_iter.aclose()
        inflight_node_tasks.reset(inflight_token)
