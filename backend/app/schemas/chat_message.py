"""Chat message API schemas."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

MESSAGE_CONTENT_MAX_LENGTH = 32_000


class ChatMessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=MESSAGE_CONTENT_MAX_LENGTH)

    @field_validator("content")
    @classmethod
    def normalize_content(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("content must be a non-empty string")
        if len(stripped) > MESSAGE_CONTENT_MAX_LENGTH:
            raise ValueError(
                f"content must be at most {MESSAGE_CONTENT_MAX_LENGTH} characters",
            )
        # Ends trimmed; internal whitespace/newlines preserved.
        return stripped


class ChatMessageOut(BaseModel):
    role: str
    content: str


class ChatMessageListOut(BaseModel):
    items: list[ChatMessageOut]


class ChatMessageCreateResult(BaseModel):
    execution_id: str
    message: ChatMessageOut


class StreamMessageDelta(BaseModel):
    """Assistant text emitted during the run.

    Deltas include any text the model produces before it requests a tool.
    Concatenated deltas are not the final reply; see ``StreamDone``.
    """

    type: Literal["message.delta"] = "message.delta"
    execution_id: str
    content: str


class StreamToolStart(BaseModel):
    """The model requested a tool.

    Validation or authorization inside the tools node may still prevent execution.
    """

    type: Literal["tool.start"] = "tool.start"
    execution_id: str
    tool_call_id: str
    name: str


class StreamToolEnd(BaseModel):
    """One tool result, including validation and execution errors in ``content``."""

    type: Literal["tool.end"] = "tool.end"
    execution_id: str
    tool_call_id: str
    name: str
    content: str


class StreamDone(BaseModel):
    """Authoritative final assistant reply for the turn."""

    type: Literal["done"] = "done"
    execution_id: str
    message: ChatMessageOut


class StreamApprovalRequired(BaseModel):
    """The run paused before a gated tool. The stream ends without ``done`` or ``error``."""

    type: Literal["approval.required"] = "approval.required"
    execution_id: str
    interrupt_id: str
    checkpoint_id: str
    tool_call_id: str
    tool_name: str
    arguments: dict[str, object]


class StreamError(BaseModel):
    """Graph or model failure. Client cancellation does not use this event."""

    type: Literal["error"] = "error"
    execution_id: str
    message: str


StreamEvent = (
    StreamMessageDelta
    | StreamToolStart
    | StreamToolEnd
    | StreamApprovalRequired
    | StreamDone
    | StreamError
)


def format_sse(event: StreamEvent) -> str:
    """Encode one SSE frame. ``event`` matches the JSON ``type``."""
    return f"event: {event.type}\ndata: {event.model_dump_json()}\n\n"
