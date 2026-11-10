"""Per-agent access grants (#17)."""

from __future__ import annotations

import json
import uuid
from typing import Any

from app.agents.runtime import AgentMessageView, AgentResult
from app.api.deps import get_current_user
from app.core.auth import AuthenticatedUser
from app.core.permissions import PERM_AGENTS_EXECUTE, PERM_AGENTS_READ
from app.services import agent_access as access_service
from fastapi import Request
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage
from pytest import MonkeyPatch
from sqlalchemy.orm import Session

from tests.chat_helpers import OTHER, USER, headers, seed_agent_grant, with_saver
from tests.fakes import ScriptedChatModel

ADMIN = "admin-user"
REPORTING = "reporting"
FINANCE = "finance"


def _admin_headers() -> dict[str, str]:
    return headers(ADMIN)


def test_upsert_and_revoke_grant(
    api_client: TestClient,
    db_session: Session,
) -> None:
    put = api_client.put(
        "/agent-access/grants",
        json={
            "user_id": USER,
            "agent_id": REPORTING,
            "can_view": True,
            "can_configure": False,
            "can_execute": True,
        },
        headers=_admin_headers(),
    )
    assert put.status_code == 200
    body = put.json()
    assert body["user_id"] == USER
    assert body["agent_id"] == REPORTING
    assert body["can_view"] is True
    assert body["can_execute"] is True

    listed = api_client.get(
        "/agent-access/grants",
        params={"user_id": USER, "agent_id": REPORTING},
        headers=_admin_headers(),
    )
    assert listed.status_code == 200
    assert len(listed.json()["items"]) == 1

    deleted = api_client.delete(
        "/agent-access/grants",
        params={"user_id": USER, "agent_id": REPORTING},
        headers=_admin_headers(),
    )
    assert deleted.status_code == 204
    assert (
        api_client.get(
            "/agent-access/grants",
            params={"user_id": USER},
            headers=_admin_headers(),
        ).json()["items"]
        == []
    )


def test_upsert_all_false_deletes_grant(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(db_session, USER, REPORTING)
    response = api_client.put(
        "/agent-access/grants",
        json={
            "user_id": USER,
            "agent_id": REPORTING,
            "can_view": False,
            "can_configure": False,
            "can_execute": False,
        },
        headers=_admin_headers(),
    )
    assert response.status_code == 204
    assert access_service.get_grant(db_session, user_id=USER, agent_id=REPORTING) is None


def test_grant_manage_required(api_client: TestClient) -> None:
    def _user_without_manage(request: Request) -> AuthenticatedUser:
        return AuthenticatedUser(
            user_id=USER,
            permissions=frozenset({PERM_AGENTS_READ, PERM_AGENTS_EXECUTE}),
        )

    api_client.app.dependency_overrides[get_current_user] = _user_without_manage
    response = api_client.put(
        "/agent-access/grants",
        json={
            "user_id": USER,
            "agent_id": REPORTING,
            "can_view": True,
            "can_configure": False,
            "can_execute": True,
        },
        headers=headers(USER),
    )
    assert response.status_code == 403, response.text
    assert response.json()["detail"] == "Permission denied"


def test_grant_list_filters_before_pagination(
    api_client: TestClient,
    db_session: Session,
) -> None:
    for agent_id in (REPORTING, FINANCE, "ops"):
        seed_agent_grant(db_session, USER, agent_id)
    seed_agent_grant(db_session, OTHER, REPORTING)

    page = api_client.get(
        "/agent-access/grants",
        params={"user_id": USER, "limit": 2},
        headers=_admin_headers(),
    )
    assert page.status_code == 200
    body = page.json()
    assert len(body["items"]) == 2
    assert body["next_cursor"]
    assert {item["user_id"] for item in body["items"]} == {USER}

    page2 = api_client.get(
        "/agent-access/grants",
        params={"user_id": USER, "limit": 2, "cursor": body["next_cursor"]},
        headers=_admin_headers(),
    )
    assert page2.status_code == 200
    assert len(page2.json()["items"]) == 1
    assert page2.json()["next_cursor"] is None


def test_reporting_vs_finance_isolation(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(db_session, USER, REPORTING)
    created = api_client.post(
        "/sessions",
        json={"agent_id": REPORTING},
        headers=headers(USER),
    )
    assert created.status_code == 201
    denied = api_client.post(
        "/sessions",
        json={"agent_id": FINANCE},
        headers=headers(USER),
    )
    assert denied.status_code == 403
    assert denied.json()["detail"] == "Agent access denied"


def test_list_filters_non_viewable_agents(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(db_session, USER, REPORTING, can_view=True, can_execute=True)
    seed_agent_grant(db_session, USER, FINANCE, can_view=False, can_execute=True)
    assert (
        api_client.post(
            "/sessions",
            json={"agent_id": REPORTING, "title": "R"},
            headers=headers(USER),
        ).status_code
        == 201
    )
    assert (
        api_client.post(
            "/sessions",
            json={"agent_id": FINANCE, "title": "F"},
            headers=headers(USER),
        ).status_code
        == 201
    )
    listed = api_client.get("/sessions", headers=headers(USER)).json()
    assert len(listed["items"]) == 1
    assert listed["items"][0]["agent_id"] == REPORTING


def test_owned_without_view_returns_403_not_404(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(db_session, USER, REPORTING, can_view=False, can_execute=True)
    created = api_client.post(
        "/sessions",
        json={"agent_id": REPORTING},
        headers=headers(USER),
    ).json()
    response = api_client.get(f"/sessions/{created['id']}", headers=headers(USER))
    assert response.status_code == 403
    assert response.json()["detail"] == "Agent access denied"


def test_other_user_still_404_before_agent_check(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(db_session, USER, REPORTING)
    seed_agent_grant(db_session, OTHER, REPORTING)
    created = api_client.post(
        "/sessions",
        json={"agent_id": REPORTING},
        headers=headers(USER),
    ).json()
    response = api_client.get(f"/sessions/{created['id']}", headers=headers(OTHER))
    assert response.status_code == 404


def test_revoke_execute_blocks_run_but_owner_can_archive(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(db_session, USER, REPORTING)
    created = api_client.post(
        "/sessions",
        json={"agent_id": REPORTING},
        headers=headers(USER),
    ).json()
    session_id = created["id"]

    access_service.upsert_grant(
        db_session,
        user_id=USER,
        agent_id=REPORTING,
        can_view=True,
        can_configure=False,
        can_execute=False,
    )

    with_saver(api_client)
    denied = api_client.post(
        f"/sessions/{session_id}/messages",
        json={"content": "hi"},
        headers=headers(USER),
    )
    assert denied.status_code == 403
    assert denied.json()["detail"] == "Agent access denied"

    archived = api_client.delete(f"/sessions/{session_id}", headers=headers(USER))
    assert archived.status_code == 204
    again = api_client.delete(f"/sessions/{session_id}", headers=headers(USER))
    assert again.status_code == 204


def test_admin_manage_without_grant_cannot_execute(
    api_client: TestClient,
    monkeypatch: MonkeyPatch,
) -> None:
    called = False

    async def fake_run(message: str, **kwargs: Any) -> AgentResult:
        nonlocal called
        called = True
        return AgentResult(
            reply="ok",
            execution_id=str(uuid.uuid4()),
            messages=[AgentMessageView(role="assistant", content="ok")],
        )

    monkeypatch.setattr("app.api.routes.agents.run_agent", fake_run)
    response = api_client.post(
        "/agents/run",
        json={"message": "hello"},
        headers=_admin_headers(),
    )
    assert response.status_code == 403
    assert called is False


def test_stateless_run_requires_grant_on_settings_agent(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    called = False

    async def fake_run(message: str, **kwargs: Any) -> AgentResult:
        nonlocal called
        called = True
        return AgentResult(
            reply="ok",
            execution_id=str(uuid.uuid4()),
            messages=[
                AgentMessageView(role="user", content=message),
                AgentMessageView(role="assistant", content="ok"),
            ],
        )

    monkeypatch.setattr("app.api.routes.agents.run_agent", fake_run)
    denied = api_client.post(
        "/agents/run",
        json={"message": "hello"},
        headers=headers(USER),
    )
    assert denied.status_code == 403
    assert called is False

    seed_agent_grant(db_session, USER, "default", can_view=False, can_execute=True)
    allowed = api_client.post(
        "/agents/run",
        json={"message": "hello"},
        headers=headers(USER),
    )
    assert allowed.status_code == 200
    assert called is True
    assert allowed.json()["messages"] == [{"role": "assistant", "content": "ok"}]


def test_agents_run_execute_only_hides_accumulated_messages(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    seed_agent_grant(db_session, USER, "default", can_view=False, can_execute=True)
    with_saver(api_client)

    async def fake_run(message: str, **kwargs: Any) -> AgentResult:
        return AgentResult(
            reply="new reply",
            execution_id=str(uuid.uuid4()),
            messages=[
                AgentMessageView(role="user", content="old secret"),
                AgentMessageView(role="assistant", content="old answer"),
                AgentMessageView(role="user", content=message),
                AgentMessageView(role="assistant", content="new reply"),
            ],
        )

    monkeypatch.setattr("app.api.routes.agents.run_agent", fake_run)
    created = api_client.post(
        "/sessions",
        json={"agent_id": "default"},
        headers=headers(USER),
    ).json()
    response = api_client.post(
        "/agents/run",
        json={"message": "next", "session_id": created["id"]},
        headers=headers(USER),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["reply"] == "new reply"
    assert body["messages"] == [{"role": "assistant", "content": "new reply"}]
    assert "old secret" not in json.dumps(body)


def test_json_and_sse_execute_only_do_not_replay_prior_message_objects(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    seed_agent_grant(db_session, USER, "default", can_view=True, can_execute=True)
    with_saver(api_client)
    created = api_client.post(
        "/sessions",
        json={"agent_id": "default"},
        headers=headers(USER),
    ).json()
    session_id = created["id"]

    # Shared scripted model so turns consume successive replies.
    scripted = ScriptedChatModel(
        script=[
            AIMessage(content="first reply"),
            AIMessage(content="fresh reply"),
            AIMessage(content="streamed reply"),
        ]
    )
    monkeypatch.setattr("app.agents.graph.create_chat_model", lambda: scripted)
    first = api_client.post(
        f"/sessions/{session_id}/messages",
        json={"content": "prior secret history"},
        headers=headers(USER),
    )
    assert first.status_code == 200

    access_service.upsert_grant(
        db_session,
        user_id=USER,
        agent_id="default",
        can_view=False,
        can_configure=False,
        can_execute=True,
    )

    history = api_client.get(f"/sessions/{session_id}/messages", headers=headers(USER))
    assert history.status_code == 403

    posted = api_client.post(
        f"/sessions/{session_id}/messages",
        json={"content": "new turn"},
        headers=headers(USER),
    )
    assert posted.status_code == 200
    post_body = posted.json()
    assert post_body["message"] == {"role": "assistant", "content": "fresh reply"}
    assert "prior secret history" not in json.dumps(post_body)
    assert "first reply" not in json.dumps(post_body)

    with api_client.stream(
        "POST",
        f"/sessions/{session_id}/messages/stream",
        json={"content": "stream turn"},
        headers=headers(USER),
    ) as stream:
        assert stream.status_code == 200
        raw = stream.read().decode()
    assert "prior secret history" not in raw
    assert "first reply" not in raw
    assert "event: done" in raw
    assert "streamed reply" in raw


def test_atomic_upsert_replaces_capabilities(db_session: Session) -> None:
    first = access_service.upsert_grant(
        db_session,
        user_id=USER,
        agent_id=REPORTING,
        can_view=True,
        can_configure=False,
        can_execute=False,
    )
    assert first is not None
    second = access_service.upsert_grant(
        db_session,
        user_id=USER,
        agent_id=REPORTING,
        can_view=False,
        can_configure=True,
        can_execute=True,
    )
    assert second is not None
    assert second.id == first.id
    assert second.can_view is False
    assert second.can_configure is True
    assert second.can_execute is True
