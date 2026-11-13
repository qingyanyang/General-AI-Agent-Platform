"""Run deterministic evaluation from the command line."""

from __future__ import annotations

import argparse
import sys

from evals.runner import EvaluationConfigError, format_report, run_evaluation


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Run deterministic agent-graph regression tests. "
            "Live model-quality examples stay skipped unless EVAL_LLM=1."
        ),
    )
    parser.add_argument(
        "--upload",
        action="store_true",
        help=(
            "Sync the evaluation-owned dataset agent-platform-agent-core and record "
            "an experiment. Remote examples absent from the checked-in JSON are deleted. "
            "Does not turn tracing on."
        ),
    )
    args = parser.parse_args(argv)
    try:
        report = run_evaluation(upload=args.upload)
    except EvaluationConfigError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    print(format_report(report))
    return 0 if report.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
