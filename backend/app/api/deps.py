"""FastAPI dependencies.

`get_current_user_id` is a **development-only** identity stub that reads the
`X-User-Id` header. Issue #15 (OIDC/JWT) should replace the body of this
dependency while keeping the same return type so routes stay unchanged.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Header, HTTPException, status

USER_ID_MAX_LENGTH = 128


def get_current_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    """Resolve the current opaque user id from `X-User-Id` (dev stub)."""
    if x_user_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="X-User-Id header is required",
        )
    user_id = x_user_id.strip()
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="X-User-Id must be a non-empty string",
        )
    if len(user_id) > USER_ID_MAX_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"X-User-Id must be at most {USER_ID_MAX_LENGTH} characters",
        )
    return user_id
