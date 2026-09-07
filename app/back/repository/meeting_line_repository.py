"""3층 — `meeting_line` **쓰기**와 배치·통합 입력용 읽기. 상세 조립용 읽기(`list_lines`)는 `meeting_child_repository` 에 있다.

- 사람 줄(`track='human'`)은 `POST …/lines` 가, AI 줄(`track='ai'`)은 배치가 **INSERT** 한다(M-6 · M-7).
  통합 줄(`track='merged'`)은 종료 파이프라인 ② 가 **한 트랜잭션**에 INSERT 한다(M-8-a).
- 종료 후 편집(SPEC-008) — `update_line` · **`delete_line`(그 행 하나만 하드 삭제 · **자리 유지**)**. 판정(트랙 · 상태)은 service.
- `order_index` = 그 안건 안의 **마지막 + 1**(SPEC-007 §4). 지운 자리는 그대로 두므로 **구멍이 있어도 마지막 + 1** 이다(MF-36).
- `commit()` 하지 않는다.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from dto.enums import MeetingTrack
from dto.meeting import MeetingLineDTO
from models.meeting import MeetingLine
from repository.meeting_child_repository import line_row_to_dto, select_lines_with_task


async def next_order_index(session: AsyncSession, *, agenda_id: int) -> int:
    current = await session.scalar(
        select(func.max(MeetingLine.order_index)).where(MeetingLine.agenda_id == agenda_id)
    )
    return 0 if current is None else current + 1


async def create_line(
    session: AsyncSession,
    *,
    meeting_id: int,
    agenda_id: int,
    track: str,
    kind: str,
    content: str,
    order_index: int,
    detail: str | None = None,
    evidence: list | None = None,
    task_id: int | None = None,
    payload: dict | None = None,
) -> int:
    """새 줄의 id 를 돌려준다. dto 는 `find_by_ids` 로 다시 읽는다(업무 요약 조인 때문).

    `source_*_line_id` 는 `track='merged'` 에서만 값을 갖는다 — 그 밖은 DB CHECK 가 막는다(M-8-a).
    """
    row = MeetingLine(
        meeting_id=meeting_id,
        agenda_id=agenda_id,
        track=track,
        kind=kind,
        content=content,
        detail=detail,
        evidence=evidence,
        order_index=order_index,
        task_id=task_id,
        payload=payload,
    )
    session.add(row)
    await session.flush()
    return row.id


async def find_by_ids(session: AsyncSession, *, line_ids: list[int]) -> list[MeetingLineDTO]:
    """id 순. `kind='task'` 줄의 업무 요약을 함께 읽는다(상세 조립과 같은 변환)."""
    if not line_ids:
        return []
    rows = (
        await session.execute(
            select_lines_with_task().where(MeetingLine.id.in_(line_ids)).order_by(MeetingLine.id)
        )
    ).all()
    return [line_row_to_dto(row) for row in rows]


async def find_line(
    session: AsyncSession, *, meeting_id: int, line_id: int
) -> MeetingLineDTO | None:
    """**이 회의의** 줄 하나. 다른 회의의 줄은 None(404) — 소유는 service 가 부모 회의로 먼저 확인했다."""
    row = (
        await session.execute(
            select_lines_with_task().where(
                MeetingLine.id == line_id, MeetingLine.meeting_id == meeting_id
            )
        )
    ).one_or_none()
    return None if row is None else line_row_to_dto(row)


async def list_human_lines_since(
    session: AsyncSession, meeting_id: int, *, since: datetime | None
) -> list[MeetingLineDTO]:
    """배치 입력의 「미처리 구간 동안 사람이 적은 줄」 — **읽기 전용 컨텍스트**(M-6). `since=None` 이면 전량."""
    query = select_lines_with_task().where(
        MeetingLine.meeting_id == meeting_id,
        MeetingLine.track == MeetingTrack.HUMAN.value,
    )
    if since is not None:
        query = query.where(MeetingLine.created_at >= since)
    rows = (await session.execute(query.order_by(MeetingLine.id))).all()
    return [line_row_to_dto(row) for row in rows]


async def list_by_track(
    session: AsyncSession, meeting_id: int, *, track: str
) -> list[MeetingLineDTO]:
    """한 트랙의 줄 전부를 `(agenda_id, order_index, id)` 순으로 — 통합 입력(사람 트리 · AI 트리)이 읽는다."""
    rows = (
        await session.execute(
            select_lines_with_task()
            .where(MeetingLine.meeting_id == meeting_id, MeetingLine.track == track)
            .order_by(MeetingLine.agenda_id, MeetingLine.order_index, MeetingLine.id)
        )
    ).all()
    return [line_row_to_dto(row) for row in rows]


async def update_line(
    session: AsyncSession, *, meeting_id: int, line_id: int, values: dict[str, object]
) -> None:
    """**보낸 필드만**(SPEC-008 §4). `order_index`·`track`·`source_*` 는 여기로 오지 않는다 — 순서 변경 표면이 없다(M-20)."""
    row = (
        await session.scalars(
            select(MeetingLine).where(
                MeetingLine.id == line_id, MeetingLine.meeting_id == meeting_id
            )
        )
    ).one()
    for name, value in values.items():
        setattr(row, name, value)
    await session.flush()


async def delete_line(session: AsyncSession, *, meeting_id: int, line_id: int) -> None:
    """**그 행 하나만 하드 삭제한다**(M-20 · DB §0-1). **뒤 줄을 당기지 않는다** — `DELETE` 한 문장뿐이다(MF-36).

    당기면 지울 때마다 같은 안건의 뒤 줄을 전부 UPDATE 해야 하고, 얻는 것은 「번호가 촘촘하다」뿐이다.
    화면은 번호순으로 그리고 새 줄은 `next_order_index`(= 마지막 + 1)를 받으므로 구멍이 있어도 겹치지 않는다.

    업무 · 트랜스크립트 · 녹음을 건드리는 SQL 이 없다 — 참조는 지워지는 쪽에 있었다.
    """
    await session.execute(
        delete(MeetingLine).where(MeetingLine.id == line_id, MeetingLine.meeting_id == meeting_id)
    )
    await session.flush()


async def delete_by_track(session: AsyncSession, *, meeting_id: int, track: str) -> int:
    """트랙 전량 삭제 — **최종 배치의 AI 트랙 전량 교체(M-7)** 만 부른다. 검증을 통과한 결과가 있을 때만(SPEC-008 §5)."""
    result = await session.execute(
        delete(MeetingLine).where(MeetingLine.meeting_id == meeting_id, MeetingLine.track == track)
    )
    await session.flush()
    return result.rowcount or 0
