"""Production skill-registry construction (#23)."""

from __future__ import annotations

from app.agents.skills.builtins import SEED_SKILLS
from app.agents.skills.registry import SkillRegistry


def create_default_skill_registry() -> SkillRegistry:
    """Build the process skill catalog from seed skills."""
    registry = SkillRegistry()
    for skill in SEED_SKILLS:
        registry.register(skill)
    return registry
