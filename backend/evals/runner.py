"""Score the checked-in dataset and optionally record it in LangSmith."""

from __future__ import annotations

import asyncio
import os
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any

from app.agents.graph import create_chat_model_for_agent
from app.agents.messages import message_content_text
from app.core.config import Settings, get_settings
from langchain_core.messages import HumanMessage
from langsmith import Client
from langsmith.evaluation import evaluate
from langsmith.run_helpers import tracing_context
from langsmith.utils import LangSmithNotFoundError, get_env_var

from evals.dataset import (
    DETERMINISTIC_GRADES,
    DatasetError,
    EvalExample,
    load_baseline,
    load_dataset,
)
from evals.grading import (
    authorization,
    final_answer,
    grade_example,
    parse_judge_score,
    tool_execution,
)
from evals.target import run_example

DATASET_NAME = "agent-platform-agent-core"
_EXAMPLE_ID = "example_id"
_TRACING_ENV = (
    "LANGSMITH_TRACING",
    "LANGSMITH_TRACING_V2",
    "LANGCHAIN_TRACING_V2",
)
_JUDGE_INTRO = (
    "Score the assistant reply against the rubric. "
    'Reply with JSON only: {"score": 0 or 1, "comment": "short reason"}.\n'
)


class EvaluationConfigError(Exception):
    """The requested optional run cannot start."""


@dataclass
class EvaluationReport:
    passed: bool
    failures: list[str] = field(default_factory=list)
    deterministic: list[dict[str, Any]] = field(default_factory=list)
    skipped_live: list[str] = field(default_factory=list)
    live: list[dict[str, Any]] = field(default_factory=list)
    live_errors: list[str] = field(default_factory=list)


def run_evaluation(
    *,
    upload: bool = False,
    eval_llm: bool | None = None,
    client: Any | None = None,
    settings: Settings | None = None,
) -> EvaluationReport:
    """Run deterministic regression tests. Live examples are opt-in.

    Local scoring suppresses tracing. ``--upload`` does not turn tracing on.
    """
    resolved = settings or get_settings()
    live = _env_flag_enabled() if eval_llm is None else eval_llm
    if live and not _llm_credentials(resolved):
        raise EvaluationConfigError(
            "EVAL_LLM=1 requires credentials for the configured LLM provider. "
            "Set LLM_API_KEY, or DEEPSEEK_API_KEY when LLM_PROVIDER is deepseek. "
            "Live examples were not run.",
        )
    if upload and client is None and not _langsmith_key(resolved):
        raise EvaluationConfigError(
            "LANGSMITH_API_KEY is required to upload evaluation results to the "
            f"evaluation-owned dataset {DATASET_NAME}.",
        )
    try:
        examples = load_dataset()
        baseline = load_baseline()
    except DatasetError as exc:
        return EvaluationReport(passed=False, failures=str(exc).splitlines())

    coverage = _coverage_failures(examples, baseline)
    if coverage:
        return EvaluationReport(passed=False, failures=coverage)

    with _suppress_tracing():
        report = asyncio.run(_score(examples, baseline, live=live))
    if upload:
        langsmith = client if client is not None else Client(api_key=_langsmith_key(resolved))
        _upload(langsmith, examples, include_live=live)
    return report


def score_loaded(
    examples: list[EvalExample],
    baseline: dict[str, dict[str, int]],
    *,
    eval_llm: bool = False,
) -> EvaluationReport:
    """Score an in-memory dataset. Used by tests of the regression gate."""
    coverage = _coverage_failures(examples, baseline)
    if coverage:
        return EvaluationReport(passed=False, failures=coverage)
    with _suppress_tracing():
        return asyncio.run(_score(examples, baseline, live=eval_llm))


def sync_dataset(client: Any, examples: list[EvalExample]) -> None:
    """Make the remote dataset match the checked-in JSON.

    ``agent-platform-agent-core`` is evaluation-owned. Examples absent from the
    JSON, including duplicate ids, are deleted.
    """
    try:
        client.read_dataset(dataset_name=DATASET_NAME)
    except LangSmithNotFoundError:
        client.create_dataset(
            DATASET_NAME,
            description=(
                "Evaluation-owned dataset for the agent platform. "
                "Synchronization deletes remote examples that are not in the checked-in JSON."
            ),
        )
    grouped: dict[str, list[Any]] = {}
    unkeyed: list[Any] = []
    for remote in list(client.list_examples(dataset_name=DATASET_NAME)):
        key = _remote_example_id(remote)
        if key is None:
            unkeyed.append(remote)
        else:
            grouped.setdefault(key, []).append(remote)
    for remote in unkeyed:
        client.delete_example(remote.id)
    local_ids = {example.id for example in examples}
    for key, rows in grouped.items():
        if key not in local_ids:
            for remote in rows:
                client.delete_example(remote.id)
    for example in examples:
        payload = _langsmith_example(example)
        rows = grouped.get(example.id, [])
        if not rows:
            client.create_examples(dataset_name=DATASET_NAME, examples=[payload])
            continue
        client.update_example(
            rows[0].id,
            inputs=payload["inputs"],
            outputs=payload["reference_outputs"],
            metadata=payload["metadata"],
        )
        for extra in rows[1:]:
            client.delete_example(extra.id)


def format_report(report: EvaluationReport) -> str:
    lines = [
        "Deterministic regression tests (graph execution, authorization, and graders).",
        "These scores are not model-quality measurements.",
    ]
    for row in report.deterministic:
        scores = " ".join(f"{name}={row['scores'][name]}" for name in DETERMINISTIC_GRADES)
        lines.append(f"{row['id']}  {scores}")
    if report.skipped_live:
        names = ", ".join(report.skipped_live)
        lines.append(f"Live model-quality checks: skipped ({names}). Set EVAL_LLM=1 to run them.")
    if report.live or report.live_errors:
        lines.append("Live model-quality scores (outside the deterministic baseline gate):")
        for row in report.live:
            rendered = " ".join(f"{name}={score}" for name, score in row["scores"].items())
            lines.append(f"{row['id']}  {rendered}")
        for error in report.live_errors:
            lines.append(f"live error: {error}")
    if report.failures:
        lines.append("Regression gate failed:")
        lines.extend(f"- {failure}" for failure in report.failures)
    elif report.passed:
        lines.append("Regression gate passed.")
    return "\n".join(lines)


@contextmanager
def _suppress_tracing() -> Iterator[None]:
    """Force tracing off for local scoring, then restore the previous settings.

    ``tracing_context(enabled=False)`` stops the SDK from posting runs even if a
    cached environment value said tracing was on. This does not change tracing
    for a later upload.
    """
    previous = {name: os.environ.get(name) for name in _TRACING_ENV}
    try:
        for name in _TRACING_ENV:
            os.environ[name] = "false"
        get_env_var.cache_clear()
        with tracing_context(enabled=False):
            yield
    finally:
        for name, value in previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
        get_env_var.cache_clear()


async def _score(
    examples: list[EvalExample],
    baseline: dict[str, dict[str, int]],
    *,
    live: bool,
) -> EvaluationReport:
    deterministic = [example for example in examples if example.split == "deterministic"]
    live_examples = [example for example in examples if example.split == "llm"]
    failures: list[str] = []
    rows: list[dict[str, Any]] = []
    for example in deterministic:
        try:
            prediction = await run_example(example)
            scores = grade_example(example.outputs, prediction)
        except Exception as exc:  # noqa: BLE001 — a grader or graph failure fails the gate
            failures.append(f"{example.id}: {type(exc).__name__}: {exc}")
            continue
        if set(scores) != set(baseline[example.id]):
            failures.append(f"{example.id}: missing grades")
            continue
        for name in DETERMINISTIC_GRADES:
            if scores[name] != baseline[example.id][name]:
                expected = baseline[example.id][name]
                failures.append(f"{example.id} {name}: expected {expected}, got {scores[name]}")
        rows.append({"id": example.id, "scores": scores})
    live_rows: list[dict[str, Any]] = []
    live_errors: list[str] = []
    skipped = [example.id for example in live_examples]
    if live:
        skipped = []
        for example in live_examples:
            try:
                prediction = await run_example(example)
                scores = grade_example(example.outputs, prediction)
                scores["response_quality"] = _response_quality(example, prediction)
            except Exception as exc:  # noqa: BLE001 — live failures stay outside the gate
                live_errors.append(f"{example.id}: {type(exc).__name__}: {exc}")
                continue
            live_rows.append({"id": example.id, "scores": scores})
    return EvaluationReport(
        passed=not failures,
        failures=failures,
        deterministic=rows,
        skipped_live=skipped,
        live=live_rows,
        live_errors=live_errors,
    )


def _response_quality(example: EvalExample, prediction: dict[str, Any]) -> int:
    settings = get_settings()
    model = create_chat_model_for_agent(
        provider=settings.llm_provider,
        model=settings.llm_model,
        temperature=0,
    )
    rubric = str(example.outputs["quality_rubric"])
    prompt = f"{_JUDGE_INTRO}Rubric: {rubric}\nReply: {prediction['reply']}"
    message = model.invoke([HumanMessage(content=prompt)])
    return parse_judge_score(message_content_text(message))


def _upload(client: Any, examples: list[EvalExample], *, include_live: bool) -> None:
    sync_dataset(client, examples)
    selected = {
        example.id for example in examples if example.split == "deterministic" or include_live
    }
    data = [
        remote
        for remote in list(client.list_examples(dataset_name=DATASET_NAME))
        if _remote_example_id(remote) in selected
    ]
    evaluate(
        _predict,
        data=data,
        evaluators=[tool_execution, final_answer, authorization],
        experiment_prefix="agent-core",
        description=(
            "Deterministic agent-graph regression. "
            "Not a model-quality benchmark unless live examples were included."
        ),
        num_repetitions=1,
        max_concurrency=1,
        upload_results=True,
        client=client,
    )


def _predict(inputs: dict[str, Any]) -> dict[str, Any]:
    example = EvalExample(
        id=str(inputs.get("example_id") or ""),
        split=inputs.get("split") or "deterministic",
        inputs=inputs,
        outputs={},
    )
    return asyncio.run(run_example(example))


def _langsmith_example(example: EvalExample) -> dict[str, Any]:
    return {
        "inputs": {**example.inputs, "split": example.split, "example_id": example.id},
        "reference_outputs": example.outputs,
        "metadata": {_EXAMPLE_ID: example.id, "split": example.split},
    }


def _remote_example_id(remote: Any) -> str | None:
    metadata = getattr(remote, "metadata", None) or {}
    key = metadata.get(_EXAMPLE_ID)
    if isinstance(key, str) and key:
        return key
    return None


def _coverage_failures(
    examples: list[EvalExample],
    baseline: dict[str, dict[str, int]],
) -> list[str]:
    failures: list[str] = []
    deterministic = [example for example in examples if example.split == "deterministic"]
    if not deterministic:
        failures.append("dataset has no deterministic examples")
    det_ids = {example.id for example in deterministic}
    base_ids = set(baseline)
    for example_id in sorted(base_ids - det_ids):
        failures.append(f"missing example: {example_id}")
    for example_id in sorted(det_ids - base_ids):
        failures.append(f"missing baseline grade: {example_id}")
    for example in examples:
        if example.split == "llm" and example.id in base_ids:
            failures.append(f"live example is in the deterministic baseline: {example.id}")
    for example_id, grades in baseline.items():
        if set(grades) != set(DETERMINISTIC_GRADES):
            failures.append(f"missing grades: {example_id}")
    return failures


def _env_flag_enabled() -> bool:
    return os.environ.get("EVAL_LLM") == "1"


def _llm_credentials(settings: Settings) -> bool:
    return bool(settings.resolve_llm_api_key_for_provider(settings.llm_provider))


def _langsmith_key(settings: Settings) -> str:
    configured = (settings.langsmith_api_key or "").strip()
    if configured:
        return configured
    return (os.environ.get("LANGSMITH_API_KEY") or "").strip()
