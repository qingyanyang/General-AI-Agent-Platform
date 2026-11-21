"""Per-execution accounting. Provider observations never contain message content."""

from __future__ import annotations

import asyncio
import logging
import re
import time
import uuid
from collections.abc import Callable
from contextlib import AbstractContextManager, asynccontextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import localcontext
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.model_rates import ModelRate, estimate_cost
from app.models.agent_execution import AgentExecution
from app.models.execution_usage import ExecutionModelCall, ExecutionToolCall

logger = logging.getLogger(__name__)
_WRITE_TIMEOUT = 3
_SAFE_LABEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9_./:-]{0,127}")


def _count(value: object) -> int | None:
    return value if type(value) is int and 0 <= value < 2**63 else None


@dataclass
class ModelObservation:
    provider: str
    reported_model: str | None = None
    response_id: str | None = None  # In memory only, for detecting distinct responses.
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None
    cache_read: int | None = None
    cache_write: int | None = None
    service_tier: str | None = None
    incomplete: bool = False

    def observe(self, response: dict[str, Any]) -> None:
        model = response.get("model")
        if isinstance(model, str) and _SAFE_LABEL.fullmatch(model):
            self.reported_model = model
        tier = response.get("service_tier")
        if isinstance(tier, str):
            self.service_tier = tier

        response_id = response.get("id")
        if isinstance(response_id, str) and response_id:
            if self.response_id is not None and self.response_id != response_id:
                self.incomplete = True
            self.response_id = response_id

        usage = response.get("usage")
        if not isinstance(usage, dict) or not usage:
            return
        details = usage.get("prompt_tokens_details")
        details = details if isinstance(details, dict) else {}
        read = _count(details.get("cached_tokens"))
        if self.provider == "deepseek":
            hit = _count(usage.get("prompt_cache_hit_tokens"))
            if hit is not None and read is not None and hit != read:
                self.incomplete = True
            if read is None:
                read = hit
        # Both providers emit cumulative usage. Replace the snapshot, never add it.
        self.input_tokens = _count(usage.get("prompt_tokens"))
        self.output_tokens = _count(usage.get("completion_tokens"))
        self.total_tokens = _count(usage.get("total_tokens"))
        self.cache_read = read
        self.cache_write = _count(details.get("cache_write_tokens"))
        if (
            self.input_tokens is not None
            and self.cache_read is not None
            and self.cache_read + (self.cache_write or 0) > self.input_tokens
        ):
            self.incomplete = True
        if None not in (self.input_tokens, self.output_tokens, self.total_tokens):
            if self.total_tokens != (self.input_tokens or 0) + (self.output_tokens or 0):
                self.incomplete = True


_active_model: ContextVar[ModelObservation | None] = ContextVar("usage_model", default=None)
active_usage: ContextVar[UsageRecorder | None] = ContextVar("execution_usage", default=None)


def observe_provider_response(response: dict[str, Any]) -> None:
    observation = _active_model.get()
    if observation is not None:
        observation.observe(response)


class UsageRecorder:
    def __init__(
        self,
        open_session: Callable[[], AbstractContextManager[Session]],
        *,
        execution_id: uuid.UUID,
        provider: str,
        model: str,
    ) -> None:
        self.open_session = open_session
        self.execution_id = execution_id
        self.provider = provider
        self.model = model
        self.incomplete = False

    def _commit(self, change: Callable[[Session], None]) -> None:
        with self.open_session() as db:
            if db.get_bind().dialect.name == "postgresql":
                db.execute(text("SET LOCAL statement_timeout = '2s'"))
            change(db)
            db.commit()

    async def _write(self, change: Callable[[Session], None]) -> None:
        def commit() -> bool:
            try:
                self._commit(change)
            except Exception:
                # Driver exception text may include connection details or SQL parameters.
                logger.warning("Could not persist usage for execution %s", self.execution_id)
                return False
            return True

        job = asyncio.create_task(asyncio.to_thread(commit))
        try:
            if not await asyncio.wait_for(asyncio.shield(job), timeout=_WRITE_TIMEOUT):
                self.incomplete = True
        except TimeoutError:
            self.incomplete = True
        except asyncio.CancelledError:
            # Let the in-flight transaction settle before propagating cancellation.
            try:
                if not await asyncio.wait_for(asyncio.shield(job), timeout=_WRITE_TIMEOUT):
                    self.incomplete = True
            except (TimeoutError, asyncio.CancelledError):
                self.incomplete = True
            raise

    async def begin(self, *, resumed: bool) -> None:
        if not resumed:
            return

        def start_segment(db: Session) -> None:
            execution = db.get(AgentExecution, self.execution_id)
            if execution is not None:
                # A historical or unfinalized earlier segment makes the run incomplete.
                execution.usage_capture = (
                    "pending" if execution.usage_capture == "complete" else "incomplete"
                )

        await self._write(start_segment)

    async def finish(self) -> None:
        def finish_segment(db: Session) -> None:
            execution = db.get(AgentExecution, self.execution_id)
            if execution is not None and execution.usage_capture != "incomplete":
                execution.usage_capture = "incomplete" if self.incomplete else "complete"

        await self._write(finish_segment)

    def _rate(self) -> ModelRate | None:
        # This object is immutable. Later calls can select a different catalog snapshot.
        return next(
            (
                rate
                for rate in get_settings().llm_rate_catalog
                if rate.provider == self.provider and rate.model == self.model
            ),
            None,
        )

    @asynccontextmanager
    async def model_call(self):
        call_id = uuid.uuid4()
        started = datetime.now(UTC)
        timer = time.monotonic()
        rate = self._rate()
        snapshot = rate.model_dump(mode="json") if rate else None

        def persist_start(db: Session) -> None:
            db.add(
                ExecutionModelCall(
                    id=call_id,
                    execution_id=self.execution_id,
                    provider=self.provider,
                    requested_model=self.model,
                    started_at=started,
                    status="running",
                    pricing_snapshot=snapshot,
                    currency=rate.currency if rate else None,
                )
            )

        observation = ModelObservation(self.provider)
        token = _active_model.set(observation)
        status = "failed"
        try:
            await self._write(persist_start)
            timer = time.monotonic()
            yield
            status = "succeeded"
        except asyncio.CancelledError:
            status = "cancelled"
            raise
        finally:
            _active_model.reset(token)
            duration = int((time.monotonic() - timer) * 1000)
            cost = None
            if (
                rate is not None
                and observation.service_tier in (None, "default")
                and observation.reported_model in (None, rate.model, *rate.reported_models)
                and not observation.incomplete
            ):
                with localcontext() as decimal_context:
                    decimal_context.prec = 50
                    cost = estimate_cost(
                        rate,
                        input_tokens=observation.input_tokens,
                        output_tokens=observation.output_tokens,
                        cache_read=observation.cache_read,
                        cache_write=observation.cache_write,
                    )

            def persist_end(db: Session) -> None:
                db.merge(
                    ExecutionModelCall(
                        id=call_id,
                        execution_id=self.execution_id,
                        provider=self.provider,
                        requested_model=self.model,
                        reported_model=observation.reported_model,
                        started_at=started,
                        duration_ms=duration,
                        status=status,
                        input_tokens=observation.input_tokens,
                        output_tokens=observation.output_tokens,
                        total_tokens=observation.total_tokens,
                        cached_input_tokens=observation.cache_read,
                        cache_write_tokens=observation.cache_write,
                        usage_incomplete=observation.incomplete,
                        pricing_snapshot=snapshot,
                        estimated_cost=cost,
                        currency=rate.currency if rate else None,
                    )
                )

            await self._write(persist_end)

    async def record_tool(
        self,
        call_key: str,
        name: str,
        status: str,
        *,
        started_at: datetime | None = None,
        duration_ms: int | None = None,
    ) -> None:
        key = uuid.uuid5(self.execution_id, call_key)

        def persist(db: Session) -> None:
            existing = db.get(ExecutionToolCall, key)
            if existing is not None and status == "pending":
                return  # A resumed graph can revisit a previously announced call.
            db.merge(
                ExecutionToolCall(
                    id=key,
                    execution_id=self.execution_id,
                    name=name,
                    status=status,
                    duration_ms=duration_ms,
                    started_at=started_at
                    or (existing.started_at if existing else datetime.now(UTC)),
                )
            )

        await self._write(persist)
