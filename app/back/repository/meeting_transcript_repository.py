"""3층 — `meeting_transcript` 의 ORM/SQL 만. dto 를 돌려준다(§2).

- 확정 발화 블록만 들어온다(M-9). 잠정 토큰을 위한 함수가 없다.
- 정렬은 `(meeting_id, at_ms)` — 인덱스 그대로.
- 소유 검사는 service 가 부모 회의로 먼저 한다(§9).
- 배치 커서(직전 성공 배치의 `to_transcript_id`) 이후 구간을 읽는 함수가 여기 있다 — 「미처리」의 정의는 id 순서다.
"""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from dto.meeting import TranscriptBlockDTO, TranscriptItemDTO
from models.meeting import MeetingTranscript


def _to_dto(row: MeetingTranscript) -> TranscriptItemDTO:
    return TranscriptItemDTO(
        id=row.id,
        speaker_label=row.speaker_label,
        at_ms=row.at_ms,
        end_ms=row.end_ms,
        content=row.content,
        created_at=row.created_at,
    )


async def list_blocks(session: AsyncSession, meeting_id: int) -> list[TranscriptItemDTO]:
    """`at_ms` 순 전량 — 300분 회의여도 한 번에(SPEC-007 §4)."""
    rows = (
        await session.scalars(
            select(MeetingTranscript)
            .where(MeetingTranscript.meeting_id == meeting_id)
            .order_by(MeetingTranscript.at_ms, MeetingTranscript.id)
        )
    ).all()
    return [_to_dto(row) for row in rows]


async def list_after(
    session: AsyncSession, meeting_id: int, *, after_id: int | None
) -> list[TranscriptItemDTO]:
    """커서 **이후**(id 초과) 블록 — 배치 입력의 「미처리 구간」. `after_id=None` 이면 전량."""
    query = select(MeetingTranscript).where(MeetingTranscript.meeting_id == meeting_id)
    if after_id is not None:
        query = query.where(MeetingTranscript.id > after_id)
    rows = (await session.scalars(query.order_by(MeetingTranscript.id))).all()
    return [_to_dto(row) for row in rows]


async def sum_chars_after(
    session: AsyncSession, meeting_id: int, *, after_id: int | None
) -> int:
    """미처리 확정 발화의 글자 수 — 트리거 3종이 이 값을 본다(DEC-003 §STT)."""
    query = (
        select(func.coalesce(func.sum(func.length(MeetingTranscript.content)), 0))
        .where(MeetingTranscript.meeting_id == meeting_id)
    )
    if after_id is not None:
        query = query.where(MeetingTranscript.id > after_id)
    return int(await session.scalar(query) or 0)


async def count_speakers(session: AsyncSession, meeting_id: int) -> int:
    """`speakerCount` — 지금까지 확정 발화의 화자 라벨 수(파생 · G-7)."""
    total = await session.scalar(
        select(func.count(func.distinct(MeetingTranscript.speaker_label))).where(
            MeetingTranscript.meeting_id == meeting_id
        )
    )
    return int(total or 0)


async def create_block(
    session: AsyncSession,
    *,
    meeting_id: int,
    speaker_label: str,
    at_ms: int,
    end_ms: int,
    content: str,
) -> TranscriptItemDTO:
    row = MeetingTranscript(
        meeting_id=meeting_id,
        speaker_label=speaker_label,
        at_ms=at_ms,
        end_ms=end_ms,
        content=content,
    )
    session.add(row)
    await session.flush()
    return _to_dto(row)


# --- 종료 후 재전사 (WORK-012 ①) ------------------------------------------------


async def delete_by_meeting(session: AsyncSession, *, meeting_id: int) -> int:
    """실시간 블록 전량 삭제 — **`bulk_create` 와 같은 트랜잭션**에서만 부른다(M-9-a 전량 교체)."""
    result = await session.execute(
        delete(MeetingTranscript).where(MeetingTranscript.meeting_id == meeting_id)
    )
    await session.flush()
    return result.rowcount or 0


async def bulk_create(
    session: AsyncSession, *, meeting_id: int, blocks: Iterable[TranscriptBlockDTO]
) -> int:
    """재전사 블록 전량 INSERT. 넣은 행 수를 돌려준다."""
    rows = [
        MeetingTranscript(
            meeting_id=meeting_id,
            speaker_label=block.speaker_label,
            at_ms=block.at_ms,
            end_ms=block.end_ms,
            content=block.content,
        )
        for block in blocks
    ]
    session.add_all(rows)
    await session.flush()
    return len(rows)


async def replace_content(session: AsyncSession, *, meeting_id: int, stt: str, correct: str) -> int:
    """용어 보정 — `content` **문자열 치환** 하나(M-9-b).

    `speaker_label` 은 건드리지 않는다. 표에 없는 치환은 없다 — 부르는 쪽이 `grade='auto'` 항목만 넘긴다.
    """
    result = await session.execute(
        update(MeetingTranscript)
        .where(MeetingTranscript.meeting_id == meeting_id, MeetingTranscript.content.contains(stt))
        .values(content=func.replace(MeetingTranscript.content, stt, correct))
        .execution_options(synchronize_session="fetch")
    )
    await session.flush()
    return result.rowcount or 0
