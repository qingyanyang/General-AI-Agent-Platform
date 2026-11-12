"""Unit tests for LangGraph checkpointer wiring (InMemorySaver)."""

from __future__ import annotations

import asyncio
import uuid

import pytest
from app.agents.errors import AgentNotConfiguredError
from app.agents.runtime import run_agent
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.memory import InMemorySaver
from pytest import MonkeyPatch
from sqlalchemy.orm import Session

from tests.chat_helpers import default_execution_config, default_tool_auth, seed_agent_grant
from tests.fakes import ScriptedChatModel


def test_thread_id_for_session_is_uuid_string() -> None:
    from app.agents.checkpointer import thread_id_for_session

    session_id = uuid.uuid4()
    assert thread_id_for_session(session_id) == str(session_id)


def test_multi_turn_same_thread_retains_context() -> None:
    saver = InMemorySaver()
    thread_id = str(uuid.uuid4())
    llm = ScriptedChatModel(
        script=[
            AIMessage(content="Hello Alice"),
            AIMessage(content="You said your name is Alice"),
        ]
    )

    first = asyncio.run(
        run_agent(
            "My name is Alice",
            tool_auth=default_tool_auth(),
            execution_config=default_execution_config(),
            llm=llm,
            checkpointer=saver,
            thread_id=thread_id,
        ),
    )
    second = asyncio.run(
        run_agent(
            "What is my name?",
            tool_auth=default_tool_auth(),
            execution_config=default_execution_config(),
            llm=llm,
            checkpointer=saver,
            thread_id=thread_id,
        ),
    )

    assert first.reply == "Hello Alice"
    assert second.reply == "You said your name is Alice"
    user_messages = [m.content for m in second.messages if m.role == "user"]
    assert user_messages == ["My name is Alice", "What is my name?"]


def test_different_threads_are_isolated() -> None:
    saver = InMemorySaver()
    llm = ScriptedChatModel(
        script=[
            AIMessage(content="ok-a"),
            AIMessage(content="ok-b"),
            AIMessage(content="still-b-only"),
        ]
    )
    thread_a = "thread-a"
    thread_b = "thread-b"

    asyncio.run(
        run_agent(
            "A1",
            tool_auth=default_tool_auth(),
            execution_config=default_execution_config(),
            llm=llm,
            checkpointer=saver,
            thread_id=thread_a,
        )
    )
    asyncio.run(
        run_agent(
            "B1",
            tool_auth=default_tool_auth(),
            execution_config=default_execution_config(),
            llm=llm,
            checkpointer=saver,
            thread_id=thread_b,
        )
    )
    result_b = asyncio.run(
        run_agent(
            "B2",
            tool_auth=default_tool_auth(),
            execution_config=default_execution_config(),
            llm=llm,
            checkpointer=saver,
            thread_id=thread_b,
        ),
    )

    user_messages = [m.content for m in result_b.messages if m.role == "user"]
    assert user_messages == ["B1", "B2"]
    assert "A1" not in user_messages


def test_stateless_path_ignores_checkpointer() -> None:
    """No thread_id → compile without checkpointer; each call is independent."""
    saver = InMemorySaver()
    llm = ScriptedChatModel(
        script=[
            AIMessage(content="one"),
            AIMessage(content="two"),
        ]
    )

    first = asyncio.run(
        run_agent(
            "hi",
            tool_auth=default_tool_auth(),
            execution_config=default_execution_config(),
            llm=llm,
            checkpointer=saver,
        )
    )
    second = asyncio.run(
        run_agent(
            "again",
            tool_auth=default_tool_auth(),
            execution_config=default_execution_config(),
            llm=llm,
            checkpointer=saver,
        )
    )

    assert first.reply == "one"
    assert second.reply == "two"
    assert [m.content for m in second.messages if m.role == "user"] == ["again"]


def test_thread_id_without_checkpointer_raises() -> None:
    llm = ScriptedChatModel(script=[AIMessage(content="x")])
    with pytest.raises(AgentNotConfiguredError, match="persistence"):
        asyncio.run(
            run_agent(
                "hi",
                tool_auth=default_tool_auth(),
                execution_config=default_execution_config(),
                llm=llm,
                thread_id="t1",
                checkpointer=None,
            )
        )


def test_only_new_human_message_is_passed_each_turn(monkeypatch: MonkeyPatch) -> None:
    """Checkpoint restore retains history; invoke input is a single HumanMessage."""
    from app.agents import runtime as runtime_mod

    captured: list[list] = []
    original_build = runtime_mod.build_agent_graph

    def tracking_build(**kwargs):
        graph = original_build(**kwargs)
        original_ainvoke = graph.ainvoke

        async def wrapped_ainvoke(input_data, config=None, **kwargs):
            captured.append(list(input_data.get("messages", [])))
            return await original_ainvoke(input_data, config=config, **kwargs)

        graph.ainvoke = wrapped_ainvoke  # type: ignore[method-assign]
        return graph

    monkeypatch.setattr(runtime_mod, "build_agent_graph", tracking_build)

    saver = InMemorySaver()
    thread_id = "track-thread"
    llm = ScriptedChatModel(
        script=[AIMessage(content="r1"), AIMessage(content="r2")],
    )
    asyncio.run(
        run_agent(
            "first",
            tool_auth=default_tool_auth(),
            execution_config=default_execution_config(),
            llm=llm,
            checkpointer=saver,
            thread_id=thread_id,
        )
    )
    asyncio.run(
        run_agent(
            "second",
            tool_auth=default_tool_auth(),
            execution_config=default_execution_config(),
            llm=llm,
            checkpointer=saver,
            thread_id=thread_id,
        )
    )

    assert len(captured) == 2
    assert len(captured[0]) == 1 and isinstance(captured[0][0], HumanMessage)
    assert captured[0][0].content == "first"
    assert len(captured[1]) == 1 and isinstance(captured[1][0], HumanMessage)
    assert captured[1][0].content == "second"


def test_agents_run_session_without_credentials_returns_401(
    api_client: TestClient,
) -> None:
    """Authentication runs before the checkpointer availability check."""
    response = api_client.post(
        "/agents/run",
        json={"message": "hello", "session_id": str(uuid.uuid4())},
    )
    assert response.status_code == 422


def test_agents_run_session_without_checkpointer_returns_503_after_auth(
    api_client: TestClient,
) -> None:
    """With identity present, a missing checkpointer still returns 503."""
    response = api_client.post(
        "/agents/run",
        json={"message": "hello", "session_id": str(uuid.uuid4())},
        headers={"X-User-Id": "owner"},
    )
    assert response.status_code == 503
    assert "persistence" in response.json()["detail"].lower()


def test_agents_run_session_other_user_returns_404(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    from langgraph.checkpoint.memory import InMemorySaver

    api_client.app.state.checkpointer = InMemorySaver()
    seed_agent_grant(db_session, "owner")

    async def fake_run(message: str, **kwargs):
        from app.agents.runtime import AgentMessageView, AgentResult

        return AgentResult(
            reply="ok",
            execution_id=str(uuid.uuid4()),
            messages=[AgentMessageView(role="assistant", content="ok")],
        )

    monkeypatch.setattr("app.api.routes.agents.run_agent", fake_run)

    created = api_client.post(
        "/sessions",
        json={"agent_id": "default"},
        headers={"X-User-Id": "owner"},
    ).json()

    response = api_client.post(
        "/agents/run",
        json={"message": "hi", "session_id": created["id"]},
        headers={"X-User-Id": "intruder"},
    )
    assert response.status_code == 404


def test_agents_run_session_archived_returns_404(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    from langgraph.checkpoint.memory import InMemorySaver

    api_client.app.state.checkpointer = InMemorySaver()
    seed_agent_grant(db_session, "owner")

    async def fake_run(message: str, **kwargs):
        from app.agents.runtime import AgentMessageView, AgentResult

        return AgentResult(
            reply="ok",
            execution_id=str(uuid.uuid4()),
            messages=[AgentMessageView(role="assistant", content="ok")],
        )

    monkeypatch.setattr("app.api.routes.agents.run_agent", fake_run)

    created = api_client.post(
        "/sessions",
        json={"agent_id": "default"},
        headers={"X-User-Id": "owner"},
    ).json()
    api_client.delete(f"/sessions/{created['id']}", headers={"X-User-Id": "owner"})

    response = api_client.post(
        "/agents/run",
        json={"message": "hi", "session_id": created["id"]},
        headers={"X-User-Id": "owner"},
    )
    assert response.status_code == 404


def test_agents_run_owned_session_passes_derived_thread_id(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    from langgraph.checkpoint.memory import InMemorySaver

    api_client.app.state.checkpointer = InMemorySaver()
    seed_agent_grant(db_session, "owner")
    captured: dict = {}

    async def fake_run(message: str, **kwargs):
        from app.agents.runtime import AgentMessageView, AgentResult

        captured.update(kwargs)
        return AgentResult(
            reply="ok",
            execution_id=str(uuid.uuid4()),
            messages=[AgentMessageView(role="assistant", content="ok")],
        )

    monkeypatch.setattr("app.api.routes.agents.run_agent", fake_run)

    created = api_client.post(
        "/sessions",
        json={"agent_id": "default"},
        headers={"X-User-Id": "owner"},
    ).json()

    response = api_client.post(
        "/agents/run",
        json={"message": "hi", "session_id": created["id"]},
        headers={"X-User-Id": "owner"},
    )
    assert response.status_code == 200
    assert captured.get("thread_id") == created["id"]
    assert captured.get("checkpointer") is api_client.app.state.checkpointer


def test_quote_ident_rejects_injection() -> None:
    from app.agents.checkpointer import quote_ident

    with pytest.raises(ValueError):
        quote_ident('langgraph"; drop table checkpoints;--')
    assert quote_ident("langgraph") == '"langgraph"'


def test_psycopg_conninfo_strips_driver() -> None:
    from app.agents.checkpointer import psycopg_conninfo

    assert (
        psycopg_conninfo("postgresql+psycopg://u:p@localhost/db") == "postgresql://u:p@localhost/db"
    )


def test_build_agent_graph_caches_default_llm_path(monkeypatch: MonkeyPatch) -> None:
    from app.agents.graph import build_agent_graph, clear_agent_graph_cache

    clear_agent_graph_cache()
    monkeypatch.setattr(
        "app.agents.graph.create_chat_model",
        lambda: ScriptedChatModel(script=[AIMessage(content="cached")]),
    )

    stateless_a = build_agent_graph()
    stateless_b = build_agent_graph()
    assert stateless_a is stateless_b

    saver = InMemorySaver()
    durable_a = build_agent_graph(checkpointer=saver)
    durable_b = build_agent_graph(checkpointer=saver)
    assert durable_a is durable_b
    assert durable_a is not stateless_a

    injected_a = build_agent_graph(llm=ScriptedChatModel(script=[]))
    injected_b = build_agent_graph(llm=ScriptedChatModel(script=[]))
    assert injected_a is not injected_b
