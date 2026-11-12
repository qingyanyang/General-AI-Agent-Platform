"""Run one evaluation example on the agent graph."""

from __future__ import annotations

from typing import Any

from app.agents.graph import build_agent_graph, create_chat_model_for_agent
from app.agents.messages import extract_assistant_reply, message_content_text
from app.agents.tool_policy import (
    BUILTIN_REQUIRED_PERMISSIONS,
    ToolAuthContext,
    permitted_tool_names,
    reset_tool_auth_context,
    set_tool_auth_context,
)
from app.agents.tools.builtins import add, echo, multiply
from app.agents.tools.registry import ToolRegistry
from app.core.config import get_settings
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from evals.dataset import EvalExample
from evals.scripted import ScriptedChatModel


async def run_example(
    example: EvalExample,
    *,
    llm: Any | None = None,
) -> dict[str, Any]:
    """Execute one example. Tool authorization is always reset."""
    registry, counts, originals = _spy_registry()
    token = None
    try:
        model = llm if llm is not None else _model_for(example)
        context = _auth_context(example)
        graph = build_agent_graph(
            llm=model,
            registry=registry,
            checkpointer=None,
            permitted_tools=permitted_tool_names(registry, context),
            approval_tools=frozenset(),
            system_prompt="",
        )
        token = set_tool_auth_context(context)
        result = await graph.ainvoke(
            {
                "messages": [HumanMessage(content=str(example.inputs["message"]))],
                "approval_batch": [],
            }
        )
        messages = list(result.get("messages") or [])
        return {
            "reply": extract_assistant_reply(messages),
            "tool_messages": [
                {"name": str(message.name or ""), "content": message_content_text(message)}
                for message in messages
                if isinstance(message, ToolMessage)
            ],
            "body_counts": dict(counts),
        }
    finally:
        if token is not None:
            reset_tool_auth_context(token)
        for tool, func in originals:
            tool.func = func


def _model_for(example: EvalExample) -> Any:
    if example.split == "llm":
        settings = get_settings()
        return create_chat_model_for_agent(
            provider=settings.llm_provider,
            model=settings.llm_model,
            temperature=0,
        )
    return _scripted_model(example.inputs.get("script") or [])


def _scripted_model(script: object) -> ScriptedChatModel:
    if not isinstance(script, list):
        raise ValueError("deterministic example is missing a script")
    messages: list[AIMessage] = []
    for index, turn in enumerate(script):
        if not isinstance(turn, dict):
            raise ValueError(f"script turn {index} must be an object")
        if "tool" in turn:
            messages.append(
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": str(turn["tool"]),
                            "args": dict(turn.get("args") or {}),
                            "id": str(turn.get("id") or f"call_{index}"),
                            "type": "tool_call",
                        }
                    ],
                )
            )
            continue
        if "reply" in turn:
            messages.append(AIMessage(content=str(turn["reply"])))
            continue
        raise ValueError(f"script turn {index} needs tool or reply")
    return ScriptedChatModel(script=messages)


def _auth_context(example: EvalExample) -> ToolAuthContext:
    return ToolAuthContext(
        user_id="eval",
        permissions=frozenset(str(item) for item in example.inputs.get("permissions") or []),
        agent_id="eval",
        allowed_tools=frozenset(str(item) for item in example.inputs.get("allowed_tools") or []),
    )


def _spy_registry() -> tuple[ToolRegistry, dict[str, int], list[tuple[Any, Any]]]:
    registry = ToolRegistry()
    counts: dict[str, int] = {}
    originals: list[tuple[Any, Any]] = []
    try:
        for tool in (add, multiply, echo):
            registry.register(tool, required_permissions=BUILTIN_REQUIRED_PERMISSIONS)
            counts[tool.name] = 0
            originals.append((tool, tool.func))
            original = tool.func
            name = tool.name

            def wrapped(
                *args: Any,
                _name: str = name,
                _original: Any = original,
                **kwargs: Any,
            ) -> Any:
                counts[_name] += 1
                return _original(*args, **kwargs)

            tool.func = wrapped
    except Exception:
        for tool, func in originals:
            tool.func = func
        raise
    return registry, counts, originals
