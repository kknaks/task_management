"""WORK-006 Phase 1 — 회의 도메인 제약 · `schedule` 파생 · 겹침(BE §12 필수 3 · 5 · 9 의 회의 쪽).

정본: `database/README.md` §3(파생 규칙 · 겹침 검사) · `domains/meeting.md` M-1 · M-5 · M-17.
이 파일은 **DB 제약과 서비스 규칙**을 본다 — HTTP 계약은 `test_meeting.py` 가 본다.
"""

from __future__ import annotations

from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from core.exceptions import ConflictError
from dto.calendar import SchedulePlacementDTO
from dto.enums import ScheduleSourceType
from models.meeting import Meeting, MeetingAgenda, MeetingAttachment, MeetingLine
from models.task import Task
from repository import schedule_repository
from service import schedule_service
from tests.meeting_fixtures import (  # noqa: F401
    BASE,
    END,
    START,
    MeetingOwner,
    create_meeting,
    create_meeting_owner,
    iso,
    owner,
)

DAY = START.astimezone(ZoneInfo("Asia/Seoul")).date()


def _timed(start: time, end: time) -> SchedulePlacementDTO:
    """KST 시각으로 **시간 일정** 배치 하나."""
    tz = ZoneInfo(get_settings().app_timezone)
    return SchedulePlacementDTO(
        start_at=datetime.combine(DAY, start, tzinfo=tz),
        end_at=datetime.combine(DAY, end, tzinfo=tz),
        is_all_day=False,
    )


async def _raw_meeting(session: AsyncSession, owner: MeetingOwner, **overrides: object) -> Meeting:
    row = Meeting(
        account_id=owner.id,
        work_type_id=owner.meeting_type_id,
        title="회의",
        start_at=START,
        end_at=END,
    )
    for name, value in overrides.items():
        setattr(row, name, value)
    session.add(row)
    await session.flush()
    return row


async def _timed_task(
    session: AsyncSession, owner: MeetingOwner, start: time, end: time
) -> Task:
    """**시간 일정을 가진 업무** — 2026-09-06 확정으로 업무는 시간 배치를 파생하지 못하므로
    `schedule` 행을 직접 만든다(`test_schedule_derive._placed` 와 같은 사정). 겹침 규칙은 종류 불문이다.
    """
    task = Task(
        account_id=owner.id, work_type_id=owner.task_type_id, title="업무", due_date=DAY
    )
    session.add(task)
    await session.flush()
    await schedule_repository.upsert(
        session,
        account_id=owner.id,
        source_type=ScheduleSourceType.TASK.value,
        source_id=task.id,
        placement=_timed(start, end),
    )
    return task


# --- DB 제약 -------------------------------------------------------------


async def test_a_doc_attachment_with_a_url_is_rejected_by_the_database(
    db_session: AsyncSession, owner: MeetingOwner
) -> None:
    """M-17 — `kind='doc'` 이면 `document_id` 만. DB CHECK 가 최종 방어선이다."""
    meeting = await _raw_meeting(db_session, owner)
    db_session.add(
        MeetingAttachment(
            meeting_id=meeting.id, kind="doc", document_id=12, url="https://example.test"
        )
    )
    with pytest.raises(IntegrityError) as excinfo:
        await db_session.flush()
    assert "ck_meeting_attachment_kind_columns" in str(excinfo.value)


async def test_a_link_attachment_with_a_document_id_is_rejected_by_the_database(
    db_session: AsyncSession, owner: MeetingOwner
) -> None:
    meeting = await _raw_meeting(db_session, owner)
    db_session.add(
        MeetingAttachment(
            meeting_id=meeting.id, kind="link", document_id=12, url="https://example.test"
        )
    )
    with pytest.raises(IntegrityError) as excinfo:
        await db_session.flush()
    assert "ck_meeting_attachment_kind_columns" in str(excinfo.value)


async def test_the_same_document_cannot_be_attached_twice(
    db_session: AsyncSession, owner: MeetingOwner
) -> None:
    """§4 — 부분 UNIQUE `(meeting_id, document_id) WHERE document_id IS NOT NULL`."""
    meeting = await _raw_meeting(db_session, owner)
    db_session.add(MeetingAttachment(meeting_id=meeting.id, kind="doc", document_id=12))
    await db_session.flush()

    db_session.add(MeetingAttachment(meeting_id=meeting.id, kind="doc", document_id=12))
    with pytest.raises(IntegrityError) as excinfo:
        await db_session.flush()
    assert "uq_meeting_attachment_meeting_id_document_id" in str(excinfo.value)


async def test_a_line_without_an_agenda_is_rejected(
    db_session: AsyncSession, owner: MeetingOwner
) -> None:
    """M-5 — 줄은 항상 안건에 속한다. `agenda_id` NOT NULL."""
    meeting = await _raw_meeting(db_session, owner)
    db_session.add(
        MeetingLine(
            meeting_id=meeting.id,
            agenda_id=None,  # type: ignore[arg-type]
            track="human",
            kind="discussion",
            content="줄",
            order_index=0,
        )
    )
    with pytest.raises(IntegrityError) as excinfo:
        await db_session.flush()
    assert "agenda_id" in str(excinfo.value)


async def test_a_human_agenda_cannot_point_at_a_source_agenda(
    db_session: AsyncSession, owner: MeetingOwner
) -> None:
    """M-5-b — `human` 안건의 `source_agenda_id` 는 항상 NULL."""
    meeting = await _raw_meeting(db_session, owner)
    origin = MeetingAgenda(meeting_id=meeting.id, track="human", title="원본", order_index=0)
    db_session.add(origin)
    await db_session.flush()

    db_session.add(
        MeetingAgenda(
            meeting_id=meeting.id,
            track="human",
            title="사본",
            order_index=1,
            source_agenda_id=origin.id,
        )
    )
    with pytest.raises(IntegrityError) as excinfo:
        await db_session.flush()
    assert "ck_meeting_agenda_human_has_no_source" in str(excinfo.value)


async def test_a_reversed_meeting_time_is_rejected_by_the_database(
    db_session: AsyncSession, owner: MeetingOwner
) -> None:
    """M-1 — `end_at > start_at`. 서비스가 먼저 422 로 거르고 이것이 최종 방어선이다."""
    with pytest.raises(IntegrityError) as excinfo:
        await _raw_meeting(db_session, owner, start_at=END, end_at=START)
    assert "ck_meeting_time_order" in str(excinfo.value)


# --- BE §12-5 파생 -------------------------------------------------------


async def test_creating_a_meeting_derives_a_timed_schedule(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner
) -> None:
    """§3-1 — 회의 일시 → **시간 일정**(`is_all_day=false`). 같은 트랜잭션이다(SCH-1)."""
    created = await create_meeting(client, owner)

    placement = await schedule_service.find_meeting_placement(
        db_session, meeting_id=created["id"]
    )
    assert placement is not None
    assert placement.is_all_day is False
    assert placement.start_at == START
    assert placement.end_at == END


async def test_changing_the_time_rewrites_the_same_schedule_row(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner
) -> None:
    """§3-3 — 일시 변경은 행을 **갱신**한다(SCH-3 — 0..1 행)."""
    created = await create_meeting(client, owner)
    new_start, new_end = START + timedelta(hours=3), END + timedelta(hours=3)

    response = await client.patch(
        f"{BASE}/{created['id']}",
        json={"startAt": iso(new_start), "endAt": iso(new_end)},
        headers=owner.headers,
    )
    assert response.status_code == 200, response.text

    placement = await schedule_service.find_meeting_placement(
        db_session, meeting_id=created["id"]
    )
    assert placement is not None
    assert (placement.start_at, placement.end_at) == (new_start, new_end)

    rows = (
        await db_session.execute(
            text(
                "SELECT count(*) FROM schedule"
                " WHERE source_type = 'meeting' AND source_id = :id"
            ),
            {"id": created["id"]},
        )
    ).scalar()
    assert rows == 1


async def test_changing_the_title_leaves_the_schedule_alone(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner
) -> None:
    created = await create_meeting(client, owner)
    before = (
        await db_session.execute(
            text(
                "SELECT start_at, end_at, updated_at FROM schedule"
                " WHERE source_type = 'meeting' AND source_id = :id"
            ),
            {"id": created["id"]},
        )
    ).one()

    response = await client.patch(
        f"{BASE}/{created['id']}", json={"title": "제목만"}, headers=owner.headers
    )
    assert response.status_code == 200

    after = (
        await db_session.execute(
            text(
                "SELECT start_at, end_at, updated_at FROM schedule"
                " WHERE source_type = 'meeting' AND source_id = :id"
            ),
            {"id": created["id"]},
        )
    ).one()
    assert tuple(after) == tuple(before)


async def test_a_deleted_meeting_keeps_its_row_but_leaves_the_lookup(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner
) -> None:
    """§3-3 — 소프트 딜리트해도 `schedule` 행은 **그대로**. 겹침 검사·조회가 원본을 조인해 거른다."""
    created = await create_meeting(client, owner)

    response = await client.delete(f"{BASE}/{created['id']}", headers=owner.headers)
    assert response.status_code == 204

    # 행은 남는다
    assert await schedule_service.find_meeting_placement(db_session, meeting_id=created["id"])
    # 조회(겹침 검사)에서는 빠진다 — 같은 시각이 이제 비어 있다
    await schedule_service.check_overlap(
        db_session, account_id=owner.id, placement=_timed(time(14, 0), time(15, 0))
    )


# --- BE §12-3 겹침 — 업무 ↔ 회의 · 경계 접촉 ---------------------------------


async def test_a_timed_task_blocks_a_meeting_at_the_same_time(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner
) -> None:
    """DEC-005 §7 — **종류 불문.** 14:00–15:00 업무가 있으면 같은 시각 회의가 막히고 **`meeting` 행이 생기지 않는다.**"""
    await _timed_task(db_session, owner, time(14, 0), time(15, 0))

    response = await client.post(
        BASE,
        json={
            "title": "겹침",
            "workTypeId": owner.meeting_type_id,
            "startAt": iso(START + timedelta(minutes=30)),
            "endAt": iso(END + timedelta(minutes=30)),
        },
        headers=owner.headers,
    )

    assert response.status_code == 409
    assert response.json()["code"] == "schedule_overlap"
    assert (
        await db_session.scalar(select(Meeting.id).where(Meeting.account_id == owner.id))
    ) is None


async def test_a_meeting_blocks_a_timed_task_at_the_same_time(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner
) -> None:
    """반대 방향 — 회의가 있으면 그 시각의 시간 일정(업무 쪽 검사)도 막힌다."""
    await create_meeting(client, owner)

    with pytest.raises(ConflictError) as excinfo:
        await schedule_service.check_overlap(
            db_session, account_id=owner.id, placement=_timed(time(14, 30), time(15, 30))
        )
    assert excinfo.value.code == "schedule_overlap"


@pytest.mark.parametrize(
    ("start", "end"),
    [
        (time(15, 0), time(16, 0)),  # 끝시각 = 시작시각
        (time(13, 0), time(14, 0)),  # 시작시각 = 끝시각
    ],
)
async def test_touching_boundaries_are_not_an_overlap(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner, start: time, end: time
) -> None:
    """C-8 — 판정식은 `start < :end AND end > :start`. **경계 접촉은 통과**한다."""
    await _timed_task(db_session, owner, time(14, 0), time(15, 0))
    tz = ZoneInfo(get_settings().app_timezone)

    response = await client.post(
        BASE,
        json={
            "title": "경계",
            "workTypeId": owner.meeting_type_id,
            "startAt": iso(datetime.combine(DAY, start, tzinfo=tz).astimezone(UTC)),
            "endAt": iso(datetime.combine(DAY, end, tzinfo=tz).astimezone(UTC)),
        },
        headers=owner.headers,
    )
    assert response.status_code == 201, response.text


async def test_two_meetings_block_each_other(
    client: AsyncClient, owner: MeetingOwner
) -> None:
    await create_meeting(client, owner)

    response = await client.post(
        BASE, json={**_body(owner), "title": "둘째"}, headers=owner.headers
    )
    assert response.status_code == 409
    assert response.json()["code"] == "schedule_overlap"


def _body(owner: MeetingOwner) -> dict:
    return {
        "title": "회의",
        "workTypeId": owner.meeting_type_id,
        "startAt": iso(START),
        "endAt": iso(END),
    }


async def test_another_account_does_not_block(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner
) -> None:
    """겹침은 **같은 계정 안에서만** 본다(G-5)."""
    other = await create_meeting_owner(client, db_session, "schedule_other")
    await create_meeting(client, other)

    await create_meeting(client, owner)


async def test_a_meeting_does_not_block_itself_when_its_time_moves(
    client: AsyncClient, owner: MeetingOwner
) -> None:
    """자기 옛 행과는 겹치지 않는다 — 같은 회의의 일시를 30분 옮기는 경우다."""
    created = await create_meeting(client, owner)

    response = await client.patch(
        f"{BASE}/{created['id']}",
        json={
            "startAt": iso(START + timedelta(minutes=30)),
            "endAt": iso(END + timedelta(minutes=30)),
        },
        headers=owner.headers,
    )
    assert response.status_code == 200, response.text


# --- BE §12-9 고아 없음 ------------------------------------------------


async def test_there_are_no_orphan_meeting_schedules(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner
) -> None:
    """FK 를 안 걸었으므로(§3-4) 테스트가 대신 잡는다. 생성·일시 변경·삭제를 지난 뒤 전부 살아 있는 행을 가리킨다."""
    kept = await create_meeting(client, owner)
    removed = await create_meeting(
        client, owner, startAt=iso(START + timedelta(days=1)), endAt=iso(END + timedelta(days=1))
    )
    await client.patch(
        f"{BASE}/{kept['id']}",
        json={"startAt": iso(START + timedelta(hours=2)), "endAt": iso(END + timedelta(hours=2))},
        headers=owner.headers,
    )
    assert (
        await client.delete(f"{BASE}/{removed['id']}", headers=owner.headers)
    ).status_code == 204

    orphans = (
        await db_session.execute(
            text(
                "SELECT s.id FROM schedule s"
                " LEFT JOIN meeting m ON m.id = s.source_id AND s.source_type = 'meeting'"
                " WHERE s.source_type = 'meeting' AND m.id IS NULL"
            )
        )
    ).scalars().all()
    assert orphans == []
