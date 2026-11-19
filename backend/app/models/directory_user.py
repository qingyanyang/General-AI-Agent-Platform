"""Local directory row for a subject that has presented a valid access token.

Identity is the validated ``sub`` only. Profile claims are not stored.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, postgres_schema_name


class DirectoryUser(Base):
    __tablename__ = "directory_users"
    __table_args__ = ({"schema": postgres_schema_name()},)

    user_id: Mapped[str] = mapped_column(String(512), primary_key=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
