"""Directory upsert behavior that does not require a live application database."""

from __future__ import annotations

import threading
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.models.base import Base, postgres_schema_name
from app.models.chat_session import ChatSession
from app.models.directory_user import DirectoryUser
from app.services.directory_users import upsert_signed_in_user
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool


def _engine(path: Path):
    schema = postgres_schema_name()
    engine = create_engine(
        f"sqlite:///{path}",
        connect_args={"check_same_thread": False},
        poolclass=NullPool,
        execution_options={"schema_translate_map": {schema: None}},
    )
    Base.metadata.create_all(bind=engine)
    return engine


def _aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def test_concurrent_first_requests_keep_one_row_and_first_seen(tmp_path: Path) -> None:
    engine = _engine(tmp_path / "directory.sqlite")
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    early = datetime(2026, 3, 1, tzinfo=UTC)
    later = early + timedelta(minutes=5)
    barrier = threading.Barrier(2)
    errors: list[BaseException] = []

    def _request(seen_at: datetime) -> None:
        session = factory()
        try:
            barrier.wait(timeout=5)
            upsert_signed_in_user(session, user_id="auth0|race", seen_at=seen_at)
            session.commit()
        except BaseException as exc:  # noqa: BLE001 — collected for the assertion below
            errors.append(exc)
            session.rollback()
        finally:
            session.close()

    threads = [
        threading.Thread(target=_request, args=(early,)),
        threading.Thread(target=_request, args=(later,)),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=5)
    assert errors == []
    assert all(not thread.is_alive() for thread in threads)

    check = factory()
    try:
        rows = list(check.scalars(select(DirectoryUser)).all())
        assert len(rows) == 1
        assert rows[0].user_id == "auth0|race"
        assert _aware(rows[0].first_seen_at) in {early, later}
        assert _aware(rows[0].last_seen_at) == later
        first_seen = rows[0].first_seen_at
        following = later + timedelta(minutes=5)
        upsert_signed_in_user(check, user_id="auth0|race", seen_at=following)
        check.commit()
        check.expire_all()
        row = check.get(DirectoryUser, "auth0|race")
        assert row is not None
        assert row.first_seen_at == first_seen
        assert _aware(row.last_seen_at) == following
    finally:
        check.close()
        engine.dispose()


def test_directory_commit_does_not_commit_another_sessions_changes(tmp_path: Path) -> None:
    engine = _engine(tmp_path / "isolated.sqlite")
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    pending = factory()
    unrelated = ChatSession(
        id=uuid.uuid4(),
        user_id="auth0|pending",
        agent_id="default",
        title="unrelated",
        created_at=datetime(2026, 3, 1, tzinfo=UTC),
        last_activity_at=datetime(2026, 3, 1, tzinfo=UTC),
    )
    pending.add(unrelated)
    directory = factory()
    try:
        upsert_signed_in_user(
            directory,
            user_id="auth0|signed-in",
            seen_at=datetime(2026, 3, 2, tzinfo=UTC),
        )
        directory.commit()
    finally:
        directory.close()

    visible = factory()
    try:
        assert unrelated in pending.new
        assert visible.get(DirectoryUser, "auth0|signed-in") is not None
        assert list(visible.scalars(select(ChatSession)).all()) == []
    finally:
        visible.close()
        pending.rollback()
        pending.close()
        engine.dispose()


def test_record_commits_and_closes_only_the_directory_session(monkeypatch) -> None:
    events: list[object] = []

    class _Session:
        def commit(self) -> None:
            events.append("commit")

        def rollback(self) -> None:
            events.append("rollback")

        def close(self) -> None:
            events.append("close")

    directory_session = _Session()

    def _upsert(session: object, *, user_id: str, seen_at: datetime) -> None:
        events.append((session, user_id, seen_at))

    monkeypatch.setattr(
        "app.services.directory_users.open_directory_session",
        lambda: directory_session,
    )
    monkeypatch.setattr("app.services.directory_users.upsert_signed_in_user", _upsert)
    from app.services.directory_users import record_authenticated_subject

    record_authenticated_subject("auth0|subject")
    assert events[0][0] is directory_session
    assert events[0][1] == "auth0|subject"
    assert events[1:] == ["commit", "close"]


def test_open_directory_session_returns_a_new_session(monkeypatch) -> None:
    created: list[Session] = []

    class _Factory:
        def __call__(self) -> Session:
            session = Session()
            created.append(session)
            return session

    monkeypatch.setattr(
        "app.services.directory_users.get_session_factory",
        lambda: _Factory(),
    )
    from app.services.directory_users import open_directory_session

    first = open_directory_session()
    second = open_directory_session()
    assert first is not second
    assert created == [first, second]
    first.close()
    second.close()
