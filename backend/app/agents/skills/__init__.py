"""Curated agent skills: registry, seed skills, and prompt helpers (#23)."""

from app.agents.skills.builtins import SEED_SKILLS
from app.agents.skills.factory import create_default_skill_registry
from app.agents.skills.prompt import (
    compose_system_prompt_with_instructions,
    compose_system_prompt_with_skills,
)
from app.agents.skills.registry import (
    LOAD_SKILL_TOOL_NAME,
    ApprovedResource,
    Skill,
    SkillNotRegisteredError,
    SkillRegistry,
    SkillRegistryError,
    SkillValidationError,
)

__all__ = [
    "LOAD_SKILL_TOOL_NAME",
    "SEED_SKILLS",
    "ApprovedResource",
    "Skill",
    "SkillNotRegisteredError",
    "SkillRegistry",
    "SkillRegistryError",
    "SkillValidationError",
    "compose_system_prompt_with_instructions",
    "compose_system_prompt_with_skills",
    "create_default_skill_registry",
]
