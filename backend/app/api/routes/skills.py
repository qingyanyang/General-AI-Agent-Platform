"""Read-only curated skill catalog (#23)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.agents.skills import create_default_skill_registry
from app.api.deps import require_permissions
from app.core.auth import AuthenticatedUser
from app.core.permissions import PERM_AGENTS_READ, PERM_PLATFORM_TECHNICAL
from app.schemas.skill import (
    SkillDetailOut,
    SkillListOut,
    SkillResourceOut,
    SkillSummaryOut,
)

router = APIRouter(prefix="/skills", tags=["skills"])


@router.get("", response_model=SkillListOut)
def list_skills(
    _user: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_AGENTS_READ))],
) -> SkillListOut:
    """List curated skills (names and descriptions only)."""
    items = [
        SkillSummaryOut(name=skill.name, description=skill.description)
        for skill in create_default_skill_registry().list()
    ]
    return SkillListOut(items=items)


@router.get("/{skill_name}", response_model=SkillDetailOut)
def get_skill(
    skill_name: str,
    _user: Annotated[
        AuthenticatedUser,
        Depends(require_permissions(PERM_PLATFORM_TECHNICAL)),
    ],
) -> SkillDetailOut:
    """Operator detail for one curated skill. Assignment still gates runtime load."""
    registry = create_default_skill_registry()
    if not registry.has(skill_name):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Skill not found",
        )
    skill = registry.get(skill_name)
    return SkillDetailOut(
        name=skill.name,
        description=skill.description,
        instructions=skill.instructions,
        resources=[
            SkillResourceOut(id=resource.id, label=resource.label) for resource in skill.resources
        ],
    )
