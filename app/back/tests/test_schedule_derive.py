"""`schedule` 파생·겹침 — BE §12 필수 테스트 3 · 5 · 5-a · 9.

정본: `database/README.md` §3(파생 규칙 · 겹침 검사) · `domains/calendar.md` C-1~C-10.
이 파일은 **DB 제약과 서비스 규칙**을 본다 — HTTP 표면은 `test_task.py` 가 본다.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from core.exceptions import ConflictError
from dto.calendar import SchedulePlacementDTO
from dto.enums import ScheduleSourceType, TaskStatus
from models.calendar import Schedule
from models.task import Task, TaskAttachment, TaskRelation
from repository import schedule_repository
from service import schedule_service
from tests.task_fixtures import TaskOwner, create_owner  # noqa: F401
from tests.task_fixtures import owner  # noqa: F401

DAY = date(2026, 9, 10)


async def _task(
    session: AsyncSession,
    owner: TaskOwner,
    *,
    title: str = "업무",
    start_date: date | None = None,
    due_date: date | None = None,
    status: str = TaskStatus.TODO.value,
) -> Task:
    row = Task(
        account_id=owner.id,
        work_type_id=owner.work_type_id,
        title=title,
        status=status,
        start_date=start_date,
        due_date=due_date,
    )
    session.add(row)
    await session.flush()
    return row


async def _derive(session: AsyncSession, owner: TaskOwner, task: Task) -> None:
    await schedule_service.sync_from_task(
        session,
        account_id=owner.id,
        task_id=task.id,
        start_date=task.start_date,
        due_date=task.due_date,
    )


def _timed(start: time, end: time) -> SchedulePlacementDTO:
    """**시간 일정** 하나를 손으로 만든다.

    2026-09-06 확정으로 **업무는 시간 일정을 만들지 못한다**(항상 종일/기간이다).
    그래도 겹침 규칙 자체는 살아 있어야 한다 — 회의(WORK-006)가 그대로 쓸 구현이고,
    `schedule` 은 원본 종류를 가리지 않는 테이블이기 때문이다(§3-4 · SCH-5).
    그래서 배치를 파생이 아니라 **직접** 만들어 규칙만 시험한다.
    """
    tz = ZoneInfo(get_settings().app_timezone)
    return SchedulePlacementDTO(
        start_at=datetime.combine(DAY, start, tzinfo=tz),
        end_at=datetime.combine(DAY, end, tzinfo=tz),
        is_all_day=False,
    )


# --- DB 제약 (Phase 1 검증) ---------------------------------------------


async def test_a_reversed_plan_period_is_rejected_by_the_database(
    db_session: AsyncSession, owner: TaskOwner
) -> None:
    """T-1 — `start_date <= due_date`. 서비스가 아니라 **DB 가 최종 방어선**이다.

    이 자리에는 `due_*_time` CHECK 3종을 지키던 테스트가 있었다 —
    2026-09-06 확정으로 업무의 시각이 사라지면서 그 제약도 함께 사라졌다.
    """
    with pytest.raises(IntegrityError) as excinfo:
        await _task(
            db_session, owner, start_date=DAY + timedelta(days=1), due_date=DAY
        )

    assert "ck_task_plan_period_order" in str(excinfo.value)


async def test_a_doc_attachment_with_a_url_is_rejected_by_the_database(
    db_session: AsyncSession, owner: TaskOwner
) -> None:
    """T-9-a — `kind` 에 따라 채워지는 컬럼이 갈린다. DB CHECK 로 강제한다."""
    task = await _task(db_session, owner)

    db_session.add(
        TaskAttachment(
            task_id=task.id,
            role="reference",
            kind="doc",
            document_id=12,
            url="https://example.test",
        )
    )
    with pytest.raises(IntegrityError) as excinfo:
        await db_session.flush()

    assert "ck_task_attachment_kind_columns" in str(excinfo.value)


async def test_a_link_attachment_with_a_document_id_is_rejected_by_the_database(
    db_session: AsyncSession, owner: TaskOwner
) -> None:
    task = await _task(db_session, owner)

    db_session.add(
        TaskAttachment(
            task_id=task.id,
            role="reference",
            kind="link",
            document_id=12,
            url="https://example.test",
        )
    )
    with pytest.raises(IntegrityError) as excinfo:
        await db_session.flush()

    assert "ck_task_attachment_kind_columns" in str(excinfo.value)


async def test_the_same_relation_pair_cannot_be_inserted_twice(
    db_session: AsyncSession, owner: TaskOwner
) -> None:
    """T-10 — 무방향 1행. `(low, high)` 정규화 + UNIQUE 로 DB 가 막는다."""
    first = await _task(db_session, owner, title="A")
    second = await _task(db_session, owner, title="B")
    low, high = sorted((first.id, second.id))

    db_session.add(TaskRelation(low_task_id=low, high_task_id=high))
    await db_session.flush()

    db_session.add(TaskRelation(low_task_id=low, high_task_id=high))
    with pytest.raises(IntegrityError) as excinfo:
        await db_session.flush()

    assert "uq_task_relation_low_high" in str(excinfo.value)


async def test_a_reversed_relation_pair_is_rejected_by_the_check(
    db_session: AsyncSession, owner: TaskOwner
) -> None:
    """순서를 뒤집어 넣으려는 시도는 `low < high` CHECK 가 먼저 막는다."""
    first = await _task(db_session, owner, title="A")
    second = await _task(db_session, owner, title="B")
    low, high = sorted((first.id, second.id))

    db_session.add(TaskRelation(low_task_id=high, high_task_id=low))
    with pytest.raises(IntegrityError) as excinfo:
        await db_session.flush()

    assert "ck_task_relation_order" in str(excinfo.value)


async def test_a_task_cannot_relate_to_itself_at_the_database_level(
    db_session: AsyncSession, owner: TaskOwner
) -> None:
    task = await _task(db_session, owner)

    db_session.add(TaskRelation(low_task_id=task.id, high_task_id=task.id))
    with pytest.raises(IntegrityError) as excinfo:
        await db_session.flush()

    assert "ck_task_relation_order" in str(excinfo.value)


# --- BE §12-5 파생 -------------------------------------------------------


async def test_a_due_date_alone_derives_an_all_day_schedule(
    db_session: AsyncSession, owner: TaskOwner
) -> None:
    """C-5-a — 기한만 있으면 **종일 일정**. 범위는 그 날짜 `00:00`~다음 날 `00:00`(KST)."""
    task = await _task(db_session, owner, due_date=DAY)

    await _derive(db_session, owner, task)

    placement = await schedule_service.find_task_placement(db_session, task_id=task.id)
    assert placement is not None
    assert placement.is_all_day is True

    tz = ZoneInfo(get_settings().app_timezone)
    assert placement.start_at.astimezone(tz) == datetime.combine(DAY, time.min, tzinfo=tz)
    assert placement.end_at.astimezone(tz) == datetime.combine(
        DAY + timedelta(days=1), time.min, tzinfo=tz
    )


async def test_a_plan_period_derives_a_multi_day_band(
    db_session: AsyncSession, owner: TaskOwner
) -> None:
    """T-1-d — 시작일이 붙으면 **기간 일정**이 된다. 같은 행이 갱신된다(SCH-3)."""
    task = await _task(db_session, owner, due_date=DAY)
    await _derive(db_session, owner, task)

    task.start_date = DAY - timedelta(days=2)
    await db_session.flush()
    await _derive(db_session, owner, task)

    placement = await schedule_service.find_task_placement(db_session, task_id=task.id)
    assert placement is not None
    # **업무는 언제나 종일이다** — 시간 그리드에 뜨는 것은 회의뿐이다
    assert placement.is_all_day is True

    tz = ZoneInfo(get_settings().app_timezone)
    assert placement.start_at.astimezone(tz) == datetime.combine(
        DAY - timedelta(days=2), time.min, tzinfo=tz
    )
    assert placement.end_at.astimezone(tz) == datetime.combine(
        DAY + timedelta(days=1), time.min, tzinfo=tz
    )

    rows = (
        await db_session.scalars(
            select(Schedule).where(Schedule.source_id == task.id)
        )
    ).all()
    assert len(rows) == 1


async def test_a_start_date_alone_derives_one_all_day(
    db_session: AsyncSession, owner: TaskOwner
) -> None:
    """T-1-d — 시작일만 있으면 **그 하루**다. 끝이 없어 무한 바를 그릴 수 없다."""
    task = await _task(db_session, owner, start_date=DAY)

    await _derive(db_session, owner, task)

    placement = await schedule_service.find_task_placement(db_session, task_id=task.id)
    assert placement is not None
    assert placement.is_all_day is True

    tz = ZoneInfo(get_settings().app_timezone)
    assert placement.start_at.astimezone(tz) == datetime.combine(DAY, time.min, tzinfo=tz)
    assert placement.end_at.astimezone(tz) == datetime.combine(
        DAY + timedelta(days=1), time.min, tzinfo=tz
    )


async def test_clearing_the_due_date_removes_the_schedule_row(
    db_session: AsyncSession, owner: TaskOwner
) -> None:
    """§3-3 · SCH-4 — **계획이 둘 다** 없어지면 행이 사라진다. 계획 없는 업무는 일정이 없다."""
    task = await _task(db_session, owner, start_date=DAY, due_date=DAY)
    await _derive(db_session, owner, task)
    assert await schedule_service.find_task_placement(db_session, task_id=task.id)

    # 기한만 지우면 시작일 하루로 **남는다** — 계획이 아직 있다
    task.due_date = None
    await db_session.flush()
    await _derive(db_session, owner, task)
    assert await schedule_service.find_task_placement(db_session, task_id=task.id)

    task.start_date = None
    await db_session.flush()
    await _derive(db_session, owner, task)

    assert await schedule_service.find_task_placement(db_session, task_id=task.id) is None


async def test_a_task_with_no_due_date_never_gets_a_row(
    db_session: AsyncSession, owner: TaskOwner
) -> None:
    task = await _task(db_session, owner)

    await _derive(db_session, owner, task)

    assert await schedule_service.find_task_placement(db_session, task_id=task.id) is None


# --- BE §12-3 겹침 -------------------------------------------------------


async def _placed(
    session: AsyncSession, owner: TaskOwner, start: time, end: time, **kwargs: object
) -> Task:
    """`task` 원본 + **시간 일정** 한 행. 배치는 `_timed` 로 직접 만든다(위 docstring 참조).

    원본을 함께 두는 이유는 겹침 검사가 **원본을 조인해** 취소·삭제분을 거르기 때문이다(§3-4).
    """
    task = await _task(session, owner, due_date=DAY, **kwargs)  # type: ignore[arg-type]
    await schedule_repository.upsert(
        session,
        account_id=owner.id,
        source_type=ScheduleSourceType.TASK.value,
        source_id=task.id,
        placement=_timed(start, end),
    )
    return task


async def _check(
    session: AsyncSession, owner: TaskOwner, start: time | None, end: time | None
) -> None:
    placement = (
        schedule_service.build_placement(None, DAY)
        if start is None or end is None
        else _timed(start, end)
    )
    await schedule_service.check_overlap(
        session, account_id=owner.id, placement=placement
    )


async def test_timed_schedules_block_each_other(
    db_session: AsyncSession, owner: TaskOwner
) -> None:
    await _placed(db_session, owner, time(14, 0), time(15, 0))

    with pytest.raises(ConflictError) as excinfo:
        await _check(db_session, owner, time(14, 30), time(15, 30))

    assert excinfo.value.code == "schedule_overlap"
    assert excinfo.value.status == 409


@pytest.mark.parametrize(
    ("start", "end"),
    [
        (time(15, 0), time(16, 0)),  # C-8 — 끝시각 = 시작시각 (14–15 다음 15–16)
        (time(13, 0), time(14, 0)),  # C-8 — 시작시각 = 끝시각 (13–14 앞 14–15)
        (time(16, 0), time(17, 0)),  # 아예 떨어져 있다
    ],
)
async def test_touching_boundaries_are_not_an_overlap(
    db_session: AsyncSession, owner: TaskOwner, start: time, end: time
) -> None:
    """C-8 — 판정식은 `start < :end AND end > :start`. **경계 접촉은 겹침이 아니다.**"""
    await _placed(db_session, owner, time(14, 0), time(15, 0))

    await _check(db_session, owner, start, end)  # 예외가 없으면 통과다


async def test_all_day_schedules_are_not_checked(
    db_session: AsyncSession, owner: TaskOwner
) -> None:
    """C-6 — 대상은 `is_all_day = false` 끼리만. 종일은 그 시간을 점유한 게 아니다."""
    await _task(db_session, owner, due_date=DAY)
    all_day = await _task(db_session, owner, title="종일", due_date=DAY)
    await _derive(db_session, owner, all_day)

    # 종일이 시간 일정을 막지 않는다
    await _check(db_session, owner, time(14, 0), time(15, 0))

    # 시간 일정도 종일을 막지 않는다
    await _placed(db_session, owner, time(14, 0), time(15, 0), title="시간")
    await _check(db_session, owner, None, None)


async def test_a_cancelled_task_does_not_block(
    db_session: AsyncSession, owner: TaskOwner
) -> None:
    """C-10 — 취소된 일정은 검사에서 빠진다. `schedule` 에 상태를 복제하지 않고 원본을 조인한다."""
    await _placed(
        db_session, owner, time(14, 0), time(15, 0), status=TaskStatus.CANCELLED.value
    )

    await _check(db_session, owner, time(14, 0), time(15, 0))


async def test_a_soft_deleted_task_does_not_block(
    db_session: AsyncSession, owner: TaskOwner
) -> None:
    """C-10 — 소프트 딜리트분도 빠진다. `schedule` 행은 그대로 두고 조회가 거른다(§3-3)."""
    blocker = await _placed(db_session, owner, time(14, 0), time(15, 0))
    blocker.deleted_at = datetime.now(UTC)
    await db_session.flush()

    await _check(db_session, owner, time(14, 0), time(15, 0))

    # 행 자체는 남아 있다 — 조회가 거를 뿐이다
    assert await schedule_service.find_task_placement(db_session, task_id=blocker.id)


async def test_another_account_does_not_block(
    client, db_session: AsyncSession, owner: TaskOwner
) -> None:
    """겹침은 **같은 계정 안에서만** 본다(G-5)."""
    other = await create_owner(client, db_session, "schedule_stranger")
    await _placed(db_session, other, time(14, 0), time(15, 0))

    await _check(db_session, owner, time(14, 0), time(15, 0))


async def test_a_task_does_not_block_itself(
    db_session: AsyncSession, owner: TaskOwner
) -> None:
    """자기 옛 일정과는 겹치지 않는다 — 같은 업무의 기한을 고치는 경우다."""
    task = await _placed(db_session, owner, time(14, 0), time(15, 0))

    await schedule_service.check_overlap(
        db_session,
        account_id=owner.id,
        placement=_timed(time(14, 30), time(15, 30)),
        exclude_source_type=ScheduleSourceType.TASK.value,
        exclude_source_id=task.id,
    )


# --- BE §12-5-a 조인 없음 · §12-9 고아 없음 ------------------------------


async def test_the_due_date_sort_plan_never_touches_schedule(
    db_session: AsyncSession, owner: TaskOwner
) -> None:
    """BE §12-5-a — **기한 정렬에 조인이 없다.**

    DEC-005 §3 개정의 목적이 이것이다. 실행 계획에 `schedule` 이 등장하면 실패다.
    """
    await _placed(db_session, owner, time(14, 0), time(15, 0))

    plan = (
        await db_session.execute(
            text(
                "EXPLAIN SELECT id, title, due_date FROM task"
                " WHERE account_id = :account_id AND deleted_at IS NULL"
                " ORDER BY due_date NULLS LAST"
            ),
            {"account_id": owner.id},
        )
    ).scalars().all()

    assert "schedule" not in "\n".join(plan).lower()


async def test_there_are_no_orphan_schedules(
    db_session: AsyncSession, owner: TaskOwner
) -> None:
    """BE §12-9 — **고아 `schedule` 이 없다.**

    FK 를 안 걸었으므로(§3-4) 테스트가 대신 잡는다. 파생 경로를 지난 뒤
    `source_id` 가 전부 살아 있는 행을 가리켜야 한다.
    """
    kept = await _placed(db_session, owner, time(14, 0), time(15, 0), title="남는 것")
    removed = await _task(db_session, owner, title="기한 지울 것", due_date=DAY)
    await _derive(db_session, owner, removed)
    removed.due_date = None
    await db_session.flush()
    await _derive(db_session, owner, removed)

    orphans = (
        await db_session.execute(
            text(
                "SELECT s.id FROM schedule s"
                " LEFT JOIN task t ON t.id = s.source_id AND s.source_type = 'task'"
                " WHERE s.source_type = 'task' AND t.id IS NULL"
            )
        )
    ).scalars().all()

    assert orphans == []
    assert await schedule_service.find_task_placement(db_session, task_id=kept.id)
    assert await schedule_service.find_task_placement(db_session, task_id=removed.id) is None
