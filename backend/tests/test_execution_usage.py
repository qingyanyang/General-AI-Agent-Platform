"""Usage uses provider observations and stays independent of trace or message content."""

from __future__ import annotations

import asyncio
import json
import uuid
from contextlib import nullcontext
from datetime import UTC, datetime
from decimal import Decimal

import httpx
import pytest
from app.agents.usage import UsageRecorder, observe_provider_response
from app.agents.usage_chat_model import UsageChatOpenAI
from app.api.deps import get_current_user
from app.core.auth import AuthenticatedUser
from app.core.config import Settings
from app.core.model_rates import ModelRate, estimate_cost
from app.core.permissions import PERM_AGENT_ACCESS_MANAGE, PERM_AGENTS_READ
from app.models.agent_execution import AgentExecution
from app.models.directory_user import DirectoryUser
from app.models.execution_usage import ExecutionModelCall
from app.services.agent_executions import start_execution
from app.services.execution_usage import usage_detail
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage
from sqlalchemy import select
from sqlalchemy.orm import Session

from tests.chat_helpers import USER, create_session, headers, with_saver
from tests.fakes import ScriptedChatModel


def rate(**overrides) -> ModelRate:
    return ModelRate.model_validate(
        {
            "provider": "openai",
            "model": "test-model",
            "currency": "USD",
            "source": "Fixture only",
            "effective_from": "2026-01-01",
            "input_per_million": "2",
            "output_per_million": "5",
            "cached_input_per_million": "0.5",
            **overrides,
        }
    )


def record_for(db: Session, *, provider: str = "openai", user_id: str = USER) -> UsageRecorder:
    execution_id = uuid.uuid4()
    start_execution(
        db, execution_id=execution_id, user_id=user_id, agent_id="default", session_id=None
    )
    return UsageRecorder(
        lambda: nullcontext(db),
        execution_id=execution_id,
        provider=provider,
        model="test-model",
    )


@pytest.mark.parametrize("stream", [True, False])
@pytest.mark.parametrize(
    ("provider", "raw", "expected"),
    [
        (
            "openai",
            {
                "prompt_tokens": 10,
                "completion_tokens": 0,
                "total_tokens": 10,
                "prompt_tokens_details": {"cached_tokens": 4},
            },
            (10, 0, 10, 4),
        ),
        (
            "deepseek",
            {
                "prompt_tokens": 10,
                "completion_tokens": 3,
                "total_tokens": 13,
                "prompt_cache_hit_tokens": 4,
                "prompt_cache_miss_tokens": 6,
            },
            (10, 3, 13, 4),
        ),
        ("openai", {"prompt_tokens": 10}, (10, None, None, None)),
        ("deepseek", None, (None, None, None, None)),
    ],
)
def test_installed_provider_adapter_preserves_usage_presence(
    db_session: Session,
    stream: bool,
    provider: str,
    raw,
    expected,
) -> None:
    recorder = record_for(db_session, provider=provider)

    def respond(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        base = {"id": "provider-call", "model": "test-model", "created": 1}
        if stream:
            assert payload["stream_options"] == {"include_usage": True}
            chunk_base = {**base, "object": "chat.completion.chunk"}
            chunks = [
                {
                    **chunk_base,
                    "choices": [
                        {"index": 0, "delta": {"role": "assistant", "content": "answer"}},
                    ],
                },
                {**chunk_base, "choices": [], "usage": raw},
                {**chunk_base, "choices": [], "usage": raw},
            ]
            body = "".join(f"data: {json.dumps(chunk)}\n\n" for chunk in chunks)
            return httpx.Response(
                200,
                text=body + "data: [DONE]\n\n",
                headers={"content-type": "text/event-stream"},
            )
        return httpx.Response(
            200,
            json={
                **base,
                "object": "chat.completion",
                "choices": [{"index": 0, "message": {"role": "assistant", "content": "answer"}}],
                "usage": raw,
            },
        )

    async def run() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            model = UsageChatOpenAI(
                model="test-model",
                api_key="fixture-key",
                base_url="https://provider.invalid/v1",
                http_async_client=client,
                stream_usage=True,
                use_responses_api=False,
            )
            async with recorder.model_call():
                if stream:
                    parts = [str(chunk.content) async for chunk in model.astream("message")]
                    assert "".join(parts) == "answer"
                else:
                    assert (await model.ainvoke("message")).content == "answer"
        await recorder.finish()

    asyncio.run(run())
    call = db_session.scalars(select(ExecutionModelCall)).one()
    assert (
        call.input_tokens,
        call.output_tokens,
        call.total_tokens,
        call.cached_input_tokens,
    ) == expected
    assert call.pricing_snapshot is None
    assert call.estimated_cost is None


def test_decimal_cache_pricing_does_not_double_count() -> None:
    configured = rate(cache_write_per_million="3")
    counts = {"input_tokens": 10, "output_tokens": 2, "cache_read": 4, "cache_write": 1}
    assert estimate_cost(configured, **counts) == Decimal("0.000025")
    assert estimate_cost(configured, **{**counts, "cache_write": None}) is None
    assert estimate_cost(rate(cached_input_per_million=None), **counts) is None
    assert estimate_cost(rate(cache_pricing="flat"), **dict.fromkeys(counts)) is None
    assert (
        estimate_cost(rate(), input_tokens=0, output_tokens=0, cache_read=0, cache_write=None) == 0
    )


def test_call_snapshots_and_costs_are_separate_by_currency(
    db_session: Session, monkeypatch
) -> None:
    first = rate()
    second = rate(currency="EUR", input_per_million="10")
    catalog = [first]
    monkeypatch.setattr(
        "app.agents.usage.get_settings",
        lambda: Settings(_env_file=None, llm_rate_catalog=tuple(catalog)),
    )
    recorder = record_for(db_session)

    async def run() -> None:
        async with recorder.model_call():
            catalog[:] = [second]
            observe_provider_response(
                {
                    "usage": {
                        "prompt_tokens": 10,
                        "completion_tokens": 2,
                        "total_tokens": 12,
                        "prompt_tokens_details": {"cached_tokens": 4},
                    }
                }
            )
        async with recorder.model_call():
            observe_provider_response(
                {
                    "usage": {
                        "prompt_tokens": 0,
                        "completion_tokens": 1,
                        "total_tokens": 1,
                        "prompt_tokens_details": {"cached_tokens": 0},
                    }
                }
            )
        catalog.clear()
        async with recorder.model_call():
            observe_provider_response(
                {"usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}}
            )
        await recorder.finish()

    asyncio.run(run())
    row = db_session.get(AgentExecution, recorder.execution_id)
    detail = usage_detail(db_session, row)
    assert detail.tokens.completeness == "complete"
    assert detail.tokens.total_tokens == 15
    assert detail.model_calls[0].pricing_snapshot == first
    assert detail.model_calls[1].pricing_snapshot == second
    assert detail.model_calls[2].pricing_snapshot is None
    assert detail.model_calls[2].tokens.completeness == "complete"
    assert detail.model_calls[2].estimated_model_cost.completeness == "unknown"
    assert detail.estimated_model_cost.completeness == "partial"
    assert {item.currency: item.amount for item in detail.estimated_model_cost.totals} == {
        "USD": Decimal("0.000024"),
        "EUR": Decimal("0.000005"),
    }


@pytest.mark.parametrize("last_has_usage", [True, False])
def test_cancelled_call_preserves_prior_usage_and_received_snapshot(
    db_session: Session,
    last_has_usage: bool,
) -> None:
    recorder = record_for(db_session)
    raw = {"usage": {"prompt_tokens": 2, "completion_tokens": 3, "total_tokens": 5}}

    async def run() -> None:
        async with recorder.model_call():
            observe_provider_response(raw)
        entered = asyncio.Event()

        async def interrupted() -> None:
            async with recorder.model_call():
                if last_has_usage:
                    observe_provider_response(raw)
                entered.set()
                await asyncio.Event().wait()

        task = asyncio.create_task(interrupted())
        await entered.wait()
        earlier_call = db_session.scalar(
            select(ExecutionModelCall).where(
                ExecutionModelCall.execution_id == recorder.execution_id,
                ExecutionModelCall.status == "succeeded",
            ),
        )
        assert earlier_call is not None and earlier_call.total_tokens == 5
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        await recorder.finish()

    asyncio.run(run())
    row = db_session.get(AgentExecution, recorder.execution_id)
    row.status = "cancelled"
    detail = usage_detail(db_session, row)
    assert [call.status for call in detail.model_calls] == ["succeeded", "cancelled"]
    assert detail.tokens.total_tokens == (10 if last_has_usage else 5)
    assert detail.tokens.completeness == ("complete" if last_has_usage else "partial")


@pytest.mark.parametrize("unaccounted_attempt", [True, False])
def test_failed_call_keeps_usage_and_marks_a_detected_unaccounted_attempt(
    db_session: Session, unaccounted_attempt: bool,
) -> None:
    recorder = record_for(db_session)

    async def run() -> None:
        with pytest.raises(RuntimeError):
            async with recorder.model_call():
                observe_provider_response(
                    {
                        "id": "first",
                        "usage": {
                            "prompt_tokens": 2,
                            "completion_tokens": 1,
                            "total_tokens": 3,
                        },
                    }
                )
                if unaccounted_attempt:
                    observe_provider_response({"id": "other", "usage": None})
                raise RuntimeError("private payload")
        await recorder.finish()

    asyncio.run(run())
    row = db_session.get(AgentExecution, recorder.execution_id)
    detail = usage_detail(db_session, row)
    assert detail.model_calls[0].status == "failed"
    assert detail.tokens.completeness == ("partial" if unaccounted_attempt else "complete")
    assert detail.tokens.total_tokens == 3
    assert "private payload" not in detail.model_dump_json()


def test_usage_pagination_and_detail_authorize_target_and_execution(
    api_client: TestClient,
    db_session: Session,
    monkeypatch,
) -> None:
    for subject, role in [(USER, "user"), ("auth0|super", "super-admin")]:
        db_session.add(
            DirectoryUser(
                user_id=subject,
                email=f"{role}@example.test",
                role=role,
                first_seen_at=datetime.now(UTC),
                last_seen_at=datetime.now(UTC),
            )
        )
    db_session.commit()
    historical = record_for(db_session)
    db_session.get(AgentExecution, historical.execution_id).usage_capture = None
    db_session.commit()
    recent = record_for(db_session)
    hidden = record_for(db_session, user_id="auth0|super")

    def caller(permissions):
        return lambda: AuthenticatedUser(user_id="auth0|admin", permissions=frozenset(permissions))

    overrides = api_client.app.dependency_overrides
    monkeypatch.setitem(overrides, get_current_user, caller({PERM_AGENT_ACCESS_MANAGE}))
    path = f"/users/{USER}/executions"
    first = api_client.get(path, params={"limit": 1})
    assert first.status_code == 200, first.text
    first_page = first.json()
    assert first_page["items"][0]["id"] == str(recent.execution_id)
    assert first_page["items"][0]["tokens"]["completeness"] == "unknown"
    second = api_client.get(path, params={"limit": 1, "cursor": first_page["next_cursor"]}).json()
    assert second["items"][0]["id"] == str(historical.execution_id)
    assert second["items"][0]["tokens"]["completeness"] == "not_captured"
    assert second["next_cursor"] is None
    assert api_client.get(f"{path}/{recent.execution_id}").status_code == 200
    assert api_client.get(f"{path}/{hidden.execution_id}").status_code == 404
    assert api_client.get(f"/users/auth0|super/executions/{hidden.execution_id}").status_code == 404
    monkeypatch.setitem(overrides, get_current_user, caller({PERM_AGENTS_READ}))
    assert api_client.get(path).status_code == 403
    assert api_client.get(f"{path}/{recent.execution_id}").status_code == 403


class ObservedScript(ScriptedChatModel):
    def _next_message(self) -> AIMessage:
        message = super()._next_message()
        observe_provider_response(
            {
                "id": f"fixture-{self._call_index}",
                "usage": {"prompt_tokens": 6, "completion_tokens": 2, "total_tokens": 8},
            }
        )
        return message


@pytest.mark.parametrize("stream", [True, False])
def test_approval_resume_appends_model_calls_to_same_execution(
    api_client: TestClient,
    db_session: Session,
    monkeypatch,
    stream: bool,
) -> None:
    if db_session.get(DirectoryUser, USER) is None:
        db_session.add(
            DirectoryUser(
                user_id=USER,
                email="owner@example.test",
                role="user",
                first_seen_at=datetime.now(UTC),
                last_seen_at=datetime.now(UTC),
            )
        )
        db_session.commit()
    session = create_session(
        api_client, db_session, tool_names=["add"], approval_tool_names=["add"]
    )
    with_saver(api_client)
    model = ObservedScript(
        script=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "add",
                        "args": {"a": 1, "b": 2},
                        "id": "call-add",
                        "type": "tool_call",
                    },
                ],
            ),
            AIMessage(content="Finished."),
        ]
    )
    monkeypatch.setattr("app.agents.runtime.create_chat_model_for_agent", lambda **_: model)
    url = f"/sessions/{session['id']}/messages"
    response = api_client.post(
        f"{url}/stream" if stream else url,
        json={"content": "Private prompt"},
        headers=headers(),
    )
    if stream:
        assert response.status_code == 200, response.text
        pending = next(
            body
            for line in response.text.splitlines()
            if line.startswith("data: ")
            if (body := json.loads(line[6:]))["type"] == "approval.required"
        )
    else:
        assert response.status_code == 202, response.text
        pending = response.json()

    path = f"/users/{USER}/executions/{pending['execution_id']}"
    before = api_client.get(path, headers=headers()).json()
    assert before["status"] == "awaiting_approval"
    assert before["tokens"]["total_tokens"] == 8
    assert len(before["model_calls"]) == 1
    assert before["tool_calls"][0]["status"] == "pending"

    resumed = api_client.post(
        f"/sessions/{session['id']}/approvals/{pending['interrupt_id']}/approve",
        json={"tool_call_id": pending["tool_call_id"]},
        headers=headers(),
    )
    assert resumed.status_code == 200, resumed.text
    assert resumed.json()["execution_id"] == pending["execution_id"]
    finished = api_client.get(path, headers=headers())
    assert finished.status_code == 200, finished.text
    after = finished.json()
    assert after["status"] == "succeeded"
    assert after["tokens"] == {
        "completeness": "complete",
        "input_tokens": 12,
        "output_tokens": 4,
        "total_tokens": 16,
    }
    assert after["model_calls"][0]["id"] == before["model_calls"][0]["id"]
    assert len(after["model_calls"]) == 2
    assert len(after["tool_calls"]) == 1
    assert after["tool_calls"][0]["status"] == "succeeded"
    assert after["tool_calls"][0]["duration_ms"] >= 0
    assert "Private prompt" not in finished.text
    assert "arguments" not in finished.text
