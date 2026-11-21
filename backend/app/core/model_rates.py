"""Operator-supplied rates per million tokens. No provider price defaults."""

from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Rate = Annotated[Decimal, Field(ge=0, max_digits=20, decimal_places=12)]


class ModelRate(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    provider: str = Field(min_length=1, max_length=32)
    model: str = Field(min_length=1, max_length=128)
    reported_models: tuple[str, ...] = ()
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    source: str = Field(min_length=1, max_length=256)
    effective_from: str = Field(min_length=1, max_length=32)
    input_per_million: Rate
    output_per_million: Rate
    cache_pricing: Literal["flat", "separate"] = "separate"
    cached_input_per_million: Rate | None = None
    cache_write_per_million: Rate | None = None


def estimate_cost(
    rate: ModelRate,
    *,
    input_tokens: int | None,
    output_tokens: int | None,
    cache_read: int | None,
    cache_write: int | None,
) -> Decimal | None:
    if input_tokens is None or output_tokens is None:
        return None
    if rate.cache_pricing == "flat":
        return (
            input_tokens * rate.input_per_million + output_tokens * rate.output_per_million
        ) / 1_000_000
    if cache_read is None or (rate.cache_write_per_million is not None and cache_write is None):
        return None
    written = cache_write or 0
    if cache_read + written > input_tokens:
        return None
    if (cache_read and rate.cached_input_per_million is None) or (
        written and rate.cache_write_per_million is None
    ):
        return None
    return (
        (input_tokens - cache_read - written) * rate.input_per_million
        + cache_read * (rate.cached_input_per_million or Decimal(0))
        + written * (rate.cache_write_per_million or Decimal(0))
        + output_tokens * rate.output_per_million
    ) / 1_000_000
