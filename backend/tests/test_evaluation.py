"""Deterministic evaluation regression tests (#26)."""

from __future__ import annotations

import asyncio
import os
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
import requests
from app.agents.graph import _AUTH_DENIED_CONTENT
from app.agents.tool_policy import get_tool_auth_context
from app.agents.tools.builtins import add
from app.core.config import Settings
from evals.dataset import EvalExample, load_baseline, load_dataset
from evals.grading import grade_example, parse_judge_score, values_match
from evals.runner import (
    DATASET_NAME,
    EvaluationConfigError,
    format_report,
    run_evaluation,
    score_loaded,
    sync_dataset,
)
from evals.scripted import ScriptedChatModel
from evals.target import run_example
from langchain_core.messages import AIMessage
from langsmith.utils import LangSmithNotFoundError


def test_values_match_rejects_substrings_and_scores_answers_separately() -> None:
    assert values_match("5.0", 5)
    assert values_match("5", 5)
    assert not values_match("15", 5)
    assert not values_match("The sum is 5", 5)
    assert values_match("hello", "hello")
    assert not values_match("say hello", "hello")
    reference = {
        "tools": [{"name": "add", "content": 5}],
        "answer": 5,
        "authorized": True,
    }
    hidden = grade_example(
        reference,
        {
            "reply": "15",
            "tool_messages": [{"name": "add", "content": "5.0"}],
            "body_counts": {"add": 1, "multiply": 0, "echo": 0},
        },
    )
    assert hidden["tool_execution"] == 1
    assert hidden["final_answer"] == 0
    sentence = grade_example(
        reference,
        {
            "reply": "The sum is 5",
            "tool_messages": [{"name": "add", "content": "5.0"}],
            "body_counts": {"add": 1, "multiply": 0, "echo": 0},
        },
    )
    assert sentence["final_answer"] == 0


def test_authorization_requires_zero_body_invocations() -> None:
    reference = {
        "tools": [{"name": "multiply", "content": _AUTH_DENIED_CONTENT.format(name="multiply")}],
        "answer": "I cannot do that.",
        "authorized": False,
        "attempted_tool": "multiply",
    }
    denied = {
        "reply": "I cannot do that.",
        "tool_messages": [
            {"name": "multiply", "content": _AUTH_DENIED_CONTENT.format(name="multiply")}
        ],
        "body_counts": {"add": 0, "multiply": 0, "echo": 0},
    }
    assert grade_example(reference, denied)["authorization"] == 1
    counted = {**denied, "body_counts": {"add": 0, "multiply": 1, "echo": 0}}
    assert grade_example(reference, counted)["authorization"] == 0


def test_judge_parser_accepts_a_score_and_rejects_malformed_output() -> None:
    judge = ScriptedChatModel(script=[AIMessage(content='{"score": 1, "comment": "ok"}')])
    message = judge.invoke("unused")
    assert parse_judge_score(str(message.content)) == 1
    assert parse_judge_score("not json") == 0
    assert parse_judge_score('{"score": 2}') == 0


def test_dataset_denial_text_matches_the_graph() -> None:
    for example in load_dataset():
        if example.outputs.get("authorized") is not False:
            continue
        content = example.outputs["tools"][0]["content"]
        expected = _AUTH_DENIED_CONTENT.format(name=example.outputs["attempted_tool"])
        assert content == expected


def test_deterministic_examples_meet_the_baseline() -> None:
    report = run_evaluation(eval_llm=False)
    assert report.passed, report.failures
    assert report.skipped_live == ["llm-sum"]
    assert "Live model-quality checks: skipped (llm-sum)" in format_report(report)
    assert get_tool_auth_context() is None
    assert add.func.__name__ == "add"


def test_unauthorized_examples_do_not_run_the_tool_body() -> None:
    examples = {example.id: example for example in load_dataset()}
    for example_id in ("multiply-not-assigned", "multiply-missing-permission"):
        prediction = asyncio.run(run_example(examples[example_id]))
        assert prediction["body_counts"]["multiply"] == 0
        assert sum(prediction["body_counts"].values()) == 0
        assert prediction["tool_messages"][0]["content"] == _AUTH_DENIED_CONTENT.format(
            name="multiply",
        )
    assert get_tool_auth_context() is None
    assert add.func.__name__ == "add"


def test_auth_context_resets_when_the_graph_raises() -> None:
    example = EvalExample(
        id="exhausted",
        split="deterministic",
        inputs={
            "message": "hello",
            "allowed_tools": ["add"],
            "permissions": ["agents:execute"],
            "script": [],
        },
        outputs={"tools": [], "answer": "hello", "authorized": True},
    )
    with pytest.raises(RuntimeError, match="script exhausted"):
        asyncio.run(run_example(example))
    assert get_tool_auth_context() is None
    assert add.func.__name__ == "add"


def test_local_mode_emits_no_tracing_requests(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LANGSMITH_TRACING", "true")
    monkeypatch.setenv("LANGSMITH_TRACING_V2", "true")
    monkeypatch.setenv("LANGCHAIN_TRACING_V2", "true")
    calls: list[str] = []

    def reject_request(self: Any, method: str, url: str, *args: Any, **kwargs: Any) -> Any:
        calls.append(f"{method} {url}")
        raise AssertionError(f"tracing request was sent: {method} {url}")

    def reject_send(self: Any, request: Any, *args: Any, **kwargs: Any) -> Any:
        calls.append(str(request.url))
        raise AssertionError(f"tracing request was sent: {request.url}")

    monkeypatch.setattr(requests.Session, "request", reject_request)
    monkeypatch.setattr(httpx.Client, "send", reject_send)
    report = run_evaluation(eval_llm=False)
    assert report.passed, report.failures
    assert calls == []
    assert os.environ["LANGSMITH_TRACING"] == "true"
    assert os.environ["LANGSMITH_TRACING_V2"] == "true"
    assert os.environ["LANGCHAIN_TRACING_V2"] == "true"


def test_upload_does_not_force_tracing_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LANGSMITH_TRACING", raising=False)
    monkeypatch.delenv("LANGSMITH_TRACING_V2", raising=False)
    monkeypatch.delenv("LANGCHAIN_TRACING_V2", raising=False)
    seen: dict[str, str | None] = {}

    def fake_evaluate(*args: Any, **kwargs: Any) -> None:
        seen["tracing"] = os.environ.get("LANGSMITH_TRACING")
        seen["dataset_rows"] = kwargs["data"]

    monkeypatch.setattr("evals.runner.evaluate", fake_evaluate)
    client = _FakeClient()
    report = run_evaluation(upload=True, eval_llm=False, client=client)
    assert report.passed, report.failures
    assert seen["tracing"] is None
    uploaded_ids = {row.metadata["example_id"] for row in seen["dataset_rows"]}
    assert "llm-sum" not in uploaded_ids
    assert "add-two-numbers" in uploaded_ids


def test_missing_live_credentials_fail_clearly() -> None:
    settings = Settings(
        _env_file=None,
        llm_provider="openai",
        llm_api_key=None,
        deepseek_api_key=None,
    )
    with pytest.raises(EvaluationConfigError, match="EVAL_LLM=1 requires credentials"):
        run_evaluation(eval_llm=True, settings=settings)


def test_missing_example_missing_grades_and_grader_errors_fail_the_gate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    examples = load_dataset()
    baseline = load_baseline()
    baseline["missing-one"] = {"tool_execution": 1, "final_answer": 1, "authorization": 1}
    missing = score_loaded(examples, baseline, eval_llm=False)
    assert missing.passed is False
    assert any("missing example: missing-one" in item for item in missing.failures)

    def partial(reference: dict[str, Any], outputs: dict[str, Any]) -> dict[str, int]:
        return {"tool_execution": 1}

    monkeypatch.setattr("evals.runner.grade_example", partial)
    grades = run_evaluation(eval_llm=False)
    assert grades.passed is False
    assert any("missing grades" in item for item in grades.failures)

    def boom(reference: dict[str, Any], outputs: dict[str, Any]) -> dict[str, int]:
        raise RuntimeError("boom")

    monkeypatch.setattr("evals.runner.grade_example", boom)
    exploded = run_evaluation(eval_llm=False)
    assert exploded.passed is False
    assert any("boom" in item for item in exploded.failures)


def test_sync_updates_existing_rows_and_deletes_rows_absent_from_json() -> None:
    examples = load_dataset()
    client = _FakeClient(
        rows=[
            _row("keep", "add-two-numbers"),
            _row("duplicate", "add-two-numbers"),
            _row("obsolete", "removed-from-json"),
            _row("blank", None),
        ],
        dataset_exists=True,
    )
    sync_dataset(client, examples)
    ids = [row.metadata["example_id"] for row in client.rows]
    assert ids.count("add-two-numbers") == 1
    assert "removed-from-json" not in ids
    assert None not in [row.metadata.get("example_id") for row in client.rows]
    assert "duplicate" in client.deleted
    assert "obsolete" in client.deleted
    assert "blank" in client.deleted
    created_first = list(client.created)
    sync_dataset(client, examples)
    assert client.created == created_first
    assert len(client.rows) == len(examples)

    fresh = _FakeClient()
    sync_dataset(fresh, examples)
    assert fresh.dataset_name == DATASET_NAME
    assert len(fresh.rows) == len(examples)


class _Row:
    def __init__(self, row_id: str, example_id: str | None) -> None:
        self.id = row_id
        self.metadata = {"example_id": example_id} if example_id else {}
        self.inputs: dict[str, Any] = {}
        self.outputs: dict[str, Any] = {}


def _row(row_id: str, example_id: str | None) -> _Row:
    return _Row(row_id, example_id)


class _FakeClient:
    def __init__(self, rows: list[_Row] | None = None, dataset_exists: bool = False) -> None:
        self.rows = list(rows or [])
        self.dataset_exists = dataset_exists
        self.created: list[str] = []
        self.deleted: list[str] = []
        self.dataset_name = ""
        self._next = 1

    def read_dataset(self, *, dataset_name: str) -> SimpleNamespace:
        if not self.dataset_exists:
            raise LangSmithNotFoundError(dataset_name)
        return SimpleNamespace(name=dataset_name)

    def create_dataset(self, dataset_name: str, *, description: str | None = None) -> None:
        self.dataset_exists = True
        self.dataset_name = dataset_name

    def list_examples(self, *, dataset_name: str) -> list[_Row]:
        return list(self.rows)

    def create_examples(self, *, dataset_name: str, examples: list[dict[str, Any]]) -> None:
        self.dataset_name = dataset_name
        for item in examples:
            row_id = f"remote-{self._next}"
            self._next += 1
            row = _Row(row_id, item["metadata"]["example_id"])
            row.inputs = item["inputs"]
            row.outputs = item["reference_outputs"]
            row.metadata = item["metadata"]
            self.rows.append(row)
            self.created.append(item["metadata"]["example_id"])

    def update_example(
        self,
        example_id: str,
        *,
        inputs: dict[str, Any],
        outputs: dict[str, Any],
        metadata: dict[str, Any],
    ) -> None:
        for row in self.rows:
            if row.id == example_id:
                row.inputs = inputs
                row.outputs = outputs
                row.metadata = metadata

    def delete_example(self, example_id: str) -> None:
        self.deleted.append(example_id)
        self.rows = [row for row in self.rows if row.id != example_id]
