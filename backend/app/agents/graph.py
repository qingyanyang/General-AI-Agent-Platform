"""LangGraph StateGraph: LLM node, ToolNode, and conditional routing."""

from __future__ import annotations

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.prebuilt import ToolNode, tools_condition

from app.agents.state import AgentState
from app.agents.tools import AGENT_TOOLS
from app.core.config import get_settings


def create_chat_model() -> ChatOpenAI:
    """Build an OpenAI-compatible chat model from settings."""
    settings = get_settings()
    if not settings.llm_api_key:
        raise ValueError("LLM_API_KEY is not configured")

    kwargs: dict[str, object] = {
        "model": settings.llm_model,
        "api_key": settings.llm_api_key,
    }
    if settings.llm_base_url:
        kwargs["base_url"] = settings.llm_base_url
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
