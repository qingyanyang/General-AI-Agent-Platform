"""Async agent execution with recursion limits and error mapping."""

from __future__ import annotations

from dataclasses import dataclass

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langgraph.errors import GraphRecursionError

from app.agents.errors import AgentExecutionError, AgentNotConfiguredError
from app.agents.graph import build_agent_graph
from app.core.config import get_settings


@dataclass(frozen=True)
class AgentMessageView:
    role: str
    content: str


@dataclass(frozen=True)
class AgentResult:
    reply: str
    messages: list[AgentMessageView]


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
) -> AgentResult:
    """Run the agent graph once for a user message."""
    settings = get_settings()
    if llm is None and not settings.llm_api_key:
        raise AgentNotConfiguredError(
            "LLM_API_KEY is not configured; cannot run the agent",
        )

    try:
        graph = build_agent_graph(llm=llm)
        result = await graph.ainvoke(
            {"messages": [HumanMessage(content=message)]},
            config={"recursion_limit": settings.agent_recursion_limit},
        )
    except AgentNotConfiguredError:
        raise
    except GraphRecursionError as exc:
        raise AgentExecutionError(
            "Agent stopped: recursion limit exceeded (possible tool-calling loop)",
        ) from exc
    except ValueError as exc:
        # create_chat_model raises ValueError when key missing
        raise AgentNotConfiguredError(str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 — map unexpected LLM/graph failures
        raise AgentExecutionError(f"Agent execution failed: {exc}") from exc

    messages = list(result.get("messages", []))
    return AgentResult(reply=_extract_reply(messages), messages=_normalize_messages(messages))
