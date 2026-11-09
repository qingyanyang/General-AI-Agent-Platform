"""Chat message API: ownership, validation, checkpoint history."""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime

from app.agents.errors import AgentExecutionError, AgentNotConfiguredError
from app.agents.messages import message_content_text, message_role
from app.agents.runtime import run_agent
from app.core.config import get_settings
from app.schemas.chat_message import MESSAGE_CONTENT_MAX_LENGTH, ChatMessageOut
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.memory import InMemorySaver
from pytest import MonkeyPatch

from tests.fakes import ScriptedChatModel

USER = "owner"
OTHER = "intruder"


def _headers(user_id: str = USER) -> dict[str, str]:
    return {"X-User-Id": user_id}


def _create_session(api_client: TestClient, *, user_id: str = USER) -> dict:
    response = api_client.post(
        "/sessions",
        json={"agent_id": "default"},
        headers=_headers(user_id),
    )
    assert response.status_code == 201
    return response.json()


def _with_saver(api_client: TestClient) -> InMemorySaver:
    saver = InMemorySaver()
    api_client.app.state.checkpointer = saver
    return saver


def test_message_role_and_content_normalization() -> None:
    human = HumanMessage(content="plain")
    assert message_role(human) == "user"
    assert message_content_text(human) == "plain"

    structured = AIMessage(
        content=[
            {"type": "text", "text": "Hello"},
            {"type": "image_url", "image_url": {"url": "x"}},
            " world",
        ]
    )
    assert message_role(structured) == "assistant"
    assert message_content_text(structured) == "Hello world"
    assert "dict" not in message_content_text(structured)

    class _Weird:
        content = {"not": "list"}

    assert message_content_text(_Weird()) == ""  # type: ignore[arg-type]


def test_post_missing_user_header_returns_422(api_client: TestClient) -> None:
    created = _create_session(api_client)
    _with_saver(api_client)
    response = api_client.post(
        f"/sessions/{created['id']}/messages",
        json={"content": "hi"},
    )
    assert response.status_code == 422


def test_post_blank_content_returns_422(api_client: TestClient) -> None:
    created = _create_session(api_client)
    _with_saver(api_client)
    response = api_client.post(
        f"/sessions/{created['id']}/messages",
        json={"content": "   \n\t  "},
        headers=_headers(),
    )
    assert response.status_code == 422


def test_post_oversized_content_returns_422(api_client: TestClient) -> None:
    created = _create_session(api_client)
    _with_saver(api_client)
    response = api_client.post(
        f"/sessions/{created['id']}/messages",
        json={"content": "x" * (MESSAGE_CONTENT_MAX_LENGTH + 1)},
        headers=_headers(),
    )
    assert response.status_code == 422


def test_post_preserves_internal_formatting(
    api_client: TestClient,
    monkeypatch: MonkeyPatch,
) -> None:
    created = _create_session(api_client)
    _with_saver(api_client)
    captured: dict = {}

    async def fake_post(*, content: str, **kwargs):
        captured["content"] = content
        return "exec-1", ChatMessageOut(role="assistant", content="ok")

    monkeypatch.setattr(
        "app.api.routes.sessions.message_service.post_user_message",
        fake_post,
    )
    body = "line1\n\n  indented\nline3"
    response = api_client.post(
        f"/sessions/{created['id']}/messages",
        json={"content": f"  {body}  "},
        headers=_headers(),
    )
    assert response.status_code == 200
    assert captured["content"] == body


def test_post_without_checkpointer_returns_503(api_client: TestClient) -> None:
    created = _create_session(api_client)
    api_client.app.state.checkpointer = None
    response = api_client.post(
        f"/sessions/{created['id']}/messages",
        json={"content": "hi"},
        headers=_headers(),
    )
    assert response.status_code == 503
    assert "persistence" in response.json()["detail"].lower()


def test_get_without_checkpointer_returns_503(api_client: TestClient) -> None:
    created = _create_session(api_client)
    api_client.app.state.checkpointer = None
    response = api_client.get(
        f"/sessions/{created['id']}/messages",
        headers=_headers(),
    )
    assert response.status_code == 503


def test_post_other_user_returns_404(api_client: TestClient) -> None:
    created = _create_session(api_client)
    _with_saver(api_client)
    response = api_client.post(
        f"/sessions/{created['id']}/messages",
        json={"content": "hi"},
        headers=_headers(OTHER),
    )
    assert response.status_code == 404


def test_get_archived_returns_404(api_client: TestClient) -> None:
    created = _create_session(api_client)
    _with_saver(api_client)
    api_client.delete(f"/sessions/{created['id']}", headers=_headers())
    response = api_client.get(
        f"/sessions/{created['id']}/messages",
        headers=_headers(),
    )
    assert response.status_code == 404


def test_get_unknown_session_returns_404(api_client: TestClient) -> None:
    _with_saver(api_client)
    response = api_client.get(
        f"/sessions/{uuid.uuid4()}/messages",
        headers=_headers(),
    )
    assert response.status_code == 404


def test_get_empty_history(api_client: TestClient) -> None:
    created = _create_session(api_client)
    _with_saver(api_client)
    response = api_client.get(
        f"/sessions/{created['id']}/messages",
        headers=_headers(),
    )
    assert response.status_code == 200
    assert response.json() == {"items": []}


def test_get_history_without_llm_api_key(
    api_client: TestClient,
    monkeypatch: MonkeyPatch,
) -> None:
    created = _create_session(api_client)
    saver = _with_saver(api_client)
    thread_id = created["id"]
    llm = ScriptedChatModel(script=[AIMessage(content="seeded")])
    asyncio.run(
        run_agent(
            "seed",
            llm=llm,
            checkpointer=saver,
            thread_id=thread_id,
        )
    )

    monkeypatch.setenv("LLM_API_KEY", "")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "")
    get_settings.cache_clear()

    response = api_client.get(
        f"/sessions/{created['id']}/messages",
        headers=_headers(),
    )
    assert response.status_code == 200
    items = response.json()["items"]
    assert [item["role"] for item in items] == ["user", "assistant"]
    assert items[0]["content"] == "seed"
    assert items[1]["content"] == "seeded"


def test_multi_turn_post_and_get(
    api_client: TestClient,
    monkeypatch: MonkeyPatch,
) -> None:
    created = _create_session(api_client)
    saver = _with_saver(api_client)
    llm = ScriptedChatModel(
        script=[
            AIMessage(content="Hello Alice"),
            AIMessage(content="Your name is Alice"),
        ]
    )

    async def run_with_llm(message: str, **kwargs):
        kwargs["llm"] = llm
        kwargs["checkpointer"] = saver
        return await run_agent(message, **kwargs)

    monkeypatch.setattr("app.services.chat_messages.run_agent", run_with_llm)

    first = api_client.post(
        f"/sessions/{created['id']}/messages",
        json={"content": "My name is Alice"},
        headers=_headers(),
    )
    assert first.status_code == 200
    assert first.json()["message"]["role"] == "assistant"
    assert first.json()["message"]["content"] == "Hello Alice"
    assert first.json()["execution_id"]

    second = api_client.post(
        f"/sessions/{created['id']}/messages",
        json={"content": "What is my name?"},
        headers=_headers(),
    )
    assert second.status_code == 200
    assert second.json()["message"]["content"] == "Your name is Alice"

    history = api_client.get(
        f"/sessions/{created['id']}/messages",
        headers=_headers(),
    ).json()["items"]
    users = [item["content"] for item in history if item["role"] == "user"]
    assert users == ["My name is Alice", "What is my name?"]


def test_checkpoint_residue_after_failed_run(
    api_client: TestClient,
    monkeypatch: MonkeyPatch,
) -> None:
    created = _create_session(api_client)
    saver = _with_saver(api_client)

    class Boom(ScriptedChatModel):
        def _next_message(self) -> AIMessage:
            raise RuntimeError("upstream boom")

    async def run_with_boom(message: str, **kwargs):
        kwargs["llm"] = Boom(script=[])
        kwargs["checkpointer"] = saver
        return await run_agent(message, **kwargs)

    monkeypatch.setattr("app.services.chat_messages.run_agent", run_with_boom)

    response = api_client.post(
        f"/sessions/{created['id']}/messages",
        json={"content": "please persist"},
        headers=_headers(),
    )
    assert response.status_code == 502

    history = api_client.get(
        f"/sessions/{created['id']}/messages",
        headers=_headers(),
    )
    assert history.status_code == 200
    items = history.json()["items"]
    assert any(item["role"] == "user" and item["content"] == "please persist" for item in items)


def test_post_bumps_last_activity(
    api_client: TestClient,
    monkeypatch: MonkeyPatch,
) -> None:
    created = _create_session(api_client)
    _with_saver(api_client)
    before = datetime.fromisoformat(created["last_activity_at"])

    async def fake_post(**kwargs):
        from app.schemas.chat_message import ChatMessageOut

        return str(uuid.uuid4()), ChatMessageOut(role="assistant", content="ok")

    monkeypatch.setattr(
        "app.api.routes.sessions.message_service.post_user_message",
        fake_post,
    )
    response = api_client.post(
        f"/sessions/{created['id']}/messages",
        json={"content": "hi"},
        headers=_headers(),
    )
    assert response.status_code == 200
    session = api_client.get(
        f"/sessions/{created['id']}",
        headers=_headers(),
    ).json()
    after = datetime.fromisoformat(session["last_activity_at"])
    assert after >= before


def test_touch_failure_still_returns_200(
    api_client: TestClient,
    monkeypatch: MonkeyPatch,
) -> None:
    created = _create_session(api_client)
    _with_saver(api_client)

    async def fake_post(**kwargs):
        from app.schemas.chat_message import ChatMessageOut

        return str(uuid.uuid4()), ChatMessageOut(role="assistant", content="ok")

    def boom_touch(db, session) -> None:
        raise RuntimeError("db write failed")

    monkeypatch.setattr(
        "app.api.routes.sessions.message_service.post_user_message",
        fake_post,
    )
    monkeypatch.setattr(
        "app.api.routes.sessions.session_service.touch_last_activity",
        boom_touch,
    )
    response = api_client.post(
        f"/sessions/{created['id']}/messages",
        json={"content": "hi"},
        headers=_headers(),
    )
    assert response.status_code == 200
    assert response.json()["message"]["content"] == "ok"


def test_post_missing_llm_after_ownership_returns_503(
    api_client: TestClient,
    monkeypatch: MonkeyPatch,
) -> None:
    created = _create_session(api_client)
    _with_saver(api_client)

    async def raise_not_configured(**kwargs):
        raise AgentNotConfiguredError("LLM API key is not configured; cannot run the agent")

    monkeypatch.setattr(
        "app.api.routes.sessions.message_service.post_user_message",
        raise_not_configured,
    )
    response = api_client.post(
        f"/sessions/{created['id']}/messages",
        json={"content": "hi"},
        headers=_headers(),
    )
    assert response.status_code == 503
    assert "API key" in response.json()["detail"]


def test_post_execution_error_returns_502(
    api_client: TestClient,
    monkeypatch: MonkeyPatch,
) -> None:
    created = _create_session(api_client)
    _with_saver(api_client)

    async def raise_exec(**kwargs):
        raise AgentExecutionError("upstream failed", execution_id="exec-1")

    monkeypatch.setattr(
        "app.api.routes.sessions.message_service.post_user_message",
        raise_exec,
    )
    response = api_client.post(
        f"/sessions/{created['id']}/messages",
        json={"content": "hi"},
        headers=_headers(),
    )
    assert response.status_code == 502
    assert response.json()["detail"] == {
        "message": "upstream failed",
        "execution_id": "exec-1",
    }
