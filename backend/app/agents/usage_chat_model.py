"""Keep field presence at the pinned ChatOpenAI Chat Completions boundary."""

from __future__ import annotations

import openai
from langchain_core.outputs import ChatGenerationChunk, ChatResult
from langchain_openai import ChatOpenAI

from app.agents.usage import observe_provider_response


class UsageChatOpenAI(ChatOpenAI):
    def _convert_chunk_to_generation_chunk(
        self,
        chunk: dict,
        default_chunk_class: type,
        base_generation_info: dict | None,
    ) -> ChatGenerationChunk | None:
        observe_provider_response(chunk)
        return super()._convert_chunk_to_generation_chunk(
            chunk,
            default_chunk_class,
            base_generation_info,
        )

    def _create_chat_result(
        self,
        response: dict | openai.BaseModel,
        generation_info: dict | None = None,
    ) -> ChatResult:
        if isinstance(response, dict):
            observe_provider_response(response)
        elif isinstance(response, openai.BaseModel):
            observe_provider_response(
                {
                    "id": getattr(response, "id", None),
                    "model": getattr(response, "model", None),
                    "service_tier": getattr(response, "service_tier", None),
                    "usage": (
                        usage.model_dump(exclude_unset=True)
                        if isinstance(usage := getattr(response, "usage", None), openai.BaseModel)
                        else usage
                    ),
                }
            )
        return super()._create_chat_result(response, generation_info)
