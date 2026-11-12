"""Human approval pauses, resumes, and session-gate lifecycle (#24)."""

from __future__ import annotations

import asyncio
import json
import uuid

import pytest
from app.agents.runtime import resume_agent, run_agent
from app.agents.tools.registry import ToolRegistry
from app.models.agent import Agent
from app.models.agent_execution import AgentExecution, AgentExecutionStatus
from app.models.session_run_gate import SessionRunGate
from app.services import agent_access as access_service
from app.services.agent_executions import begin_gated_execution, finalize_execution
from app.services.session_gates import (
    AWAITING,
    IDLE,
    SessionBusyError,
    WorkersNotConfirmedError,
    pause_for_approval,
    recover_stuck_run,
)
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import InMemorySaver
from pytest import MonkeyPatch
from sqlalchemy.orm import Session

from tests.chat_helpers import (
    OTHER,
    USER,
    create_session,
    default_execution_config,
    default_tool_auth,
    headers,
    seed_agent_grant,
    with_saver,
)
from tests.fakes import ScriptedChatModel


def _call(name: str, call_id: str, args: dict[str, object]) -> dict[str, object]:
    return {"name": name, "args": args, "id": call_id, "type": "tool_call"}


def _use_model(monkeypatch: MonkeyPatch, model: ScriptedChatModel) -> None:
    monkeypatch.setattr(
        "app.agents.runtime.create_chat_model_for_agent",
        lambda **_kwargs: model,
    )


def _count_executions(monkeypatch: MonkeyPatch) -> list[str]:
    calls: list[str] = []
    original = ToolRegistry.aexecute

    async def _wrapped(self, name, args, *, context=None):  # noqa: ANN001
        result = await original(self, name, args, context=context)
        calls.append(name)
        return result

    monkeypatch.setattr(ToolRegistry, "aexecute", _wrapped)
    return calls


def _sse_events(body: str) -> list[dict[str, object]]:
    events: list[dict[str, object]] = []
    event_name = ""
    for line in body.splitlines():
        if line.startswith("event:"):
            event_name = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            payload = json.loads(line.split(":", 1)[1].strip())
            assert payload["type"] == event_name
            events.append(payload)
    return events


def _pause_session(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
    *,
    approval_tool_names: list[str] | None = None,
    script: list[AIMessage] | None = None,
) -> tuple[str, dict[str, object], list[str]]:
    approvals = approval_tool_names if approval_tool_names is not None else ["add"]
    session = create_session(
        api_client,
        db_session,
        tool_names=["echo", "add", "multiply"],
        approval_tool_names=approvals,
    )
    with_saver(api_client)
    calls = _count_executions(monkeypatch)
    model = ScriptedChatModel(
        script=script
        or [
            AIMessage(
                content="",
                tool_calls=[_call("add", "call_add", {"a": 2, "b": 3})],
            ),
            AIMessage(content="The sum is 5."),
        ]
    )
    _use_model(monkeypatch, model)
    response = api_client.post(
        f"/sessions/{session['id']}/messages",
        json={"content": "add"},
        headers=headers(),
    )
    assert response.status_code == 202, response.text
    return session["id"], response.json(), calls


def test_mixed_batch_interrupts_before_any_tool_and_second_pause() -> None:
    calls: list[str] = []
    original = ToolRegistry.aexecute

    async def _wrapped(self, name, args, *, context=None):  # noqa: ANN001
        result = await original(self, name, args, context=context)
        calls.append(name)
        return result

    ToolRegistry.aexecute = _wrapped  # type: ignore[method-assign]
    try:
        llm = ScriptedChatModel(
            script=[
                AIMessage(
                    content="",
                    tool_calls=[
                        _call("echo", "call_echo", {"text": "hi"}),
                        _call("add", "call_add", {"a": 1, "b": 2}),
                    ],
                ),
                AIMessage(
                    content="",
                    tool_calls=[_call("multiply", "call_mul", {"a": 2, "b": 3})],
                ),
                AIMessage(content="done"),
            ]
        )
        config = default_execution_config(
            tool_names=("echo", "add", "multiply"),
            approval_tool_names=("add", "multiply"),
        )
        saver = InMemorySaver()
        execution_id = uuid.uuid4()
        first = asyncio.run(
            run_agent(
                "go",
                tool_auth=default_tool_auth(),
                execution_config=config,
                llm=llm,
                checkpointer=saver,
                thread_id="thread-1",
                execution_id=execution_id,
            )
        )
        assert calls == []
        assert first.pending is not None
        assert first.pending.tool_name == "add"
        assert first.pending.tool_call_id == "call_add"
        assert first.reply == ""

        second = asyncio.run(
            resume_agent(
                "approve",
                tool_auth=default_tool_auth(),
                execution_config=config,
                llm=llm,
                checkpointer=saver,
                thread_id="thread-1",
                execution_id=execution_id,
            )
        )
        assert calls == ["echo", "add"]
        assert second.pending is not None
        assert second.pending.tool_name == "multiply"

        # Dropping the approval requirement does not skip the frozen decision.
        cleared = default_execution_config(
            tool_names=("echo", "add", "multiply"),
            approval_tool_names=(),
        )
        finished = asyncio.run(
            resume_agent(
                "approve",
                tool_auth=default_tool_auth(allowed_tools=frozenset({"echo", "add", "multiply"})),
                execution_config=cleared,
                llm=llm,
                checkpointer=saver,
                thread_id="thread-1",
                execution_id=execution_id,
            )
        )
        assert finished.pending is None
        assert finished.reply == "done"
        assert calls == ["echo", "add", "multiply"]
    finally:
        ToolRegistry.aexecute = original  # type: ignore[method-assign]


def test_stateless_gated_tool_is_not_executed() -> None:
    calls: list[str] = []
    original = ToolRegistry.aexecute

    async def _wrapped(self, name, args, *, context=None):  # noqa: ANN001
        result = await original(self, name, args, context=context)
        calls.append(name)
        return result

    ToolRegistry.aexecute = _wrapped  # type: ignore[method-assign]
    try:
        llm = ScriptedChatModel(
            script=[
                AIMessage(
                    content="",
                    tool_calls=[
                        _call("echo", "call_echo", {"text": "hi"}),
                        _call("add", "call_add", {"a": 1, "b": 2}),
                    ],
                ),
                AIMessage(content="done"),
            ]
        )
        result = asyncio.run(
            run_agent(
                "go",
                tool_auth=default_tool_auth(),
                execution_config=default_execution_config(
                    tool_names=("echo", "add"),
                    approval_tool_names=("add",),
                ),
                llm=llm,
            )
        )
    finally:
        ToolRegistry.aexecute = original  # type: ignore[method-assign]

    assert calls == ["echo"]
    assert result.pending is None
    assert result.reply == "done"
    assert any(
        item.role == "tool" and "requires approval and this run has no session" in item.content
        for item in result.messages
    )


def test_reject_does_not_execute_the_tool() -> None:
    calls: list[str] = []
    original = ToolRegistry.aexecute

    async def _wrapped(self, name, args, *, context=None):  # noqa: ANN001
        result = await original(self, name, args, context=context)
        calls.append(name)
        return result

    ToolRegistry.aexecute = _wrapped  # type: ignore[method-assign]
    try:
        llm = ScriptedChatModel(
            script=[
                AIMessage(content="", tool_calls=[_call("add", "call_add", {"a": 1, "b": 1})]),
                AIMessage(content="skipped"),
            ]
        )
        config = default_execution_config(
            tool_names=("add",),
            approval_tool_names=("add",),
        )
        saver = InMemorySaver()
        execution_id = uuid.uuid4()
        paused = asyncio.run(
            run_agent(
                "go",
                tool_auth=default_tool_auth(),
                execution_config=config,
                llm=llm,
                checkpointer=saver,
                thread_id="thread-reject",
                execution_id=execution_id,
            )
        )
        assert paused.pending is not None
        finished = asyncio.run(
            resume_agent(
                "reject",
                tool_auth=default_tool_auth(),
                execution_config=config,
                llm=llm,
                checkpointer=saver,
                thread_id="thread-reject",
                execution_id=execution_id,
            )
        )
    finally:
        ToolRegistry.aexecute = original  # type: ignore[method-assign]

    assert calls == []
    assert finished.reply == "skipped"
    assert any(item.content == "Tool call rejected" for item in finished.messages)


def test_json_message_pauses_with_202_and_success_body_stays_unchanged(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    session_id, body, calls = _pause_session(api_client, db_session, monkeypatch)
    assert calls == []
    assert set(body) == {
        "execution_id",
        "interrupt_id",
        "checkpoint_id",
        "tool_call_id",
        "tool_name",
        "arguments",
    }
    assert body["tool_name"] == "add"
    assert body["arguments"] == {"a": 2, "b": 3}

    db_session.expire_all()
    execution = db_session.get(AgentExecution, uuid.UUID(str(body["execution_id"])))
    assert execution is not None
    assert execution.status == AgentExecutionStatus.AWAITING_APPROVAL.value
    assert execution.completed_at is None
    assert execution.duration_ms is None
    gate = db_session.get(SessionRunGate, uuid.UUID(session_id))
    assert gate is not None
    assert gate.state == AWAITING

    listed = api_client.get("/executions?status=awaiting_approval", headers=headers())
    assert listed.status_code == 200
    assert listed.json()["items"][0]["status"] == "awaiting_approval"
    assert listed.json()["items"][0]["completed_at"] is None

    approved = api_client.post(
        f"/sessions/{session_id}/approvals/{body['interrupt_id']}/approve",
        json={"tool_call_id": body["tool_call_id"]},
        headers=headers(),
    )
    assert approved.status_code == 200, approved.text
    payload = approved.json()
    assert set(payload) == {"execution_id", "message"}
    assert payload["message"] == {"role": "assistant", "content": "The sum is 5."}
    assert calls == ["add"]

    duplicate = api_client.post(
        f"/sessions/{session_id}/approvals/{body['interrupt_id']}/approve",
        json={"tool_call_id": body["tool_call_id"]},
        headers=headers(),
    )
    assert duplicate.status_code == 409


def test_session_run_pauses_with_202_and_stateless_run_stays_200(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    session = create_session(
        api_client,
        db_session,
        tool_names=["add"],
        approval_tool_names=["add"],
    )
    with_saver(api_client)
    calls = _count_executions(monkeypatch)
    _use_model(
        monkeypatch,
        ScriptedChatModel(
            script=[
                AIMessage(content="", tool_calls=[_call("add", "call_add", {"a": 1, "b": 1})]),
                AIMessage(content="done"),
            ]
        ),
    )
    paused = api_client.post(
        "/agents/run",
        json={"message": "add", "session_id": session["id"]},
        headers=headers(),
    )
    assert paused.status_code == 202, paused.text
    assert paused.json()["tool_name"] == "add"
    assert "reply" not in paused.json()
    assert calls == []

    seed_agent_grant(
        db_session,
        USER,
        tool_names=["add"],
        approval_tool_names=["add"],
    )
    _use_model(
        monkeypatch,
        ScriptedChatModel(
            script=[
                AIMessage(content="", tool_calls=[_call("add", "call_add", {"a": 1, "b": 1})]),
                AIMessage(content="done"),
            ]
        ),
    )
    stateless = api_client.post(
        "/agents/run",
        json={"message": "add"},
        headers=headers(),
    )
    assert stateless.status_code == 200, stateless.text
    body = stateless.json()
    assert set(body) == {"reply", "execution_id", "messages"}
    assert body["reply"] == "done"
    assert any("requires approval" in item["content"] for item in body["messages"])
    assert calls == []


def test_approve_can_pause_again_and_reject_returns_message_result(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    session_id, body, calls = _pause_session(
        api_client,
        db_session,
        monkeypatch,
        approval_tool_names=["add", "multiply"],
        script=[
            AIMessage(content="", tool_calls=[_call("add", "call_add", {"a": 1, "b": 1})]),
            AIMessage(
                content="",
                tool_calls=[_call("multiply", "call_mul", {"a": 2, "b": 2})],
            ),
            AIMessage(content="finished"),
        ],
    )
    again = api_client.post(
        f"/sessions/{session_id}/approvals/{body['interrupt_id']}/approve",
        json={"tool_call_id": body["tool_call_id"]},
        headers=headers(),
    )
    assert again.status_code == 202, again.text
    assert again.json()["tool_name"] == "multiply"
    assert calls == ["add"]

    done = api_client.post(
        f"/sessions/{session_id}/approvals/{again.json()['interrupt_id']}/approve",
        json={"tool_call_id": again.json()["tool_call_id"]},
        headers=headers(),
    )
    assert done.status_code == 200, done.text
    assert done.json()["message"]["content"] == "finished"
    assert calls == ["add", "multiply"]

    rejected_session, rejected, rejected_calls = _pause_session(
        api_client,
        db_session,
        monkeypatch,
        script=[
            AIMessage(content="", tool_calls=[_call("add", "call_add", {"a": 4, "b": 1})]),
            AIMessage(content="not run"),
        ],
    )
    outcome = api_client.post(
        f"/sessions/{rejected_session}/approvals/{rejected['interrupt_id']}/reject",
        json={"tool_call_id": rejected["tool_call_id"]},
        headers=headers(),
    )
    assert outcome.status_code == 200, outcome.text
    assert outcome.json()["message"] == {"role": "assistant", "content": "not run"}
    assert rejected_calls == []


def test_approval_authorization_and_conflicts(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    session_id, body, calls = _pause_session(api_client, db_session, monkeypatch)
    other = api_client.post(
        f"/sessions/{session_id}/approvals/{body['interrupt_id']}/approve",
        json={"tool_call_id": body["tool_call_id"]},
        headers=headers(OTHER),
    )
    assert other.status_code == 404
    mismatch = api_client.post(
        f"/sessions/{session_id}/approvals/{body['interrupt_id']}/approve",
        json={"tool_call_id": "someone-else"},
        headers=headers(),
    )
    assert mismatch.status_code == 409
    busy = api_client.post(
        f"/sessions/{session_id}/messages",
        json={"content": "again"},
        headers=headers(),
    )
    assert busy.status_code == 409
    assert calls == []

    access_service.upsert_grant(
        db_session,
        user_id=USER,
        agent_id="default",
        can_view=True,
        can_configure=False,
        can_execute=False,
    )
    denied = api_client.post(
        f"/sessions/{session_id}/approvals/{body['interrupt_id']}/approve",
        json={"tool_call_id": body["tool_call_id"]},
        headers=headers(),
    )
    assert denied.status_code == 403
    visible = api_client.get(f"/sessions/{session_id}/approvals", headers=headers())
    assert visible.status_code == 200
    assert visible.json()["items"][0]["tool_call_id"] == body["tool_call_id"]


def test_stream_emits_approval_required_without_done_or_error(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    session = create_session(
        api_client,
        db_session,
        tool_names=["add"],
        approval_tool_names=["add"],
    )
    with_saver(api_client)
    _use_model(
        monkeypatch,
        ScriptedChatModel(
            script=[
                AIMessage(content="", tool_calls=[_call("add", "call_add", {"a": 1, "b": 2})]),
                AIMessage(content="later"),
            ]
        ),
    )
    with api_client.stream(
        "POST",
        f"/sessions/{session['id']}/messages/stream",
        json={"content": "add"},
        headers=headers(),
    ) as response:
        status_code = response.status_code
        content_type = response.headers.get("content-type", "")
        raw = response.read().decode()
    assert status_code == 200
    assert content_type.startswith("text/event-stream")
    events = _sse_events(raw)
    kinds = [event["type"] for event in events]
    assert "approval.required" in kinds
    assert "done" not in kinds
    assert "error" not in kinds
    assert "tool.end" not in kinds


def test_config_changes_while_paused_keep_the_frozen_decision(
    api_client: TestClient,
    db_session: Session,
    monkeypatch: MonkeyPatch,
) -> None:
    session_id, body, calls = _pause_session(api_client, db_session, monkeypatch)
    agent = db_session.get(AgentExecution, uuid.UUID(str(body["execution_id"])))
    assert agent is not None
    row = db_session.get(Agent, "default")
    assert row is not None
    row.approval_tool_names = []
    db_session.commit()
    pending = api_client.get(f"/sessions/{session_id}/approvals", headers=headers())
    assert pending.status_code == 200
    assert pending.json()["items"][0]["tool_name"] == "add"
    blocked = api_client.post(
        f"/sessions/{session_id}/messages",
        json={"content": "nope"},
        headers=headers(),
    )
    assert blocked.status_code == 409

    row.tool_names = ["echo"]
    row.approval_tool_names = []
    db_session.commit()
    resumed = api_client.post(
        f"/sessions/{session_id}/approvals/{body['interrupt_id']}/approve",
        json={"tool_call_id": body["tool_call_id"]},
        headers=headers(),
    )
    assert resumed.status_code == 200, resumed.text
    assert calls == []


def test_put_rejects_approval_tools_outside_the_assignment(
    api_client: TestClient,
    db_session: Session,
) -> None:
    seed_agent_grant(db_session, USER, can_configure=True, tool_names=["echo", "add"])
    rejected = api_client.put(
        "/agents/default/configuration",
        json={
            "system_prompt": "",
            "llm_provider": "deepseek",
            "llm_model": "deepseek-flash",
            "temperature": 1.0,
            "tool_names": ["echo"],
            "approval_tool_names": ["add"],
        },
        headers=headers(),
    )
    assert rejected.status_code == 422
    accepted = api_client.put(
        "/agents/default/configuration",
        json={
            "system_prompt": "",
            "llm_provider": "deepseek",
            "llm_model": "deepseek-flash",
            "temperature": 1.0,
            "tool_names": ["echo", "add"],
            "approval_tool_names": ["add"],
        },
        headers=headers(),
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["approval_tool_names"] == ["add"]


def test_early_cancel_releases_the_gate_and_pause_is_not_cancelled(
    db_session: Session,
) -> None:
    session_id = uuid.uuid4()
    execution_id = uuid.uuid4()
    started = begin_gated_execution(
        db_session,
        session_id=session_id,
        execution_id=execution_id,
        user_id=USER,
        agent_id="default",
    )
    finalize_execution(
        db_session,
        execution_id=execution_id,
        status=AgentExecutionStatus.CANCELLED.value,
        monotonic_start=started,
        session_id=session_id,
    )
    db_session.expire_all()
    gate = db_session.get(SessionRunGate, session_id)
    execution = db_session.get(AgentExecution, execution_id)
    assert gate is not None and gate.state == IDLE and gate.execution_id is None
    assert execution is not None and execution.status == AgentExecutionStatus.CANCELLED.value

    paused_session = uuid.uuid4()
    paused_execution = uuid.uuid4()
    paused_start = begin_gated_execution(
        db_session,
        session_id=paused_session,
        execution_id=paused_execution,
        user_id=USER,
        agent_id="default",
    )
    pause_for_approval(
        db_session,
        session_id=paused_session,
        execution_id=paused_execution,
        monotonic_start=paused_start,
        checkpoint_id="checkpoint-1",
        interrupt_id="interrupt-1",
        tool_call_id="call-1",
    )
    db_session.expire_all()
    before = db_session.get(AgentExecution, paused_execution)
    assert before is not None
    recorded = before.active_duration_ms
    updated = finalize_execution(
        db_session,
        execution_id=paused_execution,
        status=AgentExecutionStatus.CANCELLED.value,
        monotonic_start=paused_start,
        session_id=paused_session,
    )
    db_session.expire_all()
    after = db_session.get(AgentExecution, paused_execution)
    paused_gate = db_session.get(SessionRunGate, paused_session)
    assert updated is False
    assert after is not None
    assert after.status == AgentExecutionStatus.AWAITING_APPROVAL.value
    assert after.completed_at is None
    assert after.active_duration_ms == recorded
    assert paused_gate is not None and paused_gate.state == AWAITING


def test_stuck_running_gate_requires_stopped_workers_before_recovery(
    db_session: Session,
) -> None:
    session_id = uuid.uuid4()
    execution_id = uuid.uuid4()
    begin_gated_execution(
        db_session,
        session_id=session_id,
        execution_id=execution_id,
        user_id=USER,
        agent_id="default",
    )
    with pytest.raises(SessionBusyError):
        begin_gated_execution(
            db_session,
            session_id=session_id,
            execution_id=uuid.uuid4(),
            user_id=USER,
            agent_id="default",
        )
    with pytest.raises(WorkersNotConfirmedError):
        recover_stuck_run(
            db_session,
            session_id=session_id,
            execution_id=execution_id,
            workers_stopped=False,
            checkpoint_id="checkpoint-1",
            interrupt_id="interrupt-1",
            tool_call_id="call-1",
        )
    db_session.expire_all()
    before = db_session.get(AgentExecution, execution_id)
    assert before is not None
    recorded = before.active_duration_ms
    recover_stuck_run(
        db_session,
        session_id=session_id,
        execution_id=execution_id,
        workers_stopped=True,
        checkpoint_id="checkpoint-1",
        interrupt_id="interrupt-1",
        tool_call_id="call-1",
    )
    db_session.expire_all()
    execution = db_session.get(AgentExecution, execution_id)
    gate = db_session.get(SessionRunGate, session_id)
    assert execution is not None
    assert execution.status == AgentExecutionStatus.AWAITING_APPROVAL.value
    assert execution.active_duration_ms == recorded
    assert execution.duration_ms is None
    assert gate is not None and gate.state == AWAITING

    failed_session = uuid.uuid4()
    failed_execution = uuid.uuid4()
    begin_gated_execution(
        db_session,
        session_id=failed_session,
        execution_id=failed_execution,
        user_id=USER,
        agent_id="default",
    )
    recover_stuck_run(
        db_session,
        session_id=failed_session,
        execution_id=failed_execution,
        workers_stopped=True,
    )
    db_session.expire_all()
    failed = db_session.get(AgentExecution, failed_execution)
    failed_gate = db_session.get(SessionRunGate, failed_session)
    assert failed is not None and failed.status == AgentExecutionStatus.FAILED.value
    assert failed.duration_ms == failed.active_duration_ms
    assert failed_gate is not None and failed_gate.state == IDLE
