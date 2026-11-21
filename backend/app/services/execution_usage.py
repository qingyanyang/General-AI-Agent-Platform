"""Build bounded Usage projections from persisted call observations."""

from collections import defaultdict
from collections.abc import Sequence
from decimal import Decimal, localcontext
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.agent_execution import AgentExecution
from app.models.execution_usage import ExecutionModelCall, ExecutionToolCall
from app.schemas.agent_execution import (
    CurrencyCostOut,
    EstimatedCostOut,
    ExecutionOut,
    ExecutionUsageDetailOut,
    ExecutionUsageItemOut,
    ModelCallOut,
    TokenUsageOut,
    ToolCallOut,
    UsageCompleteness,
    UsedModelOut,
)


def _completeness(
    *,
    captured: bool,
    any_known: bool,
    all_known: bool,
) -> UsageCompleteness:
    if not captured:
        return UsageCompleteness.NOT_CAPTURED
    if not any_known:
        return UsageCompleteness.UNKNOWN
    return UsageCompleteness.COMPLETE if all_known else UsageCompleteness.PARTIAL


def _sum_known(values: Sequence[int | None]) -> int | None:
    known = [value for value in values if value is not None]
    return sum(known) if known else None


def _tokens(
    calls: Sequence[ExecutionModelCall],
    *,
    captured: bool,
    coverage_complete: bool,
) -> TokenUsageOut:
    counts = (
        _sum_known([call.input_tokens for call in calls]),
        _sum_known([call.output_tokens for call in calls]),
        _sum_known([call.total_tokens for call in calls]),
    )
    return TokenUsageOut(
        completeness=_completeness(
            captured=captured,
            any_known=any(count is not None for count in counts),
            all_known=coverage_complete
            and all(
                not call.usage_incomplete
                and call.input_tokens is not None
                and call.output_tokens is not None
                and call.total_tokens is not None
                for call in calls
            ),
        ),
        input_tokens=counts[0],
        output_tokens=counts[1],
        total_tokens=counts[2],
    )


def _cost(
    calls: Sequence[ExecutionModelCall],
    *,
    captured: bool,
    coverage_complete: bool,
) -> EstimatedCostOut:
    amounts: dict[str, Decimal] = defaultdict(Decimal)
    priced_calls = 0
    with localcontext() as context:
        context.prec = 50
        for call in calls:
            if call.currency is not None and call.estimated_cost is not None:
                amounts[call.currency] += call.estimated_cost
                priced_calls += 1
    return EstimatedCostOut(
        completeness=_completeness(
            captured=captured,
            any_known=bool(amounts),
            all_known=coverage_complete and priced_calls == len(calls),
        ),
        totals=[
            CurrencyCostOut(currency=currency, amount=amount)
            for currency, amount in sorted(amounts.items())
        ],
    )


def _item(execution: AgentExecution, calls: Sequence[ExecutionModelCall]) -> ExecutionUsageItemOut:
    captured = execution.usage_capture is not None
    complete = execution.usage_capture == "complete"
    models = dict.fromkeys(
        (call.provider, call.reported_model or call.requested_model) for call in calls
    )
    return ExecutionUsageItemOut(
        **ExecutionOut.model_validate(execution).model_dump(),
        models=[UsedModelOut(provider=provider, model=model) for provider, model in models],
        tokens=_tokens(calls, captured=captured, coverage_complete=complete),
        estimated_model_cost=_cost(calls, captured=captured, coverage_complete=complete),
    )


def _model_calls(db: Session, ids: Sequence[UUID]) -> dict[UUID, list[ExecutionModelCall]]:
    grouped: dict[UUID, list[ExecutionModelCall]] = defaultdict(list)
    if not ids:
        return grouped
    for call in db.scalars(
        select(ExecutionModelCall)
        .where(ExecutionModelCall.execution_id.in_(ids))
        .order_by(ExecutionModelCall.started_at, ExecutionModelCall.id),
    ):
        grouped[call.execution_id].append(call)
    return grouped


def list_usage(db: Session, executions: Sequence[AgentExecution]) -> list[ExecutionUsageItemOut]:
    calls = _model_calls(db, [execution.id for execution in executions])
    return [_item(execution, calls[execution.id]) for execution in executions]


def usage_detail(db: Session, execution: AgentExecution) -> ExecutionUsageDetailOut:
    calls = _model_calls(db, [execution.id])[execution.id]
    tools = db.scalars(
        select(ExecutionToolCall)
        .where(ExecutionToolCall.execution_id == execution.id)
        .order_by(ExecutionToolCall.started_at, ExecutionToolCall.id),
    )
    return ExecutionUsageDetailOut(
        **_item(execution, calls).model_dump(),
        model_calls=[
            ModelCallOut(
                id=call.id,
                provider=call.provider,
                requested_model=call.requested_model,
                reported_model=call.reported_model,
                started_at=call.started_at,
                status=call.status,
                duration_ms=call.duration_ms,
                tokens=_tokens([call], captured=True, coverage_complete=True),
                cached_input_tokens=call.cached_input_tokens,
                cache_write_tokens=call.cache_write_tokens,
                estimated_model_cost=_cost([call], captured=True, coverage_complete=True),
                pricing_snapshot=call.pricing_snapshot,
            )
            for call in calls
        ],
        tool_calls=[ToolCallOut.model_validate(tool) for tool in tools],
    )
