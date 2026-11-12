"""Agent graph state schema."""

from typing import Any, NotRequired

from langgraph.graph import MessagesState


class AgentState(MessagesState):
    """Conversation state for the LangGraph agent (messages with add_messages)."""

    approval_batch: NotRequired[list[dict[str, Any]]]
