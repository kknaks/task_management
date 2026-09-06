"""`job` — 장시간 작업의 **정본 행**(BE §5-3 · §6 · ERD `job`). 실행은 back 프로세스의 asyncio 태스크가 한다.

- `kind` 는 v1 에 `meeting_finalize` 하나. `(target_type, target_id)` 가 어느 리소스의 작업인지 가리킨다 —
  `activeJobId` 파생과 기동 스윕이 이 쌍으로 찾는다.
- **`progress{phase, attempt}` 는 컬럼이 아니다**(G-7) — `attempt` 만 여기 있고 `phase` 는 `job_service` 가 파생한다.
- `error_code` 는 SPEC-008 §4 의 3종만(CHECK). 그 밖의 실패는 코드를 발명하지 않고 전파한다(BE §8-1).
- 결과를 담지 않는다(BE §6) — 종결 뒤 프론트는 원 리소스(`GET /api/meetings/{id}`)를 다시 읽는다.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from dto.enums import JobErrorCode, JobKind, JobStatus, JobTargetType
from models.base import Base, TimestampMixin, pk_column

_KIND_VALUES = ", ".join(f"'{value}'" for value in JobKind)
_TARGET_VALUES = ", ".join(f"'{value}'" for value in JobTargetType)
_STATUS_VALUES = ", ".join(f"'{value}'" for value in JobStatus)
_ERROR_CODE_VALUES = ", ".join(f"'{value}'" for value in JobErrorCode)


class Job(Base, TimestampMixin):
    __tablename__ = "job"

    id: Mapped[int] = pk_column()
    account_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("account.id", name="fk_job_account_id"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    target_type: Mapped[str] = mapped_column(String(20), nullable=False)
    target_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text(f"'{JobStatus.QUEUED.value}'")
    )
    # 통합 시도 회차 1~3 — `progress.attempt` 의 원천. ① 마지막 배치 동안은 0
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    error_code: Mapped[str | None] = mapped_column(String(30), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint(f"kind IN ({_KIND_VALUES})", name="ck_job_kind"),
        CheckConstraint(f"target_type IN ({_TARGET_VALUES})", name="ck_job_target_type"),
        CheckConstraint(f"status IN ({_STATUS_VALUES})", name="ck_job_status"),
        CheckConstraint(
            f"error_code IS NULL OR error_code IN ({_ERROR_CODE_VALUES})", name="ck_job_error_code"
        ),
        # §4 — 폴링(본인 것) · 기동 스윕(미종결)
        Index("ix_job_account_id_status", "account_id", "status"),
        # §4 — `activeJobId` 파생
        Index("ix_job_target_type_target_id", "target_type", "target_id"),
    )
