"""Skill catalog API schemas (#23)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class SkillSummaryOut(BaseModel):
    """Catalog discovery: name and description only."""

    model_config = ConfigDict(extra="forbid")

    name: str
    description: str


class SkillResourceOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    label: str = ""


class SkillDetailOut(BaseModel):
    """Operator detail: instructions and descriptive resource refs."""

    model_config = ConfigDict(extra="forbid")

    name: str
    description: str
    instructions: str
    resources: list[SkillResourceOut] = Field(default_factory=list)


class SkillListOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[SkillSummaryOut]
