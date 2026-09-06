"""3층 — `meeting_line` **쓰기**와 배치 입력용 읽기. 상세 조립용 읽기(`list_lines`)는 `meeting_child_repository` 에 있다.

- 사람 줄(`track='human'`)은 회의 중 `POST …/lines` 가, AI 줄(`track='ai'`)은 배치가 **INSERT 만** 한다(M-6 · M-7).
- `order_index` = 그 안건 안의 마지막 + 1(SPEC-007 §4).
- `commit()` 하지 않는다.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, select
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
) -> int:
    """새 줄의 id 를 돌려준다. dto 는 `find_by_ids` 로 다시 읽는다(업무 요약 조인 때문)."""
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
