"""Published per-agent Instruction Skills (Issue 5).

Full-replacement publication only — no server-side drafts. ``SELECT ... FOR UPDATE``
locks the Agent row before authorization re-check and collection replace.

SQLite tests do **not** verify PostgreSQL row-lock / concurrency behavior.
"""

from __future__ import annotations

import uuid
from collections.abc import Collection, Sequence
from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.agent import Agent
from app.models.agent_instruction_skill import AgentInstructionSkill
from app.schemas.agent_instruction_skills import (
    AGGREGATE_MAX_LENGTH,
    DESCRIPTION_MAX_LENGTH,
    INSTRUCTIONS_MAX_LENGTH,
    MAX_ITEMS,
    NAME_MAX_LENGTH,
    InstructionSkillItemIn,
)
from app.services import agent_access as access_service


class InstructionSkillsNotFound(Exception):
    """Agent is missing."""


class InstructionSkillsValidationError(Exception):
    """Payload failed domain validation."""


@dataclass(frozen=True, slots=True)
class PublishedInstructionSkill:
    """Immutable published instruction used in execution snapshots."""

    name: str
    description: str
    instructions: str


@dataclass(frozen=True, slots=True)
class InstructionSkillView:
    id: uuid.UUID
    name: str
    description: str
    instructions: str


def _lock_agent(db: Session, agent_id: str) -> Agent:
    agent = db.scalar(select(Agent).where(Agent.id == agent_id).with_for_update())
    if agent is None:
        raise InstructionSkillsNotFound
    return agent


def _row_to_view(row: AgentInstructionSkill) -> InstructionSkillView:
    return InstructionSkillView(
        id=row.id,
        name=row.name,
        description=row.description,
        instructions=row.instructions,
    )


def _ordered_rows(db: Session, agent_id: str) -> list[AgentInstructionSkill]:
    return list(
        db.scalars(
            select(AgentInstructionSkill)
            .where(AgentInstructionSkill.agent_id == agent_id)
            .order_by(AgentInstructionSkill.position.asc()),
        ).all(),
    )


def list_instruction_skills(db: Session, *, agent_id: str) -> list[InstructionSkillView]:
    agent = db.get(Agent, agent_id)
    if agent is None:
        raise InstructionSkillsNotFound
    return [_row_to_view(row) for row in _ordered_rows(db, agent_id)]


def load_published_instruction_skills(
    db: Session,
    *,
    agent_id: str,
) -> tuple[PublishedInstructionSkill, ...]:
    """Load ordered published instructions for an execution snapshot (DB still open)."""
    return tuple(
        PublishedInstructionSkill(
            name=row.name,
            description=row.description,
            instructions=row.instructions,
        )
        for row in _ordered_rows(db, agent_id)
    )


def _validate_items(items: Sequence[InstructionSkillItemIn]) -> list[InstructionSkillItemIn]:
    if len(items) > MAX_ITEMS:
        raise InstructionSkillsValidationError(
            f"at most {MAX_ITEMS} instruction skills are allowed",
        )
    seen: set[str] = set()
    aggregate = 0
    validated: list[InstructionSkillItemIn] = []
    for item in items:
        name = item.name.strip()
        if not name:
            raise InstructionSkillsValidationError("name must be a non-empty string")
        if len(name) > NAME_MAX_LENGTH:
            raise InstructionSkillsValidationError(
                f"name must be at most {NAME_MAX_LENGTH} characters",
            )
        description = item.description.strip()
        if len(description) > DESCRIPTION_MAX_LENGTH:
            raise InstructionSkillsValidationError(
                f"description must be at most {DESCRIPTION_MAX_LENGTH} characters",
            )
        instructions = item.instructions
        if not instructions or instructions.isspace():
            raise InstructionSkillsValidationError(
                "instructions must contain non-whitespace content",
            )
        if len(instructions) > INSTRUCTIONS_MAX_LENGTH:
            raise InstructionSkillsValidationError(
                f"instructions must be at most {INSTRUCTIONS_MAX_LENGTH} characters",
            )
        key = name.casefold()
        if key in seen:
            raise InstructionSkillsValidationError(
                "instruction skill names must be unique (case-insensitive)",
            )
        seen.add(key)
        aggregate += len(name) + len(description) + len(instructions)
        validated.append(
            InstructionSkillItemIn(
                name=name,
                description=description,
                instructions=instructions,
            ),
        )
    if aggregate > AGGREGATE_MAX_LENGTH:
        raise InstructionSkillsValidationError(
            f"combined name, description, and instructions length must be "
            f"at most {AGGREGATE_MAX_LENGTH} characters",
        )
    return validated


def replace_instruction_skills(
    db: Session,
    *,
    agent_id: str,
    items: Sequence[InstructionSkillItemIn],
    user_id: str,
    permissions: Collection[str] | None,
) -> list[InstructionSkillView]:
    """Lock Agent, re-check edit authorization, validate, then replace in one transaction.

    Validation runs before any delete. Empty ``items`` clears the published collection.
    On failure after mutation begins, rolls back so the previous collection remains.
    """
    agent = _lock_agent(db, agent_id)
    if not access_service.user_can_edit_instruction_skills_for_agent(
        db,
        agent=agent,
        user_id=user_id,
        permissions=permissions,
    ):
        raise access_service.AgentAccessDenied

    validated = _validate_items(items)

    try:
        db.execute(
            delete(AgentInstructionSkill).where(
                AgentInstructionSkill.agent_id == agent_id,
            ),
        )
        for position, item in enumerate(validated):
            db.add(
                AgentInstructionSkill(
                    id=uuid.uuid4(),
                    agent_id=agent_id,
                    position=position,
                    name=item.name,
                    description=item.description,
                    instructions=item.instructions,
                ),
            )
        db.commit()
    except Exception:
        db.rollback()
        raise

    return [_row_to_view(row) for row in _ordered_rows(db, agent_id)]
