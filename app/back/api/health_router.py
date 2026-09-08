"""1층 — HTTP 만. `GET /api/health` 는 **인증 게이트 밖**이다(SPEC-000 §4)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_db
from config import Settings, get_settings
from schemas.health import HealthResponse
from service import health_service

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health", response_model=HealthResponse, response_model_by_alias=True)
async def get_health(
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> HealthResponse:
    dto = await health_service.check_health(session)
    return HealthResponse.from_dto(dto, version=settings.app_version)
