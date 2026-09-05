"""2층 — 도메인 규칙. `fastapi` 도 `schemas/` 도 import 하지 않는다."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from dto.health import HealthDTO
from repository import health_repository


async def check_health(session: AsyncSession) -> HealthDTO:
    """DB 왕복이 성공해야만 `ok` 를 돌려준다.

    실패는 repository 가 던진 도메인 예외로 올라간다 — 여기서 기본값으로 때우지 않는다.
    """
    await health_repository.ping(session)
    return HealthDTO(database="ok")
