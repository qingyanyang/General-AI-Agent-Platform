"""Published Instruction Skills API schemas (Issue 5)."""

from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, Field, field_validator

NAME_MAX_LENGTH = 120
DESCRIPTION_MAX_LENGTH = 2_000
INSTRUCTIONS_MAX_LENGTH = 20_000
MAX_ITEMS = 50
AGGREGATE_MAX_LENGTH = 50_000


class InstructionSkillItemIn(BaseModel):
    """One published instruction skill in a full-replacement body."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(max_length=NAME_MAX_LENGTH)
    description: str = Field(default="", max_length=DESCRIPTION_MAX_LENGTH)
    instructions: str = Field(max_length=INSTRUCTIONS_MAX_LENGTH)

    @field_validator("name")
    @classmethod
    def trim_and_require_name(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("name must be a non-empty string")
        if len(stripped) > NAME_MAX_LENGTH:
            raise ValueError(f"name must be at most {NAME_MAX_LENGTH} characters")
        return stripped

    @field_validator("description")
    @classmethod
    def trim_description(cls, value: str) -> str:
        stripped = value.strip()
        if len(stripped) > DESCRIPTION_MAX_LENGTH:
            raise ValueError(
                f"description must be at most {DESCRIPTION_MAX_LENGTH} characters",
            )
        return stripped

    @field_validator("instructions")
    @classmethod
    def require_non_whitespace_instructions(cls, value: str) -> str:
        # Preserve accepted text exactly — do not strip.
        if not value or value.isspace():
            raise ValueError("instructions must contain non-whitespace content")
        if len(value) > INSTRUCTIONS_MAX_LENGTH:
            raise ValueError(
                f"instructions must be at most {INSTRUCTIONS_MAX_LENGTH} characters",
            )
        return value


class InstructionSkillsReplaceIn(BaseModel):
    """PUT body: full replacement of the published collection."""

    model_config = ConfigDict(extra="forbid")

    items: list[InstructionSkillItemIn] = Field(default_factory=list, max_length=MAX_ITEMS)

    @field_validator("items")
    @classmethod
    def unique_names_and_aggregate(cls, value: list[InstructionSkillItemIn]) -> list[
        InstructionSkillItemIn
    ]:
        if len(value) > MAX_ITEMS:
            raise ValueError(f"at most {MAX_ITEMS} instruction skills are allowed")
        seen: set[str] = set()
        aggregate = 0
        for item in value:
            key = item.name.casefold()
            if key in seen:
                raise ValueError("instruction skill names must be unique (case-insensitive)")
            seen.add(key)
            aggregate += len(item.name) + len(item.description) + len(item.instructions)
        if aggregate > AGGREGATE_MAX_LENGTH:
            raise ValueError(
                f"combined name, description, and instructions length must be "
                f"at most {AGGREGATE_MAX_LENGTH} characters",
            )
        return value


class InstructionSkillItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str
    instructions: str


class InstructionSkillsOut(BaseModel):
    items: list[InstructionSkillItemOut]
