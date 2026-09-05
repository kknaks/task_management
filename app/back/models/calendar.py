"""calendar 도메인 — `schedule` 하나뿐.

**캘린더는 데이터를 소유하지 않는다.** `schedule` 조차 소유가 아니라 **파생**이다 —
원본은 업무의 기한(`task.due_*`)과 회의의 일시다(C-1 · §3-1).

정본은 `database/README.md` §3 · `domains/calendar.md` C-1~C-14.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from dto.enums import ScheduleSourceType
from models.base import Base, TimestampMixin, pk_column

_SOURCE_TYPE_VALUES = ", ".join(f"'{value}'" for value in ScheduleSourceType)


class Schedule(Base, TimestampMixin):
    """시간축 배치의 **파생** 테이블.

    SCH-1 — **아무도 직접 쓰지 않는다.** 쓰는 곳은 `service/schedule_service.py` 하나다.
    C-5 — 담는 것은 **시간축 배치뿐**(`start_at`·`end_at`·`is_all_day`).
          기한 같은 도메인 속성을 담지 않는다.
    C-5-c — 소프트 딜리트·취소 상태를 **복제하지 않는다.** 조회·검사가 원본을 조인해 거른다.
    """

    __tablename__ = "schedule"

    id: Mapped[int] = pk_column()
    account_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("account.id", name="fk_schedule_account_id"),
        nullable=False,
    )
    source_type: Mapped[str] = mapped_column(String(20), nullable=False)
    # C-5-b · §3-4 — **FK 를 걸지 않는다.** v2 `external` 은 우리 테이블에 원본 행이 없어
    # FK 가 그 자리를 막는다. 참조 정합은 서비스 불변식과 테스트(고아 점검)로 지킨다.
    source_id: Mapped[int] = mapped_column(BigInteger, nullable=False)

    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # C-5-a — 기한만 있으면 종일, 시각까지 있으면 시간 일정.
    is_all_day: Mapped[bool] = mapped_column(Boolean, nullable=False)

    __table_args__ = (
        CheckConstraint(
            f"source_type IN ({_SOURCE_TYPE_VALUES})", name="ck_schedule_source_type"
        ),
        CheckConstraint("end_at > start_at", name="ck_schedule_time_order"),
        # SCH-3 — 업무·회의는 일정을 0..1개 갖는다
        UniqueConstraint(
            "source_type", "source_id", name="uq_schedule_source_type_source_id"
        ),
        # §4 — **캘린더 기간 조회와 겹침 검사가 둘 다 이 하나를 탄다**
        Index("ix_schedule_account_id_start_at_end_at", "account_id", "start_at", "end_at"),
    )
