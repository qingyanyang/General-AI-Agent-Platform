"""Published business Instruction Skills DTOs used at runtime (Issue 5)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class PublishedInstructionSkill:
    """Immutable published instruction carried in execution snapshots."""

    name: str
    description: str
    instructions: str
