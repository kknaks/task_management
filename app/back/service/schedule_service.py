"""2층 — **겹침 검사와 `schedule` 파생. 둘 다 여기 하나뿐이다**(BE §4 · SCH-1).

`schedule` 을 읽고 쓰는 경로는 이 파일을 지난다 — `repository/schedule_repository.py` 를
import 하는 곳이 여기 말고 있으면 파생이 두 곳에서 일어난다(정적 검사 대상).

원본은 업무의 기한과 회의의 일시이고 `schedule` 은 그 **파생**이다(C-1 · C-2).
**방향은 한 쪽뿐**이라 `schedule` 을 고쳐 원본을 바꾸는 경로는 없다(C-3 · SCH-2).

WORK-006 이 회의를 붙일 때는 `sync_from_meeting` 을 **여기에** 더한다 —
두 번째 구현을 만들지 않는다(WP Dependency).
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from core.exceptions import ConflictError
from dto.calendar import SchedulePlacementDTO
from dto.enums import ScheduleSourceType
from repository import schedule_repository

# SPEC-003 §4 Case Matrix — 문구까지 계약이다.
_OVERLAP = "그 시간에 다른 일정이 있습니다"


def _app_timezone() -> ZoneInfo:
    """`date`/`time` → `timestamptz` 변환 기준은 **앱 타임존(KST)** 이다(§3-3).

    `APP_TIMEZONE` 은 WORK-001 이 이미 잡았다 — 이 work 는 신규 env 를 만들지 않는다.
    """
    return ZoneInfo(get_settings().app_timezone)


def build_placement(
    due_date: date | None,
    due_start_time: time | None,
    due_end_time: time | None,
) -> SchedulePlacementDTO | None:
    """기한 → 시간축 배치. 기한이 없으면 **일정이 없다**(SCH-4).

    C-5-a — 기한만 있으면 **종일**(그 날짜 `00:00`~다음 날 `00:00` KST),
    시각까지 있으면 **시간 일정**이다.
    """
    if due_date is None:
        return None

    tz = _app_timezone()

    if due_start_time is None or due_end_time is None:
        start_at = datetime.combine(due_date, time.min, tzinfo=tz)
        return SchedulePlacementDTO(
            start_at=start_at,
            end_at=datetime.combine(due_date + timedelta(days=1), time.min, tzinfo=tz),
            is_all_day=True,
        )

    return SchedulePlacementDTO(
        start_at=datetime.combine(due_date, due_start_time, tzinfo=tz),
        end_at=datetime.combine(due_date, due_end_time, tzinfo=tz),
        is_all_day=False,
    )


async def check_overlap(
    session: AsyncSession,
    *,
    account_id: int,
    placement: SchedulePlacementDTO | None,
    exclude_source_type: str | None = None,
    exclude_source_id: int | None = None,
) -> None:
    """겹치면 **거부한다** — 경고만 하고 통과시키지 않는다(C-9).

    **원본을 쓰기 전에** 파생될 배치로 검사한다. 걸리면 원본도 바뀌지 않는다.
    종일·무일정은 검사 대상이 아니다(C-6).
    """
    if placement is None or placement.is_all_day:
        return

    overlapping = await schedule_repository.find_overlapping(
        session,
        account_id=account_id,
        start_at=placement.start_at,
        end_at=placement.end_at,
        exclude_source_type=exclude_source_type,
        exclude_source_id=exclude_source_id,
    )
    if overlapping:
        raise ConflictError(_OVERLAP, code="schedule_overlap")


async def sync_from_task(
    session: AsyncSession,
    *,
    account_id: int,
    task_id: int,
    due_date: date | None,
    due_start_time: time | None,
    due_end_time: time | None,
) -> None:
    """업무의 기한을 `schedule` 로 내린다. **원본 쓰기와 같은 트랜잭션**이다(§3-4).

    기한이 없어지면 행을 **삭제**한다(§3-3).
    """
    placement = build_placement(due_date, due_start_time, due_end_time)
    source_type = ScheduleSourceType.TASK.value

    if placement is None:
        await schedule_repository.delete_for_source(
            session, source_type=source_type, source_id=task_id
        )
        return

    await schedule_repository.upsert(
        session,
        account_id=account_id,
        source_type=source_type,
        source_id=task_id,
        placement=placement,
    )


async def find_task_placement(
    session: AsyncSession, *, task_id: int
) -> SchedulePlacementDTO | None:
    """파생 결과 조회. **소프트 딜리트해도 행은 그대로 둔다**(§3-3) — 조회가 원본으로 거른다."""
    return await schedule_repository.find_placement(
        session, source_type=ScheduleSourceType.TASK.value, source_id=task_id
    )
