"""3층 — ORM/SQL 만. **ORM 모델을 밖으로 내지 않는다**(backend/README.md §2 · §3 규칙 2)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dto.auth import AccountCredentialDTO, AccountSummaryDTO
from models.account import Account, Career


async def find_credential_by_login_id(
    session: AsyncSession, login_id: str
) -> AccountCredentialDTO | None:
    """자격 증명 대조용 최소 컬럼만 읽는다. 판정은 service 가 한다."""
    row = (
        await session.execute(
            select(Account.id, Account.password_hash).where(Account.login_id == login_id)
        )
    ).one_or_none()

    if row is None:
        return None
    return AccountCredentialDTO(id=row.id, password_hash=row.password_hash)


async def find_summary_by_id(
    session: AsyncSession, account_id: int
) -> AccountSummaryDTO | None:
    """계정 요약 + 「현재」 경력에서 파생한 소속(A-3).

    `career` 를 `ended_on IS NULL` 로 좁혀 왼쪽 조인한다 — 재직 중 경력이 없으면
    `department` 가 `None` 이고, 사이드바 캡션은 프론트가 비운다.
    재직 중 행이 여럿이면 **가장 최근 시작**을 쓴다.
    """
    current_career = (
        select(Career.department)
        .where(Career.account_id == account_id, Career.ended_on.is_(None))
        .order_by(Career.started_on.desc(), Career.id.desc())
        .limit(1)
        .scalar_subquery()
    )

    row = (
        await session.execute(
            select(
                Account.id,
                Account.login_id,
                Account.name,
                Account.email,
                Account.avatar_path,
                current_career.label("department"),
            ).where(Account.id == account_id)
        )
    ).one_or_none()

    if row is None:
        return None
    return AccountSummaryDTO(
        id=row.id,
        login_id=row.login_id,
        name=row.name,
        email=row.email,
        avatar_url=row.avatar_path,
        department=row.department,
    )
