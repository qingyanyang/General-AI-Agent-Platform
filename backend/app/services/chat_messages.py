"""Session chat messages via LangGraph checkpoints (no ORM message table)."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import BaseMessage
from langgraph.checkpoint.base import BaseCheckpointSaver

from app.agents.checkpointer import thread_id_for_session
from app.agents.messages import normalize_message_views
from app.agents.runtime import AgentResult, StreamOutcome, run_agent, stream_agent
from app.agents.tool_policy import ToolAuthContext
from app.schemas.chat_message import ChatMessageOut, StreamEvent
from app.services.agents import AgentExecutionConfig


def _messages_from_checkpoint(checkpoint: dict[str, Any] | None) -> list[BaseMessage]:
    if not checkpoint:
        return []
    channel_values = checkpoint.get("channel_values") or {}
    raw = channel_values.get("messages") or []
    return [item for item in raw if isinstance(item, BaseMessage)]


async def load_session_messages(
    *,
    checkpointer: BaseCheckpointSaver,
    thread_id: str,
) -> list[ChatMessageOut]:
    """Load conversation history from the checkpointer without initializing an LLM."""
    config = {"configurable": {"thread_id": thread_id}}
    checkpoint_tuple = await checkpointer.aget_tuple(config)
    if checkpoint_tuple is None:
        return []
    messages = _messages_from_checkpoint(checkpoint_tuple.checkpoint)
    return [
        ChatMessageOut(role=role, content=content)
        for role, content in normalize_message_views(messages)
    ]


async def post_user_message(
    *,
    content: str,
    checkpointer: BaseCheckpointSaver,
    session_id: uuid.UUID,
    tool_auth: ToolAuthContext,
    execution_config: AgentExecutionConfig,
    llm: BaseChatModel | None = None,
    execution_id: uuid.UUID | None = None,
) -> AgentResult:
    """Run a durable agent turn for the session."""
    thread_id = thread_id_for_session(session_id)
    return await run_agent(
        content,
        tool_auth=tool_auth,
        execution_config=execution_config,
        llm=llm,
        checkpointer=checkpointer,
        thread_id=thread_id,
        execution_id=execution_id,
    )


async def stream_user_message(
    *,
    content: str,
    checkpointer: BaseCheckpointSaver,
    session_id: uuid.UUID,
    tool_auth: ToolAuthContext,
    execution_config: AgentExecutionConfig,
    outcome: StreamOutcome,
    llm: BaseChatModel | None = None,
    execution_id: uuid.UUID | None = None,
) -> AsyncIterator[StreamEvent]:
    """Stream a durable turn. The caller emits ``done`` after a successful outcome."""
    thread_id = thread_id_for_session(session_id)
    async for event in stream_agent(
        content,
        tool_auth=tool_auth,
        execution_config=execution_config,
        llm=llm,
        checkpointer=checkpointer,
        thread_id=thread_id,
        outcome=outcome,
        execution_id=execution_id,
    ):
        yield event
