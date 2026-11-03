"""LangGraph StateGraph: LLM node, ToolNode, and conditional routing."""

from __future__ import annotations

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.prebuilt import ToolNode, tools_condition

from app.agents.errors import AgentNotConfiguredError
from app.agents.state import AgentState
from app.agents.tools import AGENT_TOOLS
from app.core.config import get_settings

DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_DEFAULT_MODEL = "deepseek-flash"
OPENAI_DEFAULT_MODEL = "gpt-4o-mini"


def create_chat_model() -> ChatOpenAI:
    """Build an OpenAI-compatible chat model from settings (OpenAI or DeepSeek)."""
    settings = get_settings()
    provider = settings.llm_provider.strip().lower()
    if provider not in {"openai", "deepseek"}:
        raise AgentNotConfiguredError(
            f"Unsupported LLM_PROVIDER '{settings.llm_provider}'; use 'openai' or 'deepseek'",
        )

    api_key = settings.resolve_llm_api_key()
    if not api_key:
        if provider == "deepseek":
            raise AgentNotConfiguredError(
                "LLM_API_KEY or DEEPSEEK_API_KEY is not configured",
            )
        raise AgentNotConfiguredError("LLM_API_KEY is not configured")

    model = settings.llm_model
    base_url = settings.llm_base_url
    kwargs: dict[str, object] = {
        "model": model,
        "api_key": api_key,
    }

    if provider == "deepseek":
        # Docs: https://api-docs.deepseek.com/ — OpenAI-compatible; tool calling supported.
        kwargs["base_url"] = base_url or DEEPSEEK_BASE_URL
        if model == OPENAI_DEFAULT_MODEL:
            kwargs["model"] = DEEPSEEK_DEFAULT_MODEL
        # Tool-calls guide disables thinking for reliable function calling.
        kwargs["extra_body"] = {"thinking": {"type": "disabled"}}
    elif base_url:
        kwargs["base_url"] = base_url

    return ChatOpenAI(**kwargs)


def build_agent_graph(*, llm: BaseChatModel | None = None) -> CompiledStateGraph:
    """Compile the agent graph (LLM ↔ tools with tools_condition)."""
    model = llm if llm is not None else create_chat_model()
    model_with_tools = model.bind_tools(AGENT_TOOLS)

    async def llm_node(state: AgentState) -> dict:
        response = await model_with_tools.ainvoke(state["messages"])
        return {"messages": [response]}

    graph = StateGraph(AgentState)
    graph.add_node("llm", llm_node)
    graph.add_node("tools", ToolNode(AGENT_TOOLS))
    graph.add_edge(START, "llm")
    graph.add_conditional_edges("llm", tools_condition, {"tools": "tools", END: END})
    graph.add_edge("tools", "llm")
    return graph.compile()

