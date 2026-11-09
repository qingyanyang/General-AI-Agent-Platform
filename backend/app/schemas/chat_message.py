"""Chat message API schemas."""

from __future__ import annotations

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
