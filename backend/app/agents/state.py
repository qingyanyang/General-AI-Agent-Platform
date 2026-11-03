"""Agent graph state schema."""

from langgraph.graph import MessagesState


class AgentState(MessagesState):
    """Conversation state for the LangGraph agent (messages with add_messages)."""
