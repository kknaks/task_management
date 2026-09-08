"""3층 — `schedule` 의 ORM/SQL 만.

**이 파일을 부르는 곳은 `service/schedule_service.py` 하나다**(SCH-1).
다른 service·router 가 여기를 import 하면 파생이 두 곳에서 일어난다 — 정적 검사로 잡는다.

C-5-c — 소프트 딜리트·취소 상태를 `schedule` 에 **복제하지 않는다.**
검사·조회는 `source_type` 으로 갈라 **원본을 조인해 거른다**.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import and_, delete, exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from dto.calendar import SchedulePlacementDTO
from dto.enums import ScheduleSourceType, TaskStatus
from models.calendar import Schedule
from models.meeting import Meeting
from models.task import Task


def _inactive_task_source() -> object:
    """원본이 **소프트 딜리트됐거나 취소된 업무**인 `schedule` 행을 가리키는 조건(C-10).

    다른 `source_type` 은 여기 걸리지 않는다 — **모르는 원본은 살아 있는 것으로 본다.**
    겹침 검사에서 빠뜨리는 쪽(=충돌을 놓치는 쪽)보다 막는 쪽이 안전하다.
    """
    return exists().where(
        and_(
            Schedule.source_type == ScheduleSourceType.TASK.value,
            Task.id == Schedule.source_id,
            or_(
                Task.deleted_at.is_not(None),
                Task.status == TaskStatus.CANCELLED.value,
            ),
        )
    )


def _inactive_meeting_source() -> object:
    """원본이 **소프트 딜리트된 회의**인 `schedule` 행(WORK-006 · SPEC-006 §4 「소프트 딜리트분은 검사 제외」).

    회의에는 취소 상태가 없다(DEC-003 §3) — 삭제만 본다. 행은 남고 여기서 거른다(§3-3).
    """
    return exists().where(
        and_(
            Schedule.source_type == ScheduleSourceType.MEETING.value,
            Meeting.id == Schedule.source_id,
            Meeting.deleted_at.is_not(None),
        )
    )


async def find_overlapping(
    session: AsyncSession,
    *,
    account_id: int,
    start_at: datetime,
    end_at: datetime,
    exclude_source_type: str | None = None,
    exclude_source_id: int | None = None,
) -> bool:
    """겹치는 **시간 일정**이 있는가.

    판정식은 `start_at < :end AND end_at > :start` — **경계 접촉은 겹침이 아니다**(C-8).
    대상은 `is_all_day = false` 끼리이고 **종류를 가리지 않는다**(C-6 · C-7).
    """
    query = select(Schedule.id).where(
        Schedule.account_id == account_id,
        Schedule.is_all_day.is_(False),
        Schedule.start_at < end_at,
        Schedule.end_at > start_at,
        ~_inactive_task_source(),
        ~_inactive_meeting_source(),
    )

    if exclude_source_type is not None and exclude_source_id is not None:
        # 자기 자신의 옛 행은 비교 대상이 아니다 — 같은 업무의 기한을 고치는 경우다.
        query = query.where(
            or_(
                Schedule.source_type != exclude_source_type,
                Schedule.source_id != exclude_source_id,
            )
        )

    return (await session.scalars(query.limit(1))).one_or_none() is not None


async def upsert(
    session: AsyncSession,
    *,
    account_id: int,
    source_type: str,
    source_id: int,
    placement: SchedulePlacementDTO,
) -> None:
    """`UNIQUE (source_type, source_id)` 기준 0..1 행을 맞춘다(SCH-3)."""
    row = (
        await session.scalars(
            select(Schedule).where(
                Schedule.source_type == source_type, Schedule.source_id == source_id
            )
        )
    ).one_or_none()

    if row is None:
        session.add(
            Schedule(
                account_id=account_id,
                source_type=source_type,
                source_id=source_id,
                start_at=placement.start_at,
                end_at=placement.end_at,
                is_all_day=placement.is_all_day,
            )
        )
    else:
        row.start_at = placement.start_at
        row.end_at = placement.end_at
        row.is_all_day = placement.is_all_day

    await session.flush()


async def delete_for_source(
    session: AsyncSession, *, source_type: str, source_id: int
) -> None:
    """기한이 없어지면 행이 **사라진다**(§3-3 · SCH-4). 없으면 아무 일도 없다."""
    await session.execute(
        delete(Schedule).where(
            Schedule.source_type == source_type, Schedule.source_id == source_id
        )
    )
    await session.flush()


async def find_placement(
    session: AsyncSession, *, source_type: str, source_id: int
) -> SchedulePlacementDTO | None:
    """테스트·검증이 파생 결과를 확인하는 경로. 쓰기가 아니다."""
    row = (
        await session.scalars(
            select(Schedule).where(
                Schedule.source_type == source_type, Schedule.source_id == source_id
            )
        )
    ).one_or_none()

    if row is None:
        return None
    return SchedulePlacementDTO(
        start_at=row.start_at, end_at=row.end_at, is_all_day=row.is_all_day
    )
