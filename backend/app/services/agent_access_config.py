"""Staged agent audience and owning-group configuration (Issue 3).

FastAPI-free. These settings are **not** consulted by Chat, discovery, or
session authorization while ``authorization_mode`` is ``legacy_grants``.
Issue 4 activates ``audience`` mode and enforces the audience policy without
OR-ing legacy grants.

``SELECT ... FOR UPDATE`` is used before reading ownership/assignments. SQLite
tests do **not** verify PostgreSQL row-lock / concurrency behavior; that remains
a pre-deployment check on a disposable ``TEST_DATABASE_URL`` only.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.agent import (
    Agent,
    AgentAudienceMode,
    AgentAuthorizationMode,
)
from app.models.agent_group_assignment import AgentGroupAssignment
from app.models.group import Group


class AgentAccessConfigNotFound(Exception):
    """Agent is missing."""


class GroupNotFound(Exception):
    """Referenced group is missing."""


class AgentAccessConfigValidationError(Exception):
    """Payload failed domain validation."""


@dataclass(frozen=True)
class AccessConfigGroupView:
    group_id: uuid.UUID
    name: str
    is_owning: bool


@dataclass(frozen=True)
class AccessConfigView:
    agent_id: str
    authorization_mode: str
    audience_effective: bool
    audience_mode: str | None
    owning_group_id: uuid.UUID | None
    owning_group_name: str | None
    group_ids: list[uuid.UUID]
    groups: list[AccessConfigGroupView]
    updated_at: datetime


def _utcnow() -> datetime:
    return datetime.now(UTC)


def audience_effective(authorization_mode: str) -> bool:
    return authorization_mode == AgentAuthorizationMode.AUDIENCE.value


def _lock_agent(db: Session, agent_id: str) -> Agent:
    agent = db.scalar(select(Agent).where(Agent.id == agent_id).with_for_update())
    if agent is None:
        raise AgentAccessConfigNotFound
    return agent


def _assignment_group_ids(db: Session, agent_id: str) -> list[uuid.UUID]:
    rows = db.scalars(
        select(AgentGroupAssignment.group_id)
        .where(AgentGroupAssignment.agent_id == agent_id)
        .order_by(AgentGroupAssignment.group_id.asc()),
    ).all()
    return list(rows)


def _build_view(db: Session, agent: Agent) -> AccessConfigView:
    group_ids = _assignment_group_ids(db, agent.id)
    groups_by_id: dict[uuid.UUID, Group] = {}
    if group_ids or agent.owning_group_id is not None:
        lookup_ids = set(group_ids)
        if agent.owning_group_id is not None:
            lookup_ids.add(agent.owning_group_id)
        for group in db.scalars(select(Group).where(Group.id.in_(lookup_ids))).all():
            groups_by_id[group.id] = group

    owning_name: str | None = None
    if agent.owning_group_id is not None:
        owning = groups_by_id.get(agent.owning_group_id)
        owning_name = owning.name if owning is not None else None

    group_views = [
        AccessConfigGroupView(
            group_id=group_id,
            name=groups_by_id[group_id].name if group_id in groups_by_id else "",
            is_owning=agent.owning_group_id == group_id,
        )
        for group_id in group_ids
        if group_id in groups_by_id
    ]
    return AccessConfigView(
        agent_id=agent.id,
        authorization_mode=agent.authorization_mode,
        audience_effective=audience_effective(agent.authorization_mode),
        audience_mode=agent.audience_mode,
        owning_group_id=agent.owning_group_id,
        owning_group_name=owning_name,
        group_ids=group_ids,
        groups=group_views,
        updated_at=agent.updated_at,
    )


def get_access_config(db: Session, *, agent_id: str) -> AccessConfigView:
    agent = db.get(Agent, agent_id)
    if agent is None:
        raise AgentAccessConfigNotFound
    return _build_view(db, agent)


def _require_groups(db: Session, group_ids: set[uuid.UUID]) -> dict[uuid.UUID, Group]:
    if not group_ids:
        return {}
    rows = list(db.scalars(select(Group).where(Group.id.in_(group_ids))).all())
    found = {row.id: row for row in rows}
    missing = group_ids - found.keys()
    if missing:
        raise GroupNotFound
    return found


def update_access_config(
    db: Session,
    *,
    agent_id: str,
    audience_mode: str,
    owning_group_id: uuid.UUID | None,
    group_ids: list[uuid.UUID],
) -> AccessConfigView:
    """Replace staged audience configuration in one locked transaction.

    Does not change ``authorization_mode``. Does not touch grant rows.
    """
    if audience_mode not in {
        AgentAudienceMode.COMPANY.value,
        AgentAudienceMode.GROUPS.value,
    }:
        raise AgentAccessConfigValidationError(
            "audience_mode must be 'company' or 'groups'",
        )

    # Dedupe while preserving first-seen order for stable tests.
    requested_ids: list[uuid.UUID] = []
    seen: set[uuid.UUID] = set()
    for group_id in group_ids:
        if group_id not in seen:
            seen.add(group_id)
            requested_ids.append(group_id)
    requested_set = set(requested_ids)

    agent = _lock_agent(db, agent_id)
    previous_owning = agent.owning_group_id

    validate_ids = set(requested_set)
    if owning_group_id is not None:
        validate_ids.add(owning_group_id)
    if previous_owning is not None:
        validate_ids.add(previous_owning)
    _require_groups(db, validate_ids)

    # Owning-removal check against original requested ids BEFORE auto-inclusion.
    if (
        owning_group_id is not None
        and previous_owning is not None
        and owning_group_id == previous_owning
        and previous_owning not in requested_set
    ):
        raise AgentAccessConfigValidationError(
            "Cannot remove the owning group's access assignment while it remains the owning group",
        )

    final_ids = set(requested_set)

    # Newly assigned owning group → auto-include.
    if owning_group_id is not None:
        final_ids.add(owning_group_id)

    # Previous owning group → preserve on ownership-changing request.
    if previous_owning is not None and owning_group_id != previous_owning:
        final_ids.add(previous_owning)

    now = _utcnow()
    agent.audience_mode = audience_mode
    agent.owning_group_id = owning_group_id
    # Always bump configuration timestamp, including assignment-only changes.
    agent.updated_at = now

    existing = {
        row.group_id: row
        for row in db.scalars(
            select(AgentGroupAssignment).where(AgentGroupAssignment.agent_id == agent_id),
        ).all()
    }
    to_remove = set(existing) - final_ids
    to_add = final_ids - set(existing)

    if to_remove:
        db.execute(
            delete(AgentGroupAssignment).where(
                AgentGroupAssignment.agent_id == agent_id,
                AgentGroupAssignment.group_id.in_(to_remove),
            ),
        )
    for group_id in to_add:
        db.add(
            AgentGroupAssignment(
                agent_id=agent_id,
                group_id=group_id,
                created_at=now,
                updated_at=now,
            ),
        )
    # Touch updated_at on retained rows when the set is rewritten via PUT.
    for group_id in final_ids & set(existing):
        existing[group_id].updated_at = now

    db.commit()
    db.refresh(agent)
    return _build_view(db, agent)
