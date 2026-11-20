"""Read-only tool and approved-model catalogs (#28)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.agents.skills.registry import LOAD_SKILL_TOOL_NAME
from app.agents.tools import create_default_registry
from app.api.deps import require_permissions
from app.core.auth import AuthenticatedUser
from app.core.config import get_settings
from app.core.permissions import PERM_PLATFORM_TECHNICAL
from app.schemas.catalog import LlmModelListOut, LlmModelOut, ToolCatalogItem, ToolCatalogOut

router = APIRouter(tags=["catalog"])


@router.get("/tools", response_model=ToolCatalogOut)
def list_tools(
    _user: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_PLATFORM_TECHNICAL))],
) -> ToolCatalogOut:
    """Registered tools a caller may assign. ``load_skill`` stays reserved."""
    items = [
        ToolCatalogItem(name=tool.name, description=tool.description)
        for tool in create_default_registry().list()
        if tool.name != LOAD_SKILL_TOOL_NAME
    ]
    items.sort(key=lambda item: item.name)
    return ToolCatalogOut(items=items)


@router.get("/llm-models", response_model=LlmModelListOut)
def list_llm_models(
    _user: Annotated[AuthenticatedUser, Depends(require_permissions(PERM_PLATFORM_TECHNICAL))],
) -> LlmModelListOut:
    """Approved models and their temperature bounds, from server settings."""
    items = [
        LlmModelOut(
            provider=entry.provider,
            model=entry.model,
            temperature_min=entry.temperature_min,
            temperature_max=entry.temperature_max,
        )
        for entry in get_settings().approved_llm_catalog()
    ]
    return LlmModelListOut(items=items)
