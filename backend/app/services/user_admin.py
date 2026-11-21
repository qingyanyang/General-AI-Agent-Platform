"""Invite people by verified email and list the local directory.

Memberships stay keyed by Auth0 ``sub``. Email is only how an admin finds the
one linked account.
"""

from __future__ import annotations

import uuid
from collections.abc import Collection
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.core.permissions import PERM_PLATFORM_TECHNICAL
from app.models.agent import Agent, AgentAudienceMode, AgentAuthorizationMode
from app.models.agent_access_grant import AgentAccessGrant
from app.models.agent_group_assignment import AgentGroupAssignment
from app.models.directory_user import DirectoryUser
from app.models.group import Group, GroupMembership
from app.services.auth0_management import (
    Auth0Account,
    Auth0Directory,
    Auth0DirectoryError,
    Auth0IdentityConflict,
    Auth0NotConfigured,
    open_auth0_directory,
)
from app.services.groups import DirectoryUserNotFound, GroupNotFound, upsert_membership

ROLE_VALUES = frozenset({"user", "admin", "super-admin"})
_PAGE_LIMIT = 50


class UserAdminError(Exception):
    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True, slots=True)
class DirectoryPage:
    items: list[DirectoryUser]
    next_cursor: str | None


@dataclass(frozen=True, slots=True)
class UserMembership:
    group_id: uuid.UUID
    group_name: str
    designation: str


def normalize_email(value: str) -> str:
    email = value.strip().lower()
    if "@" not in email or " " in email or len(email) > 320 or email.startswith("@"):
        raise UserAdminError("Enter an email address.", 422)
    return email


def list_users(
    db: Session,
    *,
    query: str | None,
    cursor: str | None,
    permissions: Collection[str] = (),
    role: str | None = None,
    exclude_group_id: uuid.UUID | None = None,
    limit: int = _PAGE_LIMIT,
) -> DirectoryPage:
    show_super_admins = PERM_PLATFORM_TECHNICAL in permissions
    stmt = select(DirectoryUser).order_by(DirectoryUser.user_id)
    if not show_super_admins:
        stmt = stmt.where(DirectoryUser.role.is_distinct_from("super-admin"))
    if role is not None:
        stmt = stmt.where(or_(DirectoryUser.role == role, DirectoryUser.role.is_(None)))
    if exclude_group_id is not None:
        stmt = stmt.where(
            DirectoryUser.user_id.not_in(
                select(GroupMembership.user_id).where(GroupMembership.group_id == exclude_group_id),
            ),
        )
    needle = (query or "").strip().lower()
    if needle:
        pattern = f"%{needle}%"
        stmt = stmt.where(
            or_(
                DirectoryUser.email.ilike(pattern),
                DirectoryUser.display_name.ilike(pattern),
                DirectoryUser.user_id.ilike(pattern),
            ),
        )
    items: list[DirectoryUser] = []
    while len(items) <= limit:
        page = stmt if cursor is None else stmt.where(DirectoryUser.user_id > cursor)
        rows = list(db.scalars(page.limit(limit + 1)).all())
        if not rows:
            break
        has_more = len(rows) > limit
        cursor = rows[-1].user_id
        _enrich_rows(db, rows)
        items.extend(
            row
            for row in rows
            if (show_super_admins or row.role != "super-admin")
            and (role is None or row.role == role)
        )
        if not has_more:
            break

    next_cursor = items[limit - 1].user_id if len(items) > limit else None
    return DirectoryPage(items=items[:limit], next_cursor=next_cursor)


def get_user(db: Session, user_id: str) -> DirectoryUser:
    row = db.get(DirectoryUser, user_id)
    if row is None:
        raise UserAdminError("User not found", 404)
    kept = [row]
    _enrich_rows(db, kept)
    if not kept:
        raise UserAdminError("User not found", 404)
    return kept[0]


def get_visible_user(
    db: Session, user_id: str, *, permissions: Collection[str],
) -> DirectoryUser:
    row = get_user(db, user_id)
    if row.role == "super-admin" and PERM_PLATFORM_TECHNICAL not in permissions:
        raise UserAdminError("User not found", 404)
    return row


def _enrich_rows(db: Session, rows: list[DirectoryUser]) -> None:
    """Fill missing profile fields from Auth0; drop local rows Auth0 no longer has.

    Account linking merges secondary identities away. Their ``sub`` rows stay in
    ``directory_users`` until we notice a Management API 404 and prune them.
    """
    missing = [row for row in rows if not row.email or not row.role]
    if not missing:
        return
    try:
        directory = open_auth0_directory()
    except Auth0NotConfigured:
        return
    changed = False
    removed_ids: set[str] = set()
    try:
        for row in missing:
            outcome = _enrich_one(db, directory, row)
            if outcome == "removed":
                removed_ids.add(row.user_id)
                changed = True
            elif outcome == "updated":
                changed = True
        if changed:
            db.commit()
            for row in missing:
                if row.user_id not in removed_ids:
                    db.refresh(row)
        if removed_ids:
            rows[:] = [row for row in rows if row.user_id not in removed_ids]
    except Auth0DirectoryError:
        db.rollback()
    finally:
        directory.close()


def _purge_directory_user(db: Session, user_id: str) -> None:
    db.execute(delete(GroupMembership).where(GroupMembership.user_id == user_id))
    db.execute(delete(AgentAccessGrant).where(AgentAccessGrant.user_id == user_id))
    row = db.get(DirectoryUser, user_id)
    if row is not None:
        db.delete(row)


def _enrich_one(db: Session, directory: Auth0Directory, row: DirectoryUser) -> str:
    """Return ``updated``, ``unchanged``, or ``removed``."""
    changed = False
    if not row.email or not row.display_name:
        try:
            present, account = directory.lookup_account(row.user_id)
        except Auth0DirectoryError:
            present, account = True, None
        if not present:
            _purge_directory_user(db, row.user_id)
            return "removed"
        if account is not None:
            if not row.email:
                taken = db.scalar(
                    select(DirectoryUser.user_id).where(
                        DirectoryUser.email == account.email,
                        DirectoryUser.user_id != row.user_id,
                    ),
                )
                if taken is None:
                    row.email = account.email
                    row.email_verified = account.email_verified
                    changed = True
            if not row.display_name and account.name:
                row.display_name = account.name
                changed = True
            if row.status != "disabled" and account.email_verified and row.status == "pending":
                row.status = "active"
                changed = True
    if not row.role:
        try:
            role = directory.platform_role(row.user_id)
        except Auth0DirectoryError:
            role = None
        if role is not None:
            row.role = role
            changed = True
    return "updated" if changed else "unchanged"


def memberships_for(db: Session, user_id: str) -> list[UserMembership]:
    rows = db.execute(
        select(GroupMembership, Group.name)
        .join(Group, Group.id == GroupMembership.group_id)
        .where(GroupMembership.user_id == user_id)
        .order_by(Group.name),
    ).all()
    return [
        UserMembership(group_id=membership.group_id, group_name=name, designation=membership.designation)
        for membership, name in rows
    ]


def invite_user(
    db: Session,
    *,
    directory: Auth0Directory,
    caller_user_id: str,
    permissions: Collection[str],
    email: str,
    role: str,
    group_id: uuid.UUID | None,
) -> DirectoryUser:
    if role not in ROLE_VALUES:
        raise UserAdminError("Choose User, Admin, or Super Admin.", 422)
    if role == "super-admin" and PERM_PLATFORM_TECHNICAL not in permissions:
        raise UserAdminError("Only a Super Admin can assign the Super Admin role.", 403)
    address = normalize_email(email)
    if group_id is not None and db.get(Group, group_id) is None:
        raise GroupNotFound

    try:
        accounts = directory.find_by_email(address)
        if len(accounts) > 1:
            raise Auth0IdentityConflict(
                "More than one Auth0 user has this email. Link them before inviting.",
            )
        if len(accounts) == 1:
            account = accounts[0]
        else:
            account = directory.create_user(address)
        directory.assign_role(account.user_id, role)
    except Auth0IdentityConflict:
        raise
    except Auth0DirectoryError as exc:
        raise UserAdminError(exc.message, 502) from exc

    row = _save_invited_account(db, account=account, role=role)
    if group_id is not None:
        try:
            upsert_membership(
                db,
                group_id=group_id,
                caller_user_id=caller_user_id,
                permissions=permissions,
                user_id=row.user_id,
                designation="member",
            )
        except DirectoryUserNotFound as exc:
            raise UserAdminError("The invited user was not saved.", 502) from exc
    return row


def update_user(
    db: Session,
    *,
    directory: Auth0Directory | None,
    permissions: Collection[str],
    user_id: str,
    role: str | None,
    status: str | None,
) -> DirectoryUser:
    row = get_user(db, user_id)
    if role is not None:
        if role not in ROLE_VALUES:
            raise UserAdminError("Choose User, Admin, or Super Admin.", 422)
        if role == "super-admin" and PERM_PLATFORM_TECHNICAL not in permissions:
            raise UserAdminError("Only a Super Admin can assign the Super Admin role.", 403)
        if row.role == "super-admin" and PERM_PLATFORM_TECHNICAL not in permissions:
            raise UserAdminError("An Admin cannot change a Super Admin account.", 403)
        if directory is None:
            raise UserAdminError("User invitations need an Auth0 Management API application.", 503)
        try:
            directory.assign_role(row.user_id, role)
        except Auth0DirectoryError as exc:
            raise UserAdminError(exc.message, 502) from exc
        row.role = role
    if status is not None:
        if status not in {"active", "disabled"}:
            raise UserAdminError("Status must be active or disabled.", 422)
        if row.role == "super-admin" and PERM_PLATFORM_TECHNICAL not in permissions:
            raise UserAdminError("An Admin cannot change a Super Admin account.", 403)
        row.status = status
    db.commit()
    db.refresh(row)
    return row


def _save_invited_account(db: Session, *, account: Auth0Account, role: str) -> DirectoryUser:
    now = datetime.now(UTC)
    row = db.get(DirectoryUser, account.user_id)
    status = "active" if account.email_verified else "pending"
    if row is None:
        row = DirectoryUser(
            user_id=account.user_id,
            email=account.email,
            display_name=account.name,
            email_verified=account.email_verified,
            role=role,
            status=status,
            first_seen_at=now,
            last_seen_at=now,
        )
        db.add(row)
    else:
        if row.status != "disabled":
            row.status = status
        row.email = account.email
        row.email_verified = account.email_verified
        row.role = role
        if account.name:
            row.display_name = account.name
    db.commit()
    db.refresh(row)
    return row


@dataclass(frozen=True, slots=True)
class AccessSource:
    kind: str
    group_id: uuid.UUID | None = None
    name: str | None = None


@dataclass(frozen=True, slots=True)
class EffectiveAccess:
    agent_id: str
    agent_name: str | None
    can_use: bool
    can_edit_prompt: bool
    sources: tuple[AccessSource, ...]


def effective_access_for_user(db: Session, user_id: str) -> list[EffectiveAccess]:
    """Agents this person can use through company audience, a group, or a legacy grant."""
    row = db.get(DirectoryUser, user_id)
    if row is None:
        raise UserAdminError("User not found", 404)
    memberships = list(
        db.scalars(select(GroupMembership).where(GroupMembership.user_id == user_id)).all(),
    )
    group_ids = {item.group_id for item in memberships}
    leader_ids = {item.group_id for item in memberships if item.designation == "leader"}
    is_admin = row.role in {"admin", "super-admin"}
    grants = {
        item.agent_id: item
        for item in db.scalars(
            select(AgentAccessGrant).where(AgentAccessGrant.user_id == user_id),
        ).all()
    }
    assignments: dict[str, set[uuid.UUID]] = {}
    for item in db.scalars(select(AgentGroupAssignment)).all():
        assignments.setdefault(item.agent_id, set()).add(item.group_id)
    groups = {item.id: item for item in db.scalars(select(Group)).all()}
    rows: list[EffectiveAccess] = []
    agents = list(db.scalars(select(Agent).order_by(Agent.name.asc(), Agent.id.asc())).all())
    for agent in agents:
        sources: list[AccessSource] = []
        can_use = False
        if (
            agent.authorization_mode == AgentAuthorizationMode.AUDIENCE.value
            and agent.audience_mode == AgentAudienceMode.COMPANY.value
        ):
            can_use = True
            sources.append(AccessSource(kind="company"))
        assigned = assignments.get(agent.id, set())
        if agent.authorization_mode == AgentAuthorizationMode.AUDIENCE.value:
            for group_id in sorted(assigned & group_ids, key=str):
                can_use = True
                group = groups.get(group_id)
                sources.append(
                    AccessSource(kind="group", group_id=group_id, name=None if group is None else group.name),
                )
        grant = grants.get(agent.id)
        if (
            agent.authorization_mode == AgentAuthorizationMode.LEGACY_GRANTS.value
            and grant is not None
            and grant.can_execute
        ):
            can_use = True
            sources.append(AccessSource(kind="grant"))
        if not can_use:
            continue
        can_view = agent.authorization_mode == AgentAuthorizationMode.AUDIENCE.value or (
            grant is not None and grant.can_view
        )
        can_edit = is_admin or (bool(leader_ids) and can_view)
        rows.append(
            EffectiveAccess(
                agent_id=agent.id,
                agent_name=agent.name,
                can_use=True,
                can_edit_prompt=can_edit,
                sources=tuple(sources),
            ),
        )
    return rows
