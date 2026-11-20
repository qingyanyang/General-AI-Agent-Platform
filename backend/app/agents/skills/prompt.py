"""Compose ephemeral system prompts that advertise assigned skills (#23)."""

from __future__ import annotations

from collections.abc import Sequence

from app.agents.instructions import PublishedInstructionSkill
from app.agents.skills.registry import LOAD_SKILL_TOOL_NAME, Skill

_CATALOG_HEADER = (
    "Available skills (names and descriptions only). "
    f"Call the `{LOAD_SKILL_TOOL_NAME}` tool with a skill name to load full "
    "instructions. Do not invent skill names."
)

_INSTRUCTION_HEADER = "Published business instructions (apply in order):"


def compose_system_prompt_with_instructions(
    system_prompt: str,
    instruction_skills: Sequence[PublishedInstructionSkill],
) -> str:
    """Append published Instruction Skills after the technical system prompt.

    Empty ``instruction_skills`` leaves the prompt unchanged. Instruction text
    is preserved exactly. This content is model-call input only — not checkpointed.
    """
    base = system_prompt or ""
    if not instruction_skills:
        return base
    blocks: list[str] = [_INSTRUCTION_HEADER]
    for skill in instruction_skills:
        block_lines = [f"### {skill.name}"]
        if skill.description:
            block_lines.append(skill.description)
        block_lines.append(skill.instructions)
        blocks.append("\n".join(block_lines))
    section = "\n\n".join(blocks)
    if not base:
        return section
    return f"{base}\n\n{section}"


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
