"""SPEC-008 §4 · BE §6 — job 의 프론트 ↔ 백 계약. `GET /api/jobs/{jobId}` · `202 { jobId }`."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from dto.job import JobDetailDTO, JobProgressDTO
from schemas.base import CamelModel

JobStatusValue = Literal["queued", "running", "succeeded", "failed"]
JobErrorCodeValue = Literal["integration_failed", "integration_timeout", "job_timeout"]
JobPhaseValue = Literal["final_batch", "integration"]


class JobAccepted(CamelModel):
    """`POST …/end` · `POST …/integrate` → `202 { jobId }`. 작업 결과는 담지 않는다(BE §6)."""

    job_id: int


class JobProgress(CamelModel):
    """**파생**(컬럼 없음) — `phase` 는 파이프라인 단계, `attempt` 는 통합 시도 회차(1~3 · ① 동안 0)."""

    phase: JobPhaseValue
    attempt: int

    @classmethod
    def from_dto(cls, dto: JobProgressDTO) -> "JobProgress":
        return cls(phase=dto.phase, attempt=dto.attempt)  # type: ignore[arg-type]


class JobItem(CamelModel):
    """`GET /api/jobs/{jobId}` — BE §6 L160 그대로. `kind≠meeting_finalize` 면 `progress` 는 `null`."""

    id: int
    kind: str
    status: JobStatusValue
    progress: JobProgress | None
    error_code: JobErrorCodeValue | None
    error_message: str | None
    finished_at: datetime | None

    @classmethod
    def from_dto(cls, dto: JobDetailDTO) -> "JobItem":
        job = dto.job
        return cls(
            id=job.id,
            kind=job.kind,
            status=job.status,  # type: ignore[arg-type]
            progress=None if dto.progress is None else JobProgress.from_dto(dto.progress),
            error_code=job.error_code,  # type: ignore[arg-type]
            error_message=job.error_message,
            finished_at=job.finished_at,
        )
