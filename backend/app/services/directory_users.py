"""Record a validated API subject. JWT verification does not call this module."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import case, select
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.core.database import get_session_factory
from app.models.directory_user import DirectoryUser


class DirectoryPersistenceError(Exception):
    """The directory row could not be committed. The API request must not continue."""


def _utcnow() -> datetime:
    return datetime.now(UTC)


def open_directory_session() -> Session:
    """Short-lived session. Callers commit and close it before business work."""
    return get_session_factory()()


def upsert_signed_in_user(session: Session, *, user_id: str, seen_at: datetime) -> None:
    """Insert the subject or move ``last_seen_at`` forward. ``first_seen_at`` stays put.

    One statement, so concurrent first requests for a subject leave a single row.
    """
    dialect = session.get_bind().dialect.name
    if dialect == "postgresql":
        insert = postgresql_insert(DirectoryUser)
    elif dialect == "sqlite":
        insert = sqlite_insert(DirectoryUser)
    else:
        raise DirectoryPersistenceError(f"unsupported directory dialect: {dialect}")
    statement = insert.values(
        user_id=user_id,
        first_seen_at=seen_at,
        last_seen_at=seen_at,
        email_verified=False,
        status="active",
    )
    session.execute(
        statement.on_conflict_do_update(
            index_elements=[DirectoryUser.user_id],
            set_={
                "last_seen_at": case(
                    (
                        DirectoryUser.last_seen_at < statement.excluded.last_seen_at,
                        statement.excluded.last_seen_at,
                    ),
                    else_=DirectoryUser.last_seen_at,
                ),
            },
        ),
    )


def _apply_verified_profile(
    session: Session,
    *,
    user_id: str,
    email: str | None,
    display_name: str | None,
    email_verified: bool,
) -> str:
    row = session.get(DirectoryUser, user_id)
    if row is None:
        raise DirectoryPersistenceError("directory row missing after upsert")
    if email_verified and display_name:
        row.display_name = display_name
    if email_verified and email:
        taken = session.scalar(
            select(DirectoryUser.user_id).where(
                DirectoryUser.email == email,
                DirectoryUser.user_id != user_id,
            ),
        )
        if taken is None:
            row.email = email
            row.email_verified = True
    if row.status != "disabled" and email_verified:
        row.status = "active"
    return row.status


def record_authenticated_subject(
    user_id: str,
    *,
    email: str | None = None,
    display_name: str | None = None,
    email_verified: bool = False,
) -> str:
    """Commit one directory upsert, then close the session.

    ``last_seen_at`` is this authenticated API request, not an interactive login.
    A later permission failure still leaves the committed row in place.
    Opening the session is part of the write: a failure there is also a
    persistence error and must not reach the route. Returns the account status.
    """
    try:
        session = open_directory_session()
    except DirectoryPersistenceError:
        raise
    except Exception as exc:
        raise DirectoryPersistenceError("directory session unavailable") from exc
    try:
        upsert_signed_in_user(session, user_id=user_id, seen_at=_utcnow())
        status = _apply_verified_profile(
            session,
            user_id=user_id,
            email=email,
            display_name=display_name,
            email_verified=email_verified,
        )
        session.commit()
        return status
    except DirectoryPersistenceError:
        session.rollback()
        raise
    except Exception as exc:
        session.rollback()
        raise DirectoryPersistenceError("directory upsert failed") from exc
    finally:
        session.close()
