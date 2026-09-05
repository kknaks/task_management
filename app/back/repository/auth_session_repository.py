"""3층 — `auth_session` 의 ORM/SQL 만.

refresh 는 **해시로만** 저장·조회한다(A-7 · SPEC-001 Data Contract).
`commit()` 하지 않는다 — flush 까지다(backend/README.md §7).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from dto.auth import AuthSessionDTO
from models.account import AuthSession


def _to_dto(row: AuthSession) -> AuthSessionDTO:
    return AuthSessionDTO(
        id=row.id,
        account_id=row.account_id,
        expires_at=row.expires_at,
        revoked_at=row.revoked_at,
    )


async def create(
    session: AsyncSession,
    *,
    account_id: int,
    refresh_token_hash: str,
    expires_at: datetime,
) -> AuthSessionDTO:
    row = AuthSession(
        account_id=account_id,
        refresh_token_hash=refresh_token_hash,
        expires_at=expires_at,
    )
    session.add(row)
    await session.flush()
    return _to_dto(row)


async def find_by_token_hash(
    session: AsyncSession, refresh_token_hash: str
) -> AuthSessionDTO | None:
    """무효(`revoked_at IS NOT NULL`)·만료 행도 그대로 돌려준다 —
    **재사용 감지가 그 행을 봐야 하기 때문이다**(A-7). 판정은 service 가 한다.
    """
    row = (
        await session.scalars(
            select(AuthSession).where(AuthSession.refresh_token_hash == refresh_token_hash)
        )
    ).one_or_none()

    if row is None:
        return None
    return _to_dto(row)


async def revoke(session: AsyncSession, *, session_id: int, revoked_at: datetime) -> None:
    """이미 무효인 행은 시각을 덮어쓰지 않는다 — 최초 무효화 시점을 남긴다."""
    await session.execute(
        update(AuthSession)
        .where(AuthSession.id == session_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=revoked_at)
    )
    await session.flush()


async def revoke_all_for_account(
    session: AsyncSession, *, account_id: int, revoked_at: datetime
) -> int:
    """그 계정의 **유효한 세션 전부**를 끊는다(A-7 재사용 감지). 끊은 행 수를 돌려준다."""
    result = await session.execute(
        update(AuthSession)
        .where(AuthSession.account_id == account_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=revoked_at)
    )
    await session.flush()
    return result.rowcount or 0
