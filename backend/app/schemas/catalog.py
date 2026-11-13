"""Read-only catalogs for the management UI (#28)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class ToolCatalogItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    description: str


class ToolCatalogOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[ToolCatalogItem]


class LlmModelOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str
    model: str
    temperature_min: float | None = None
    temperature_max: float | None = None


class LlmModelListOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[LlmModelOut] = Field(default_factory=list)
