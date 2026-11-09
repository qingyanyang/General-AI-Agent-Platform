"""Public helpers for LangChain message role/content normalization."""

from __future__ import annotations

from langchain_core.messages import AIMessage, BaseMessage


def message_role(message: BaseMessage) -> str:
    """Map LangChain message types to frontend-facing roles."""
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


def message_content_text(message: BaseMessage) -> str:
    """Flatten message content to text without exposing raw Python reprs.

    - ``str`` content is returned as-is (formatting preserved).
    - ``list`` content concatenates string parts and ``{"type":"text","text":...}``
      blocks only; other block shapes are skipped.
    - Other content types yield an empty string.
    """
    content = message.content
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict) and item.get("type") == "text":
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "".join(parts)
    return ""


def normalize_message_views(
    messages: list[BaseMessage],
) -> list[tuple[str, str]]:
    """Return ``(role, content)`` pairs for a message list."""
    return [(message_role(message), message_content_text(message)) for message in messages]


def extract_assistant_reply(messages: list[BaseMessage]) -> str:
    """Last non-tool-call AI message text, or empty string."""
    for message in reversed(messages):
        if isinstance(message, AIMessage) and not message.tool_calls:
            text = message_content_text(message)
            if text:
                return text
    return ""
