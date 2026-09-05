"""3층 — SQL 만. DB 왕복 하나가 전부다."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.exc import InterfaceError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from core.exceptions import DatabaseUnavailableError


async def ping(session: AsyncSession) -> None:
    """DB 왕복을 **실제로** 한다(SPEC-000 §5 헬스 규칙).

    접속 불가는 SPEC-000 §4 가 열거한 설계된 실패다 — 도메인 예외로 바꿔 올린다.
    그 밖의 예외는 잡지 않고 그대로 전파한다(backend/README.md §8-1).
    """
    try:
        await session.execute(text("SELECT 1"))
    except (OperationalError, InterfaceError) as exc:
        raise DatabaseUnavailableError("데이터베이스에 연결할 수 없습니다") from exc
