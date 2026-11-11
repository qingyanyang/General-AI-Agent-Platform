"""PostgreSQL checkpointer integration tests.

Requires CHECKPOINT_TEST_DATABASE_URL (dedicated DB). Skipped when unset — never
falls back to the application DATABASE_URL.
"""

from __future__ import annotations

import asyncio
import uuid

import pytest
from app.agents.checkpointer import close_checkpointer, open_checkpointer, psycopg_conninfo
from app.agents.graph import build_agent_graph
from app.agents.runtime import run_agent
from app.core.config import Settings
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from tests.chat_helpers import default_tool_auth
from tests.conftest import checkpoint_test_database_url
from tests.fakes import ScriptedChatModel

pytestmark = pytest.mark.integration


def _require_url() -> str:
    url = checkpoint_test_database_url()
    if not url:
        pytest.skip("CHECKPOINT_TEST_DATABASE_URL not set")
    return url


def _settings(url: str) -> Settings:
    return Settings(
        _env_file=None,
        database_url=url,
        checkpoints_schema="langgraph_test",
    )


def test_postgres_multi_turn_and_isolation() -> None:
    url = _require_url()

    async def _run() -> None:
        settings = _settings(url)
        pool, saver = await open_checkpointer(settings)
        try:
            llm = ScriptedChatModel(
                script=[
                    AIMessage(content="hello-a"),
                    AIMessage(content="hello-b"),
                    AIMessage(content="again-a"),
                ]
            )
            thread_a = str(uuid.uuid4())
            thread_b = str(uuid.uuid4())

            await run_agent(
                "A1", tool_auth=default_tool_auth(), llm=llm, checkpointer=saver, thread_id=thread_a
            )
            await run_agent(
                "B1", tool_auth=default_tool_auth(), llm=llm, checkpointer=saver, thread_id=thread_b
            )
            again_a = await run_agent(
                "A2",
                tool_auth=default_tool_auth(),
                llm=llm,
                checkpointer=saver,
                thread_id=thread_a,
            )

            users = [m.content for m in again_a.messages if m.role == "user"]
            assert users == ["A1", "A2"]
            assert "B1" not in users
        finally:
            await close_checkpointer(pool)

    asyncio.run(_run())


def test_postgres_restart_recreates_pool_saver_and_graph() -> None:
    """Restart recovery: new pool + saver + compiled graph continues the thread.

    This is continuing from persisted state after restart — not resuming an
    interrupted HTTP request.
    """
    url = _require_url()

    async def _run() -> None:
        settings = _settings(url)
        thread_id = str(uuid.uuid4())

        pool1, saver1 = await open_checkpointer(settings)
        try:
            llm1 = ScriptedChatModel(script=[AIMessage(content="turn-1")])
            graph1 = build_agent_graph(llm=llm1, checkpointer=saver1)
            await graph1.ainvoke(
                {"messages": [HumanMessage(content="remember me")]},
                config={"configurable": {"thread_id": thread_id}},
            )
        finally:
            await close_checkpointer(pool1)

        pool2, saver2 = await open_checkpointer(settings)
        try:
            assert isinstance(saver2, AsyncPostgresSaver)
            llm2 = ScriptedChatModel(script=[AIMessage(content="welcome-back")])
            graph2 = build_agent_graph(llm=llm2, checkpointer=saver2)
            result = await graph2.ainvoke(
                {"messages": [HumanMessage(content="who am I talking to?")]},
                config={"configurable": {"thread_id": thread_id}},
            )
            messages = list(result.get("messages", []))
            human = [m.content for m in messages if isinstance(m, HumanMessage)]
            assert human == ["remember me", "who am I talking to?"]
            assert any(isinstance(m, AIMessage) and m.content == "welcome-back" for m in messages)
        finally:
            await close_checkpointer(pool2)

    asyncio.run(_run())


def test_psycopg_conninfo_helper_used_by_open() -> None:
    url = _require_url()
    converted = psycopg_conninfo(url)
    assert converted.startswith("postgresql://") or converted.startswith("postgres://")
