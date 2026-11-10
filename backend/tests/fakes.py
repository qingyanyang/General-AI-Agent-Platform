"""Test doubles for the agent runtime (no live LLM)."""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage
from langchain_core.messages.tool import tool_call_chunk
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from pydantic import Field, PrivateAttr


class ScriptedChatModel(BaseChatModel):
    """Returns a fixed sequence of AIMessages; bind_tools is a no-op."""

    script: list[AIMessage] = Field(default_factory=list)
    _call_index: int = PrivateAttr(default=0)

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def bind_tools(self, tools: Any, **kwargs: Any) -> ScriptedChatModel:
        return self

    def _next_message(self) -> AIMessage:
        if self._call_index >= len(self.script):
            raise RuntimeError("ScriptedChatModel script exhausted")
        message = self.script[self._call_index]
        self._call_index += 1
        return message

    def _stream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> Iterator[ChatGenerationChunk]:
        message = self._next_message()
        for chunk in _message_chunks(message):
            yield ChatGenerationChunk(message=chunk)

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        return ChatResult(generations=[ChatGeneration(message=self._next_message())])

    async def _agenerate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        return self._generate(messages, stop=stop, run_manager=run_manager, **kwargs)


def _message_chunks(message: AIMessage) -> list[AIMessageChunk]:
    """Split one scripted message into text pieces and tool-argument pieces."""
    chunks: list[AIMessageChunk] = []
    content = message.content
    if isinstance(content, str) and content:
        midpoint = max(1, len(content) // 2)
        parts = [content[:midpoint], content[midpoint:]]
        chunks.extend(AIMessageChunk(content=part) for part in parts if part)
    elif content:
        chunks.append(AIMessageChunk(content=content))

    for index, call in enumerate(message.tool_calls):
        args = json.dumps(call.get("args") or {})
        midpoint = max(1, len(args) // 2)
        arg_parts = [args[:midpoint], args[midpoint:]]
        first = True
        for part in arg_parts:
            if not part:
                continue
            chunks.append(
                AIMessageChunk(
                    content="",
                    tool_call_chunks=[
                        tool_call_chunk(
                            name=str(call.get("name") or "") if first else None,
                            args=part,
                            id=str(call.get("id") or "") if first else None,
                            index=index,
                        )
                    ],
                )
            )
            first = False
    if not chunks:
        chunks.append(AIMessageChunk(content=""))
    return chunks
