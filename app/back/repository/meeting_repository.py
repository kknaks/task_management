"""3층 — `meeting` 본체의 ORM/SQL 만. **ORM 모델을 밖으로 내지 않는다**(§2 · §3 규칙 2).

- **모든 조회는 `account_id` 로 먼저 좁힌다**(G-5).
- **기본 조회는 `deleted_at IS NULL`**(DB §0-1).
- `commit()` 하지 않는다 — flush 까지다(§7).
- **`schedule` 을 읽거나 쓰지 않는다** — 파생은 `service/schedule_service.py` 하나가 한다(SCH-1).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import ColumnElement, Select, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from dto.enums import MeetingSort, MeetingStatus, MeetingTrack
from dto.meeting import (
    MeetingAiContextDTO,
    MeetingDTO,
    MeetingListItemDTO,
    ProjectCountDTO,
    ProjectRefDTO,
    WorkTypeRefDTO,
)
from models.account import Project, WorkType
from models.meeting import Meeting, MeetingAgenda, MeetingAttachment

# 참조 표시용 조인 — **삭제된 유형·프로젝트도 이름·색을 그대로 가져온다**(A-6).
_WorkTypeRef = aliased(WorkType)
_ProjectRef = aliased(Project)


def _row_to_dto(row: object) -> MeetingDTO:
    meeting: Meeting = row.Meeting  # type: ignore[attr-defined]
    return MeetingDTO(
        id=meeting.id,
        title=meeting.title,
        status=meeting.status,
        integration_state=meeting.integration_state,
        work_type=WorkTypeRefDTO(
            id=row.work_type_id,  # type: ignore[attr-defined]
            name=row.work_type_name,  # type: ignore[attr-defined]
            kind=row.work_type_kind,  # type: ignore[attr-defined]
            color_token=row.work_type_color_token,  # type: ignore[attr-defined]
            is_deleted=row.work_type_deleted_at is not None,  # type: ignore[attr-defined]
        ),
        project=(
            None
            if row.project_id is None  # type: ignore[attr-defined]
            else ProjectRefDTO(
                id=row.project_id,  # type: ignore[attr-defined]
                name=row.project_name,  # type: ignore[attr-defined]
                color_token=row.project_color_token,  # type: ignore[attr-defined]
                is_deleted=row.project_deleted_at is not None,  # type: ignore[attr-defined]
            )
        ),
        start_at=meeting.start_at,
        end_at=meeting.end_at,
        recording_started_at=meeting.recording_started_at,
        ai_headline=meeting.ai_headline,
        created_at=meeting.created_at,
        updated_at=meeting.updated_at,
    )


def _with_refs(account_id: int) -> Select:
    """본체 + 유형·프로젝트 표시 정보를 한 번에 읽는다. 유형은 INNER, 프로젝트는 LEFT(M-2 · 무소속 허용).

    **삭제 여부로 거르지 않는다** — 삭제된 것도 이름·색을 그대로 보여줘야 한다(A-6).
    """
    return (
        select(
            Meeting,
            _WorkTypeRef.id.label("work_type_id"),
            _WorkTypeRef.name.label("work_type_name"),
            _WorkTypeRef.kind.label("work_type_kind"),
            _WorkTypeRef.color_token.label("work_type_color_token"),
            _WorkTypeRef.deleted_at.label("work_type_deleted_at"),
            _ProjectRef.id.label("project_id"),
            _ProjectRef.name.label("project_name"),
            _ProjectRef.color_token.label("project_color_token"),
            _ProjectRef.deleted_at.label("project_deleted_at"),
        )
        .join(_WorkTypeRef, _WorkTypeRef.id == Meeting.work_type_id)
        .outerjoin(_ProjectRef, _ProjectRef.id == Meeting.project_id)
        .where(Meeting.account_id == account_id, Meeting.deleted_at.is_(None))
    )


def _active_row(account_id: int, meeting_id: int) -> Select[tuple[Meeting]]:
    return select(Meeting).where(
        Meeting.account_id == account_id,
        Meeting.deleted_at.is_(None),
        Meeting.id == meeting_id,
    )


async def find_active(
    session: AsyncSession, *, account_id: int, meeting_id: int
) -> MeetingDTO | None:
    """남의 것도 없는 것도 똑같이 `None` 이다 — 존재를 흘리지 않는다(§9)."""
    row = (
        await session.execute(_with_refs(account_id).where(Meeting.id == meeting_id))
    ).one_or_none()
    return None if row is None else _row_to_dto(row)


async def create(
    session: AsyncSession,
    *,
    account_id: int,
    work_type_id: int,
    project_id: int | None,
    title: str,
    start_at: datetime,
    end_at: datetime,
) -> int:
    """새 회의록의 id 를 돌려준다. **상태는 DB 기본값(`scheduled`)** 이다(DEC-003 §4)."""
    row = Meeting(
        account_id=account_id,
        work_type_id=work_type_id,
        project_id=project_id,
        title=title,
        start_at=start_at,
        end_at=end_at,
    )
    session.add(row)
    await session.flush()
    return row.id


async def update_fields(
    session: AsyncSession, *, account_id: int, meeting_id: int, values: dict[str, object]
) -> None:
    """**보낸 필드만** 바꾼다. `values` 는 service 가 `Unset` 을 걷어낸 결과다.

    `status` 는 여기로 오지 않는다 — 대입은 아래 `start_recording` 뿐이다.
    """
    row = (await session.scalars(_active_row(account_id, meeting_id))).one()
    for name, value in values.items():
        setattr(row, name, value)
    await session.flush()


async def start_recording(
    session: AsyncSession, *, account_id: int, meeting_id: int, started_at: datetime
) -> None:
    """**`meeting.status` 에 값을 대입하는 유일한 코드다** — `status='recording'` + `recording_started_at` **한 UPDATE**.

    판정(상태별 허용 표)은 하지 않는다 — 그건 `meeting_service.start()` 의 몫이고,
    이 함수를 부르는 곳도 그 판정을 지난 `start()` 하나뿐이다(WP 「상태 대입 격리」).
    `start_at`(예정)은 건드리지 않는다(M-1-a).
    """
    await session.execute(
        update(Meeting)
        .where(
            Meeting.account_id == account_id,
            Meeting.deleted_at.is_(None),
            Meeting.id == meeting_id,
        )
        .values(status=MeetingStatus.RECORDING.value, recording_started_at=started_at)
        .execution_options(synchronize_session="fetch")
    )
    await session.flush()


async def find_ai_context(
    session: AsyncSession, *, meeting_id: int
) -> MeetingAiContextDTO | None:
    """배치·웜스타트·스트림이 읽는 서버 내부값(`ai_session_id`). **응답 조립에 쓰지 않는다.**

    `account_id` 로 좁히지 않는 유일한 조회다 — 부르는 쪽이 서버 내부(배치 태스크)라 요청 주체가 없다.
    삭제된 회의는 None.
    """
    row = (
        await session.execute(
            select(Meeting, _ProjectRef.name.label("project_name"))
            .outerjoin(_ProjectRef, _ProjectRef.id == Meeting.project_id)
            .where(Meeting.id == meeting_id, Meeting.deleted_at.is_(None))
        )
    ).one_or_none()
    if row is None:
        return None
    meeting: Meeting = row.Meeting
    return MeetingAiContextDTO(
        id=meeting.id,
        account_id=meeting.account_id,
        project_id=meeting.project_id,
        project_name=row.project_name,
        status=meeting.status,
        recording_started_at=meeting.recording_started_at,
        ai_session_id=meeting.ai_session_id,
    )


async def set_ai_session_id(
    session: AsyncSession, *, meeting_id: int, ai_session_id: str
) -> None:
    """웜스타트가 만든 세션 — 회의 하나에 하나(M-12). `/start` 의 전이 커밋 **뒤** 새 트랜잭션에서 쓴다(BE §7)."""
    await session.execute(
        update(Meeting)
        .where(Meeting.id == meeting_id)
        .values(ai_session_id=ai_session_id)
        .execution_options(synchronize_session="fetch")
    )
    await session.flush()


async def set_recording_path(
    session: AsyncSession, *, meeting_id: int, recording_path: str
) -> None:
    """첫 청크가 적재된 경로(M-13 영구 보관). 한 번 채우면 바꾸지 않는다."""
    await session.execute(
        update(Meeting)
        .where(Meeting.id == meeting_id, Meeting.recording_path.is_(None))
        .values(recording_path=recording_path)
        .execution_options(synchronize_session="fetch")
    )
    await session.flush()


async def soft_delete(
    session: AsyncSession, *, account_id: int, meeting_id: int, deleted_at: datetime
) -> None:
    """`deleted_at` 만 채운다. **자식 행·`schedule` 행·녹음 파일을 건드리지 않는다**(§0-1 · §3-3 · M-13)."""
    row = (await session.scalars(_active_row(account_id, meeting_id))).one()
    row.deleted_at = deleted_at
    await session.flush()


# --- 목록 (SPEC-006 §4) --------------------------------------------------


def _period_filter(period_from: datetime, period_to: datetime) -> ColumnElement[bool]:
    """`[from, to)` — **`start_at` 이 범위 안**인 회의(SPEC-006 §4)."""
    return (Meeting.start_at >= period_from) & (Meeting.start_at < period_to)


def _project_filter(
    project_id: int | None, unassigned_only: bool
) -> list[ColumnElement[bool]]:
    """`projectId=none` 이 무소속, 숫자면 그 프로젝트, 없으면 전체."""
    if unassigned_only:
        return [Meeting.project_id.is_(None)]
    if project_id is not None:
        return [Meeting.project_id == project_id]
    return []


def _attachment_count() -> ColumnElement[int]:
    return (
        select(func.count())
        .select_from(MeetingAttachment)
        .where(MeetingAttachment.meeting_id == Meeting.id)
        .scalar_subquery()
    )


_SORTS = {
    MeetingSort.LATEST.value: (Meeting.start_at.desc(), Meeting.id.desc()),
    MeetingSort.OLDEST.value: (Meeting.start_at.asc(), Meeting.id.asc()),
}


async def list_meetings(
    session: AsyncSession,
    *,
    account_id: int,
    period_from: datetime,
    period_to: datetime,
    project_id: int | None,
    unassigned_only: bool,
    sort: str,
) -> list[MeetingListItemDTO]:
    """한 달치 전부 — 페이지네이션이 없다(SPEC-006 §4). **`schedule` 을 조인하지 않는다.**

    `agendaTitles` 는 사람 트랙 제목을 `order_index` 순으로 — 목록 한 번 + 안건 한 번, 두 쿼리다.
    """
    query = (
        _with_refs(account_id)
        .add_columns(_attachment_count().label("attachment_count"))
        .where(
            _period_filter(period_from, period_to),
            *_project_filter(project_id, unassigned_only),
        )
        .order_by(*_SORTS[sort])
    )
    rows = (await session.execute(query)).all()
    if not rows:
        return []

    titles_by_meeting = await _human_agenda_titles(
        session, meeting_ids=[row.Meeting.id for row in rows]
    )
    return [
        _to_list_item(row, agenda_titles=titles_by_meeting.get(row.Meeting.id, []))
        for row in rows
    ]


async def _human_agenda_titles(
    session: AsyncSession, *, meeting_ids: list[int]
) -> dict[int, list[str]]:
    rows = (
        await session.execute(
            select(MeetingAgenda.meeting_id, MeetingAgenda.title)
            .where(
                MeetingAgenda.meeting_id.in_(meeting_ids),
                MeetingAgenda.track == MeetingTrack.HUMAN.value,
            )
            .order_by(MeetingAgenda.meeting_id, MeetingAgenda.order_index, MeetingAgenda.id)
        )
    ).all()
    titles: dict[int, list[str]] = {}
    for row in rows:
        titles.setdefault(row.meeting_id, []).append(row.title)
    return titles


def _to_list_item(row: object, *, agenda_titles: list[str]) -> MeetingListItemDTO:
    base = _row_to_dto(row)
    return MeetingListItemDTO(
        id=base.id,
        title=base.title,
        status=base.status,
        integration_state=base.integration_state,
        start_at=base.start_at,
        end_at=base.end_at,
        work_type=base.work_type,
        project=base.project,
        headline=base.ai_headline,
        agenda_titles=agenda_titles,
        attachment_count=row.attachment_count,  # type: ignore[attr-defined]
        updated_at=base.updated_at,
    )


async def count_meetings(
    session: AsyncSession,
    *,
    account_id: int,
    period_from: datetime,
    period_to: datetime,
    project_id: int | None,
    unassigned_only: bool,
) -> int:
    """`total` — 프로젝트 필터를 **적용한 뒤**의 건수(헤더 「n건」)."""
    total = await session.scalar(
        select(func.count())
        .select_from(Meeting)
        .where(
            Meeting.account_id == account_id,
            Meeting.deleted_at.is_(None),
            _period_filter(period_from, period_to),
            *_project_filter(project_id, unassigned_only),
        )
    )
    return total or 0


async def count_by_project(
    session: AsyncSession, *, account_id: int, period_from: datetime, period_to: datetime
) -> list[ProjectCountDTO]:
    """`projectCounts` — 프로젝트 필터를 **적용하기 전** 그 달 전체(SPEC-006 §4).

    칩 숫자는 필터 자신을 반영하지 않는다. **삭제된 프로젝트도 이름·색 그대로** 집계에 남는다(DEC-001 §4).
    「미정」(`project_id IS NULL`)이 맨 앞, 나머지는 프로젝트 id 순이다.
    """
    rows = (
        await session.execute(
            select(
                Meeting.project_id,
                _ProjectRef.name,
                _ProjectRef.color_token,
                func.count().label("count"),
            )
            .select_from(Meeting)
            .outerjoin(_ProjectRef, _ProjectRef.id == Meeting.project_id)
            .where(
                Meeting.account_id == account_id,
                Meeting.deleted_at.is_(None),
                _period_filter(period_from, period_to),
            )
            .group_by(Meeting.project_id, _ProjectRef.name, _ProjectRef.color_token)
            .order_by(Meeting.project_id.asc().nullsfirst())
        )
    ).all()
    return [
        ProjectCountDTO(
            project_id=row.project_id,
            name=row.name,
            color_token=row.color_token,
            count=row.count,
        )
        for row in rows
    ]
