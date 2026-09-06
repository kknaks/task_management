"""3층 — `meeting_batch_run` 쓰기 + 커서 읽기(DEC-003 §7 · M-16).

- 커서 = **성공분** 의 최대 `to_transcript_id`. 실패·폐기 구간은 커서를 전진시키지 않는다 — 다음 배치에 합쳐진다.
- `seq` 는 성공분 최대 + 1 이다. 실패·폐기 행도 그 값을 갖는다(같은 회차의 시도) — 「배치 n회」는 성공분 최대 `seq` 의 파생(M-6-a).
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from dto.enums import BatchRunStatus
from dto.meeting import BatchRunDTO
from models.meeting import MeetingBatchRun


def _to_dto(row: MeetingBatchRun) -> BatchRunDTO:
    return BatchRunDTO(
        id=row.id,
        seq=row.seq,
        from_transcript_id=row.from_transcript_id,
        to_transcript_id=row.to_transcript_id,
        phase=row.phase,
        status=row.status,
        reason=row.reason,
    )


async def succeeded_cursor(session: AsyncSession, meeting_id: int) -> int | None:
    """직전 성공 배치의 `to_transcript_id`. 없으면 None(= 처음부터)."""
    return await session.scalar(
        select(func.max(MeetingBatchRun.to_transcript_id)).where(
            MeetingBatchRun.meeting_id == meeting_id,
            MeetingBatchRun.status == BatchRunStatus.SUCCEEDED.value,
        )
    )


async def next_seq(session: AsyncSession, meeting_id: int) -> int:
    current = await session.scalar(
        select(func.max(MeetingBatchRun.seq)).where(
            MeetingBatchRun.meeting_id == meeting_id,
            MeetingBatchRun.status == BatchRunStatus.SUCCEEDED.value,
        )
    )
    return 1 if current is None else current + 1


async def create_run(
    session: AsyncSession,
    *,
    meeting_id: int,
    seq: int,
    phase: str,
    status: str,
    from_transcript_id: int | None,
    to_transcript_id: int | None,
    reason: str | None = None,
) -> BatchRunDTO:
    row = MeetingBatchRun(
        meeting_id=meeting_id,
        seq=seq,
        phase=phase,
        status=status,
        from_transcript_id=from_transcript_id,
        to_transcript_id=to_transcript_id,
        reason=reason,
    )
    session.add(row)
    await session.flush()
    return _to_dto(row)


async def list_runs(session: AsyncSession, meeting_id: int) -> list[BatchRunDTO]:
    rows = (
        await session.scalars(
            select(MeetingBatchRun)
            .where(MeetingBatchRun.meeting_id == meeting_id)
            .order_by(MeetingBatchRun.id)
        )
    ).all()
    return [_to_dto(row) for row in rows]
