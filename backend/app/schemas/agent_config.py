"""Agent configuration API schemas (#20)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator

SYSTEM_PROMPT_MAX_LENGTH = 20_000


class AgentConfigurationIn(BaseModel):
    """PUT body: full configuration replace."""

    model_config = ConfigDict(extra="forbid")

    system_prompt: str = Field(default="", max_length=SYSTEM_PROMPT_MAX_LENGTH)
    llm_provider: str = Field(min_length=1, max_length=32)
    llm_model: str = Field(min_length=1, max_length=128)
    temperature: float | None = None
    tool_names: list[str] = Field(default_factory=list)
    skill_names: list[str] = Field(default_factory=list)

    @field_validator("system_prompt")
    @classmethod
    def exact_prompt_limit(cls, value: str) -> str:
        # Preserve formatting — do not strip. Enforce exact max length only.
        if len(value) > SYSTEM_PROMPT_MAX_LENGTH:
            raise ValueError(
                f"system_prompt must be at most {SYSTEM_PROMPT_MAX_LENGTH} characters",
            )
        return value

    @field_validator("llm_provider")
    @classmethod
    def normalize_provider(cls, value: str) -> str:
        stripped = value.strip().lower()
        if not stripped:
            raise ValueError("llm_provider must be a non-empty string")
        return stripped

    @field_validator("llm_model")
    @classmethod
    def normalize_model(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("llm_model must be a non-empty string")
        return stripped

    @field_validator("tool_names")
    @classmethod
    def unique_tool_names(cls, value: list[str]) -> list[str]:
        return _unique_names(value, field_name="tool_names")

    @field_validator("skill_names")
    @classmethod
    def unique_skill_names(cls, value: list[str]) -> list[str]:
        return _unique_names(value, field_name="skill_names")


class AgentConfigurationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    system_prompt: str
    llm_provider: str
    llm_model: str
    temperature: float | None
    tool_names: list[str]
    skill_names: list[str]


def _unique_names(value: list[str], *, field_name: str) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    label = "tool name" if field_name == "tool_names" else "skill name"
    for raw in value:
        if not isinstance(raw, str):
            raise ValueError(f"{field_name} must be strings")
        name = raw.strip()
        if not name:
            raise ValueError(f"{field_name} must not contain blank entries")
        if name in seen:
            raise ValueError(f"duplicate {label}: {name}")
        seen.add(name)
        cleaned.append(name)
    return cleaned
