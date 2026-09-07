"""3층 — `auth_session` 의 ORM/SQL 만.

refresh 는 **해시로만** 저장·조회한다(A-7 · SPEC-001 Data Contract).
회의 토큰(`kind='meeting'`)은 **원문으로** 저장·조회하고 **폐기는 행 DELETE** 다(A-13 · MF-69) —
`revoke` 계열을 회의 토큰에 쓰지 않는다. 회전하지 않아 「이미 쓴 토큰」을 탐지할 대상이 아니다.
`commit()` 하지 않는다 — flush 까지다(backend/README.md §7).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from dto.auth import AuthSessionDTO
from models.account import AuthSession

# G-3 — `kind` 는 varchar + CHECK 다. 리터럴을 흩뿌리지 않는다
_REFRESH = "refresh"
_MEETING = "meeting"


def _to_dto(row: AuthSession) -> AuthSessionDTO:
    return AuthSessionDTO(
        id=row.id,
        account_id=row.account_id,
        kind=row.kind,
        meeting_id=row.meeting_id,
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
        kind=_REFRESH,
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
            select(AuthSession).where(
                AuthSession.kind == _REFRESH,
                AuthSession.refresh_token_hash == refresh_token_hash,
            )
        )
    ).one_or_none()

    if row is None:
        return None
    return _to_dto(row)


async def revoke(session: AsyncSession, *, session_id: int, revoked_at: datetime) -> None:
    """이미 무효인 행은 시각을 덮어쓰지 않는다 — 최초 무효화 시점을 남긴다."""
    await session.execute(
        update(AuthSession)
        .where(
            AuthSession.id == session_id,
            AuthSession.kind == _REFRESH,
            AuthSession.revoked_at.is_(None),
        )
        .values(revoked_at=revoked_at)
    )
    await session.flush()


async def revoke_all_for_account(
    session: AsyncSession, *, account_id: int, revoked_at: datetime
) -> int:
    """그 계정의 **유효한 세션 전부**를 끊는다(A-7 재사용 감지). 끊은 행 수를 돌려준다."""
    result = await session.execute(
        update(AuthSession)
        .where(
            AuthSession.account_id == account_id,
            # A-7 은 **`refresh` 행의 규칙**이다 — 재사용 감지가 회의 토큰을 끊지 않는다(A-13)
            AuthSession.kind == _REFRESH,
            AuthSession.revoked_at.is_(None),
        )
        .values(revoked_at=revoked_at)
    )
    await session.flush()
    return result.rowcount or 0


# --- 회의별 단명 토큰 (A-13 · MF-69) ------------------------------------------


async def create_meeting_token(
    session: AsyncSession,
    *,
    account_id: int,
    meeting_id: int,
    token: str,
    expires_at: datetime,
) -> AuthSessionDTO:
    """**원문을 그대로** 넣는다(A-13). `refresh_token_hash` 는 NULL 이다."""
    row = AuthSession(
        account_id=account_id,
        kind=_MEETING,
        refresh_token_hash=None,
        meeting_id=meeting_id,
        meeting_token=token,
        expires_at=expires_at,
    )
    session.add(row)
    await session.flush()
    return _to_dto(row)


async def find_meeting_token(
    session: AsyncSession, token: str, *, now: datetime
) -> AuthSessionDTO | None:
    """원문 일치 · **만료 제외**. 없으면 `None` — 왜 없는지는 돌려주지 않는다(거부 사유를 흘리지 않는다).

    `revoked_at` 을 보지 않는다 — 회의 토큰은 회전하지 않아 그 칸을 쓰지 않는다(A-13).
    """
    row = (
        await session.scalars(
            select(AuthSession).where(
                AuthSession.kind == _MEETING,
                AuthSession.meeting_token == token,
                AuthSession.expires_at > now,
            )
        )
    ).one_or_none()

    if row is None:
        return None
    return _to_dto(row)


async def get_meeting_token(
    session: AsyncSession, *, meeting_id: int, now: datetime
) -> str | None:
    """제출부(웜스타트 · 배치 · 최종)가 **원문을 읽는 유일한 경로**다. 만료면 `None`.

    회의당 하나(A-13)라 `one_or_none()` 이 맞다 — 두 행이 나오면 발급 경로가 깨진 것이고 조용히 하나를 고르지 않는다.
    """
    return (
        await session.scalars(
            select(AuthSession.meeting_token).where(
                AuthSession.kind == _MEETING,
                AuthSession.meeting_id == meeting_id,
                AuthSession.expires_at > now,
            )
        )
    ).one_or_none()


async def delete_meeting_tokens(session: AsyncSession, *, meeting_id: int) -> int:
    """**폐기 = 행 DELETE**(A-13). `revoked_at` 을 찍지 않는다. 지운 행 수를 돌려준다(0 이어도 정상)."""
    result = await session.execute(
        delete(AuthSession).where(
            AuthSession.kind == _MEETING, AuthSession.meeting_id == meeting_id
        )
    )
    await session.flush()
    return result.rowcount or 0
