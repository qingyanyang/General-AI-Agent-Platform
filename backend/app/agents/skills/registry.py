"""In-process skill registry. No DB table; no runtime CRUD (#23)."""

from __future__ import annotations

import re
from dataclasses import dataclass

_SKILL_NAME = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_RESOURCE_ID = re.compile(r"^[a-z][a-z0-9_.-]{0,63}$")
_FORBIDDEN_RESOURCE_PREFIXES = ("http://", "https://", "file:")

LOAD_SKILL_TOOL_NAME = "load_skill"


class SkillRegistryError(Exception):
    """Invalid registry operation (e.g. duplicate registration)."""


class SkillNotRegisteredError(Exception):
    """Raised when a skill name is not in the registry."""

    def __init__(self, name: str) -> None:
        self.name = name
        super().__init__(f"Skill '{name}' is not registered")


class SkillValidationError(Exception):
    """Raised when a skill definition fails validation."""


@dataclass(frozen=True, slots=True)
class ApprovedResource:
    """Descriptive resource reference only. No fetch or filesystem load."""

    id: str
    label: str = ""


@dataclass(frozen=True, slots=True)
class Skill:
    """One curated skill: metadata for the catalog, instructions for load_skill."""

    name: str
    description: str
    instructions: str
    resources: tuple[ApprovedResource, ...] = ()


class SkillRegistry:
    """Register and look up curated skills."""

    def __init__(self) -> None:
        self._skills: dict[str, Skill] = {}

    def register(self, skill: Skill) -> None:
        validated = validate_skill(skill)
        if validated.name in self._skills:
            raise SkillRegistryError(f"Skill already registered: {validated.name}")
        self._skills[validated.name] = validated

    def get(self, name: str) -> Skill:
        try:
            return self._skills[name]
        except KeyError as exc:
            raise SkillNotRegisteredError(name) from exc

    def has(self, name: str) -> bool:
        return name in self._skills

    def list(self) -> list[Skill]:
        return list(self._skills.values())


def validate_skill(skill: Skill) -> Skill:
    """Validate name, description, instructions, and resource ids."""
    if not isinstance(skill, Skill):
        raise SkillValidationError("skill must be a Skill instance")
    name = skill.name.strip() if isinstance(skill.name, str) else ""
    if not _SKILL_NAME.fullmatch(name):
        raise SkillValidationError(
            "skill name must match ^[a-z][a-z0-9_]{0,63}$",
        )
    if name == LOAD_SKILL_TOOL_NAME:
        raise SkillValidationError(f"skill name '{LOAD_SKILL_TOOL_NAME}' is reserved")
    description = skill.description if isinstance(skill.description, str) else ""
    if not description.strip():
        raise SkillValidationError("skill description must be a non-empty string")
    instructions = skill.instructions if isinstance(skill.instructions, str) else ""
    if not instructions.strip():
        raise SkillValidationError("skill instructions must be a non-empty string")
    resources = tuple(_validate_resource(item) for item in skill.resources)
    return Skill(
        name=name,
        description=description.strip(),
        instructions=instructions,
        resources=resources,
    )


def _validate_resource(resource: ApprovedResource) -> ApprovedResource:
    if not isinstance(resource, ApprovedResource):
        raise SkillValidationError("resources must be ApprovedResource instances")
    resource_id = resource.id.strip() if isinstance(resource.id, str) else ""
    lowered = resource_id.lower()
    if any(lowered.startswith(prefix) for prefix in _FORBIDDEN_RESOURCE_PREFIXES):
        raise SkillValidationError("resource id must not be a URL or file URI")
    if "/" in resource_id or "\\" in resource_id:
        raise SkillValidationError("resource id must not be a filesystem path")
    if not _RESOURCE_ID.fullmatch(resource_id):
        raise SkillValidationError(
            "resource id must match ^[a-z][a-z0-9_.-]{0,63}$",
        )
    label = resource.label if isinstance(resource.label, str) else ""
    return ApprovedResource(id=resource_id, label=label.strip())
