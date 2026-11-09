"""Session chat messages via LangGraph checkpoints (no ORM message table)."""

from __future__ import annotations

import uuid
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import BaseMessage
from langgraph.checkpoint.base import BaseCheckpointSaver

from app.agents.checkpointer import thread_id_for_session
from app.agents.messages import normalize_message_views
from app.agents.runtime import run_agent
from app.schemas.chat_message import ChatMessageOut


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
    llm: BaseChatModel | None = None,
) -> tuple[str, ChatMessageOut]:
    """Run a durable agent turn for the session; return execution_id and assistant message."""
    thread_id = thread_id_for_session(session_id)
    result = await run_agent(
        content,
        llm=llm,
        checkpointer=checkpointer,
        thread_id=thread_id,
    )
    return result.execution_id, ChatMessageOut(role="assistant", content=result.reply)
