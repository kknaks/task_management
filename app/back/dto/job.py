"""job 도메인의 내부 dto(BE §6 · SPEC-008 §4 `GET /api/jobs/{jobId}`)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

__all__ = ["JobDTO", "JobProgressDTO", "JobDetailDTO"]


@dataclass(frozen=True)
class JobDTO:
    """`job` 행 한 건. 결과를 담지 않는다(BE §6)."""

    id: int
    account_id: int
    kind: str
    target_type: str
    target_id: int
    status: str
    attempt: int
    error_code: str | None
    error_message: str | None
    finished_at: datetime | None
    created_at: datetime


@dataclass(frozen=True)
class JobProgressDTO:
    """`progress{phase, attempt}` — **파생**(컬럼 없음). `kind≠meeting_finalize` 면 상세에서 `None` 이다."""

    phase: str
    attempt: int


@dataclass(frozen=True)
class JobDetailDTO:
    job: JobDTO
    progress: JobProgressDTO | None
