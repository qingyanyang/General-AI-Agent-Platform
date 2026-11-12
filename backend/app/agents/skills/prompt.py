"""Compose ephemeral system prompts that advertise assigned skills (#23)."""

from __future__ import annotations

from app.agents.skills.registry import LOAD_SKILL_TOOL_NAME, Skill

_CATALOG_HEADER = (
    "Available skills (names and descriptions only). "
    f"Call the `{LOAD_SKILL_TOOL_NAME}` tool with a skill name to load full "
    "instructions. Do not invent skill names."
)


def compose_system_prompt_with_skills(
    system_prompt: str,
    skills: list[Skill],
) -> str:
    """Append an assigned-skills catalog. Empty skills leaves the prompt unchanged."""
    base = system_prompt or ""
    if not skills:
        return base
    lines = [_CATALOG_HEADER]
    for skill in skills:
        lines.append(f"- {skill.name}: {skill.description}")
    catalog = "\n".join(lines)
    if not base:
        return catalog
    return f"{base}\n\n{catalog}"
