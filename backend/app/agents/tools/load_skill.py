"""Backend-controlled load_skill tool. Instructions only; no permission grants (#23)."""

from __future__ import annotations

from langchain_core.tools import tool

from app.agents.skills.factory import create_default_skill_registry
from app.agents.skills.registry import LOAD_SKILL_TOOL_NAME
from app.agents.tool_policy import ToolAuthorizationError, get_tool_auth_context
from app.agents.tools.errors import ToolValidationError


def format_skill_payload(name: str) -> str:
    """Return skill instructions and descriptive resource refs for an assigned skill.

    Re-checks ``allowed_skills`` on every call. Never mutates tool allowlists.
    """
    context = get_tool_auth_context()
    if context is None:
        raise ToolAuthorizationError(LOAD_SKILL_TOOL_NAME, "not authorized (missing context)")
    if not isinstance(name, str) or not name.strip():
        raise ToolValidationError("invalid tool arguments")
    skill_name = name.strip()
    if skill_name not in context.allowed_skills:
        raise ToolAuthorizationError(
            LOAD_SKILL_TOOL_NAME,
            "not authorized for this agent",
        )
    registry = create_default_skill_registry()
    if not registry.has(skill_name):
        raise ToolAuthorizationError(
            LOAD_SKILL_TOOL_NAME,
            "not authorized for this agent",
        )
    skill = registry.get(skill_name)
    lines = [f"Skill: {skill.name}", "", skill.instructions]
    if skill.resources:
        lines.append("")
        lines.append("Approved resources (references only; not loaded by the platform):")
        for resource in skill.resources:
            if resource.label:
                lines.append(f"- {resource.id}: {resource.label}")
            else:
                lines.append(f"- {resource.id}")
    return "\n".join(lines)


@tool(LOAD_SKILL_TOOL_NAME)
def load_skill(name: str) -> str:
    """Load full instructions for an assigned skill by name."""
    return format_skill_payload(name)
