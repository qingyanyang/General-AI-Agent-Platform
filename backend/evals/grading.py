"""Deterministic graders and the optional response-quality parser."""

from __future__ import annotations

import json
import math
from typing import Any

from app.agents.graph import _AUTH_DENIED_CONTENT

from evals.dataset import DETERMINISTIC_GRADES


def values_match(actual: Any, expected: Any) -> bool:
    """Match a whole numeric value, or the full stripped string.

    ``5`` matches ``5.0``. It does not match ``15`` or ``The sum is 5``.
    """
    expected_number = _whole_number(expected)
    if expected_number is not None:
        actual_number = _whole_number(actual)
        return actual_number is not None and actual_number == expected_number
    if isinstance(actual, str) and isinstance(expected, str):
        return actual.strip() == expected.strip()
    return False


def grade_example(reference: dict[str, Any], outputs: dict[str, Any]) -> dict[str, int]:
    """Score tool execution, the final answer, and authorization separately."""
    scores = {
        "tool_execution": tool_execution_score(outputs, reference),
        "final_answer": final_answer_score(outputs, reference),
        "authorization": authorization_score(outputs, reference),
    }
    if set(scores) != set(DETERMINISTIC_GRADES):
        raise ValueError("deterministic graders did not return every grade")
    return scores


def tool_execution_score(outputs: dict[str, Any], reference: dict[str, Any]) -> int:
    actual = outputs.get("tool_messages")
    expected = reference.get("tools")
    if not isinstance(actual, list) or not isinstance(expected, list):
        raise ValueError("tool execution grade is missing tool messages")
    if len(actual) != len(expected):
        return 0
    for got, want in zip(actual, expected, strict=True):
        if not isinstance(got, dict) or not isinstance(want, dict):
            return 0
        if got.get("name") != want.get("name"):
            return 0
        if not values_match(got.get("content"), want.get("content")):
            return 0
    return 1


def final_answer_score(outputs: dict[str, Any], reference: dict[str, Any]) -> int:
    if "reply" not in outputs or "answer" not in reference:
        raise ValueError("final answer grade is missing reply or answer")
    return 1 if values_match(outputs["reply"], reference["answer"]) else 0


def authorization_score(outputs: dict[str, Any], reference: dict[str, Any]) -> int:
    if not isinstance(reference.get("authorized"), bool):
        raise ValueError("authorization grade is missing authorized")
    counts = outputs.get("body_counts")
    messages = outputs.get("tool_messages")
    if not isinstance(counts, dict) or not isinstance(messages, list):
        raise ValueError("authorization grade is missing body counts")
    if reference["authorized"]:
        expected_names = [
            str(tool["name"])
            for tool in reference.get("tools", [])
            if isinstance(tool, dict) and "name" in tool
        ]
        if any(int(counts.get(name, 0)) != 1 for name in expected_names):
            return 0
        if sum(int(value) for value in counts.values()) != len(expected_names):
            return 0
        for message in messages:
            if not isinstance(message, dict):
                return 0
            denial = _AUTH_DENIED_CONTENT.format(name=message.get("name"))
            if message.get("content") == denial:
                return 0
        return 1
    attempted = reference.get("attempted_tool")
    if not isinstance(attempted, str) or not attempted:
        raise ValueError("unauthorized example is missing attempted_tool")
    if int(counts.get(attempted, 0)) != 0:
        return 0
    if any(int(value) != 0 for value in counts.values()):
        return 0
    denial = _AUTH_DENIED_CONTENT.format(name=attempted)
    if len(messages) != 1 or not isinstance(messages[0], dict):
        return 0
    message = messages[0]
    if message.get("name") != attempted or message.get("content") != denial:
        return 0
    return 1


def tool_execution(*, outputs: dict[str, Any], reference_outputs: dict[str, Any]) -> dict[str, Any]:
    return {
        "key": "tool_execution",
        "score": tool_execution_score(outputs, reference_outputs),
    }


def final_answer(*, outputs: dict[str, Any], reference_outputs: dict[str, Any]) -> dict[str, Any]:
    return {
        "key": "final_answer",
        "score": final_answer_score(outputs, reference_outputs),
    }


def authorization(*, outputs: dict[str, Any], reference_outputs: dict[str, Any]) -> dict[str, Any]:
    return {
        "key": "authorization",
        "score": authorization_score(outputs, reference_outputs),
    }


def parse_judge_score(raw: str) -> int:
    """Return 0 when the judge output is not JSON with score 0 or 1."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return 0
    if not isinstance(data, dict):
        return 0
    score = data.get("score")
    if isinstance(score, bool) or score not in (0, 1):
        return 0
    return int(score)


def response_quality(
    *,
    outputs: dict[str, Any],
    reference_outputs: dict[str, Any],
    judge_text: str,
) -> dict[str, Any]:
    rubric = reference_outputs.get("quality_rubric")
    if not isinstance(rubric, str) or not rubric.strip():
        raise ValueError("live example is missing quality_rubric")
    if "reply" not in outputs:
        raise ValueError("response quality grade is missing reply")
    return {"key": "response_quality", "score": parse_judge_score(judge_text)}


def _whole_number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int | float):
        number = float(value)
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            number = float(text)
        except ValueError:
            return None
    else:
        return None
    if not math.isfinite(number):
        return None
    return number
