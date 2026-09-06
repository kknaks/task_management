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
    start_date: date | None, due_date: date | None
) -> SchedulePlacementDTO | None:
    """**계획 기간** → 시간축 배치(T-1-d · `database/README` §3-1, 2026-09-06 개정).

    **업무는 항상 종일/기간이다**(2026-09-06 사용자 확정 — 업무의 시간 지정을 없앴다).
    시안 어디에도 업무에 시간을 받는 UI 가 없고, **시간이 있는 것은 회의뿐**이다
    (회의 일시는 `meeting.start_at`·`end_at` 이 소유한다).

    **실적(`started_at`·`completed_at`)은 캘린더에 쓰지 않는다** — 캘린더는 계획만 그린다.
    그래서 이 함수는 실적을 인자로 받지도 않는다.

    | 업무가 가진 것 | 배치 |
    |---|---|
    | `start_date` + `due_date` | **기간 일정** — 시작일 `00:00` ~ 종료일 **다음 날** `00:00` |
    | `due_date` 만 | 그 날의 **종일 일정 하루** |
    | `start_date` 만 | 시작일 하루의 종일 일정. 끝이 없어 무한 바를 그릴 수 없다 |
    | 둘 다 없음 | **행이 없다**(SCH-4) — 「내 업무」 오늘 화면에만 매일 뜬다 |

    계획이 하나라도 있으면 그것이 시작이자 끝이 된다(하루짜리 밴드).
    """
    band_start = start_date or due_date
    band_end = due_date or start_date
    if band_start is None or band_end is None:
        return None

    tz = _app_timezone()
    return SchedulePlacementDTO(
        start_at=datetime.combine(band_start, time.min, tzinfo=tz),
        # 종일의 끝은 **다음 날 `00:00`**(KST)이다(§3-3) — 기간이면 마지막 날을 통째로 덮는다
        end_at=datetime.combine(band_end + timedelta(days=1), time.min, tzinfo=tz),
        is_all_day=True,
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

    **지금 이 검사에 걸리는 업무는 없다** — 2026-09-06 확정으로 업무의 시간 지정이 사라져
    업무의 배치는 항상 종일이다. 그래도 함수를 지우지 않는다: 겹침 규칙(DEC-005 §7)의
    **단일 구현**이고 회의가 붙는 순간(WORK-006 `sync_from_meeting`) 그대로 쓰인다.
    두 번째 구현을 만들지 않기 위해 여기 남는다.
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
    start_date: date | None,
    due_date: date | None,
) -> None:
    """업무의 **계획 기간**을 `schedule` 로 내린다. **원본 쓰기와 같은 트랜잭션**이다(§3-4).

    계획이 둘 다 없어지면 행을 **삭제**한다(§3-3 · T-1-d 마지막 줄).
    """
    placement = build_placement(start_date, due_date)
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
