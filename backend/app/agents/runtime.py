"""Async agent execution with recursion limits and error mapping."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langgraph.errors import GraphRecursionError

from app.agents.errors import AgentExecutionError, AgentNotConfiguredError
from app.agents.graph import build_agent_graph
from app.agents.tracing import build_run_config, langsmith_tracing
from app.core.config import get_settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AgentMessageView:
    role: str
    content: str


@dataclass(frozen=True)
class AgentResult:
    reply: str
    messages: list[AgentMessageView]
    execution_id: str


def _message_role(message: BaseMessage) -> str:
    type_name = message.type
    if type_name == "human":
        return "user"
    if type_name == "ai":
        return "assistant"
    if type_name == "tool":
        return "tool"
    if type_name == "system":
        return "system"
    return type_name


def _message_content(message: BaseMessage) -> str:
    content = message.content
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text", "")))
        return "".join(parts)
    return str(content)


def _normalize_messages(messages: list[BaseMessage]) -> list[AgentMessageView]:
    return [
        AgentMessageView(role=_message_role(message), content=_message_content(message))
        for message in messages
    ]


def _extract_reply(messages: list[BaseMessage]) -> str:
    for message in reversed(messages):
        if isinstance(message, AIMessage) and not message.tool_calls:
            text = _message_content(message)
            if text:
                return text
    return ""


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
    if llm is None and not settings.resolve_llm_api_key():
        raise AgentNotConfiguredError(
            "LLM API key is not configured; cannot run the agent",
        )

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
            "Agent stopped: recursion limit exceeded (possible tool-calling loop)",
            execution_id=execution_id_text,
        ) from exc
    except Exception as exc:  # noqa: BLE001 — map unexpected LLM/graph failures
        logger.exception("Agent execution failed")
        raise AgentExecutionError(
            "Agent execution failed",
            execution_id=execution_id_text,
        ) from exc

    messages = list(result.get("messages", []))
    return AgentResult(
        reply=_extract_reply(messages),
        messages=_normalize_messages(messages),
        execution_id=execution_id_text,
    )
