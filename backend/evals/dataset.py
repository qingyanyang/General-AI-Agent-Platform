"""Load the checked-in evaluation dataset and baseline."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Never

_ROOT = Path(__file__).resolve().parent
DATASET_PATH = _ROOT / "datasets" / "agent_core.json"
BASELINE_PATH = _ROOT / "baseline.json"

DETERMINISTIC_GRADES = ("authorization", "final_answer", "tool_execution")
SplitName = Literal["deterministic", "llm"]


class DatasetError(Exception):
    """The checked-in dataset or baseline cannot be used."""


@dataclass(frozen=True, slots=True)
class EvalExample:
    id: str
    split: SplitName
    inputs: dict[str, Any]
    outputs: dict[str, Any]


def load_dataset() -> list[EvalExample]:
    raw = json.loads(DATASET_PATH.read_text(encoding="utf-8"))
    examples, errors = parse_examples(raw)
    if errors:
        raise DatasetError("\n".join(errors))
    return examples


def load_baseline() -> dict[str, dict[str, int]]:
    raw = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or not isinstance(raw.get("examples"), dict):
        raise DatasetError("baseline must contain an examples object")
    baseline: dict[str, dict[str, int]] = {}
    errors: list[str] = []
    for example_id, grades in raw["examples"].items():
        if not isinstance(example_id, str) or not example_id:
            errors.append("baseline example id must be a non-empty string")
            continue
        parsed, grade_errors = _parse_grades(example_id, grades)
        errors.extend(grade_errors)
        if parsed is not None:
            baseline[example_id] = parsed
    if errors:
        raise DatasetError("\n".join(errors))
    return baseline


def parse_examples(raw: object) -> tuple[list[EvalExample], list[str]]:
    if not isinstance(raw, dict) or not isinstance(raw.get("examples"), list):
        return [], ["evaluation dataset must contain an examples list"]
    examples: list[EvalExample] = []
    errors: list[str] = []
    seen: set[str] = set()
    for index, item in enumerate(raw["examples"]):
        example, item_errors = _parse_example(index, item)
        errors.extend(item_errors)
        if example is None:
            continue
        if example.id in seen:
            errors.append(f"duplicate example id: {example.id}")
            continue
        seen.add(example.id)
        examples.append(example)
    return examples, errors


def _parse_example(index: int, item: object) -> tuple[EvalExample | None, list[str]]:
    label = f"example[{index}]"
    if not isinstance(item, dict):
        return None, [f"{label} must be an object"]
    errors: list[str] = []
    example_id = item.get("id")
    if not isinstance(example_id, str) or not example_id.strip():
        errors.append(f"{label} is missing id")
        example_id = ""
    else:
        example_id = example_id.strip()
        label = example_id
    split = item.get("split")
    if split not in {"deterministic", "llm"}:
        errors.append(f"{label} split must be deterministic or llm")
    inputs = item.get("inputs")
    outputs = item.get("outputs")
    if not isinstance(inputs, dict):
        errors.append(f"{label} is missing inputs")
        inputs = {}
    if not isinstance(outputs, dict):
        errors.append(f"{label} is missing outputs")
        outputs = {}
    errors.extend(_validate_inputs(label, inputs, split if isinstance(split, str) else ""))
    errors.extend(_validate_outputs(label, outputs, split if isinstance(split, str) else ""))
    if errors:
        return None, errors
    match split:
        case "deterministic":
            parsed_split: SplitName = "deterministic"
        case "llm":
            parsed_split = "llm"
        case _ as unreachable:
            never_split: Never = unreachable
            raise AssertionError(never_split)
    return EvalExample(
        id=str(example_id),
        split=parsed_split,
        inputs=inputs,
        outputs=outputs,
    ), errors


def _validate_inputs(label: str, inputs: dict[str, Any], split: str) -> list[str]:
    errors: list[str] = []
    message = inputs.get("message")
    if not isinstance(message, str) or not message.strip():
        errors.append(f"{label} is missing inputs.message")
    if not isinstance(inputs.get("allowed_tools"), list):
        errors.append(f"{label} is missing inputs.allowed_tools")
    if not isinstance(inputs.get("permissions"), list):
        errors.append(f"{label} is missing inputs.permissions")
    script = inputs.get("script")
    if split == "deterministic" and (not isinstance(script, list) or not script):
        errors.append(f"{label} deterministic example is missing a script")
    return errors


def _validate_outputs(label: str, outputs: dict[str, Any], split: str) -> list[str]:
    errors: list[str] = []
    if "answer" not in outputs:
        errors.append(f"{label} is missing outputs.answer")
    tools = outputs.get("tools")
    if not isinstance(tools, list):
        errors.append(f"{label} is missing outputs.tools")
    elif any(
        not isinstance(tool, dict) or "name" not in tool or "content" not in tool for tool in tools
    ):
        errors.append(f"{label} tool expectations need name and content")
    if not isinstance(outputs.get("authorized"), bool):
        errors.append(f"{label} is missing outputs.authorized")
    elif outputs["authorized"] is False:
        attempted = outputs.get("attempted_tool")
        if not isinstance(attempted, str) or not attempted:
            errors.append(f"{label} unauthorized example is missing attempted_tool")
    if split == "llm":
        rubric = outputs.get("quality_rubric")
        if not isinstance(rubric, str) or not rubric.strip():
            errors.append(f"{label} live example is missing quality_rubric")
    return errors


def _parse_grades(
    example_id: str,
    grades: object,
) -> tuple[dict[str, int] | None, list[str]]:
    if not isinstance(grades, dict):
        return None, [f"{example_id} baseline grades must be an object"]
    expected = set(DETERMINISTIC_GRADES)
    actual = set(grades)
    if actual != expected:
        missing = ", ".join(sorted(expected - actual))
        extra = ", ".join(sorted(actual - expected))
        detail = []
        if missing:
            detail.append(f"missing {missing}")
        if extra:
            detail.append(f"unexpected {extra}")
        return None, [f"{example_id} baseline grades: {'; '.join(detail)}"]
    parsed: dict[str, int] = {}
    errors: list[str] = []
    for name in DETERMINISTIC_GRADES:
        value = grades[name]
        if value not in (0, 1) or isinstance(value, bool):
            errors.append(f"{example_id} baseline {name} must be 0 or 1")
            continue
        parsed[name] = value
    if errors:
        return None, errors
    return parsed, []
