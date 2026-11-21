"""Local directory row for an Auth0 subject.

Identity remains the access-token ``sub``. Email and name are stored only after
a verified claim, or when an admin invites that address.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, postgres_schema_name


class DirectoryUser(Base):
    __tablename__ = "directory_users"
    __table_args__ = ({"schema": postgres_schema_name()},)

    user_id: Mapped[str] = mapped_column(String(512), primary_key=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True, unique=True)
    display_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    role: Mapped[str | None] = mapped_column(String(32), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
