"""1층 — HTTP 만. `GET /api/jobs/{jobId}` 하나(BE §6 · §10 · SPEC-008 §4).

폴링 표면이다 — 2초 간격 · 종결(`succeeded`/`failed`)에서 멈춘다. 결과는 담지 않으므로 종결 뒤 프론트는 원 리소스를 다시 읽는다.
남의 job 은 404(§9).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_db, require_account
from schemas.job import JobItem
from service import job_service

router = APIRouter(
    prefix="/api/jobs",
    tags=["job"],
    dependencies=[Depends(require_account)],
)


@router.get("/{job_id}", response_model=JobItem, response_model_by_alias=True)
async def get_job(
    job_id: int,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> JobItem:
    return JobItem.from_dto(
        await job_service.get_detail(session, account_id=account_id, job_id=job_id)
    )
