"""3층 — 회의 자식(안건 · 줄 · 첨부 · 배치 이력)의 ORM/SQL 만.

소유 검사는 **service 가 부모 회의로 먼저 한다**(§9) — 여기 오는 `meeting_id` 는 이미 본인 것이다.
`commit()` 하지 않는다.

- 안건 · 첨부 — 쓰기(사람 트랙 · 하드 삭제 — DB §0-1)
- 줄 — **읽기만**(상세 응답 조립). 쓰기는 WORK-007·008
- 배치 이력 — `latestBatchSeq` 파생을 위한 읽기만(M-6-a)
"""

from __future__ import annotations

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from dto.enums import AttachmentKind, BatchRunStatus
from dto.meeting import (
    LineTaskSummaryDTO,
    MeetingAgendaDTO,
    MeetingAttachmentDTO,
    MeetingLineDTO,
)
from models.meeting import MeetingAgenda, MeetingAttachment, MeetingBatchRun, MeetingLine
from models.task import Task

# --- 안건 ---------------------------------------------------------------


def _agenda_to_dto(row: MeetingAgenda) -> MeetingAgendaDTO:
    return MeetingAgendaDTO(
        id=row.id,
        track=row.track,
        title=row.title,
        order_index=row.order_index,
        state=row.state,
        source_agenda_id=row.source_agenda_id,
        lines=[],
    )


async def list_agendas(session: AsyncSession, meeting_id: int) -> list[MeetingAgendaDTO]:
    """**전 트랙**을 `(track, order_index)` 순으로. 트랙별 분리는 service 의 빌더가 한다. `lines` 는 비어 온다."""
    rows = (
        await session.scalars(
            select(MeetingAgenda)
            .where(MeetingAgenda.meeting_id == meeting_id)
            .order_by(MeetingAgenda.track, MeetingAgenda.order_index, MeetingAgenda.id)
        )
    ).all()
    return [_agenda_to_dto(row) for row in rows]


async def find_agenda(
    session: AsyncSession, *, meeting_id: int, agenda_id: int
) -> MeetingAgendaDTO | None:
    row = (
        await session.scalars(
            select(MeetingAgenda).where(
                MeetingAgenda.id == agenda_id, MeetingAgenda.meeting_id == meeting_id
            )
        )
    ).one_or_none()
    return None if row is None else _agenda_to_dto(row)


async def next_agenda_order_index(
    session: AsyncSession, *, meeting_id: int, track: str
) -> int:
    """`orderIndex` = **그 트랙** 마지막 + 1(SPEC-006 §4)."""
    current = await session.scalar(
        select(func.max(MeetingAgenda.order_index)).where(
            MeetingAgenda.meeting_id == meeting_id, MeetingAgenda.track == track
        )
    )
    return 0 if current is None else current + 1


async def create_agenda(
    session: AsyncSession,
    *,
    meeting_id: int,
    track: str,
    title: str,
    order_index: int,
    state: str | None = None,
    source_agenda_id: int | None = None,
) -> MeetingAgendaDTO:
    row = MeetingAgenda(
        meeting_id=meeting_id,
        track=track,
        title=title,
        order_index=order_index,
        state=state,
        source_agenda_id=source_agenda_id,
    )
    session.add(row)
    await session.flush()
    return _agenda_to_dto(row)


async def update_agenda(
    session: AsyncSession, *, meeting_id: int, agenda_id: int, values: dict[str, object]
) -> MeetingAgendaDTO:
    """**보낸 필드만**. `order_index` 는 여기로 오지 않는다 — 제목 수정이 순서를 바꾸지 않는다."""
    row = (
        await session.scalars(
            select(MeetingAgenda).where(
                MeetingAgenda.id == agenda_id, MeetingAgenda.meeting_id == meeting_id
            )
        )
    ).one()
    for name, value in values.items():
        setattr(row, name, value)
    await session.flush()
    return _agenda_to_dto(row)


async def delete_agenda(session: AsyncSession, *, meeting_id: int, agenda_id: int) -> None:
    """자식 행이라 **하드 삭제**(DB §0-1). 딸린 줄이 없음은 service 가 먼저 확인한다(M-5)."""
    await session.execute(
        delete(MeetingAgenda).where(
            MeetingAgenda.id == agenda_id, MeetingAgenda.meeting_id == meeting_id
        )
    )
    await session.flush()


async def count_lines_for_agenda(session: AsyncSession, *, agenda_id: int) -> int:
    total = await session.scalar(
        select(func.count()).select_from(MeetingLine).where(MeetingLine.agenda_id == agenda_id)
    )
    return total or 0


# --- 줄 (읽기만) ---------------------------------------------------------


async def list_lines(session: AsyncSession, meeting_id: int) -> list[MeetingLineDTO]:
    """회의의 줄 전부를 `(track, agenda_id, order_index)` 순으로. 안건 밑에 끼우는 것은 빌더가 한다.

    `kind='task'` 줄의 업무 요약은 **삭제된 업무도 제목 그대로** 담고 `is_deleted` 로 알린다(A-6 와 같은 결).
    이 work 시점에는 줄이 0건이다 — 형태만 확정한다(SPEC-007·008 이 채운다).
    """
    rows = (
        await session.execute(
            select(MeetingLine, Task)
            .outerjoin(Task, Task.id == MeetingLine.task_id)
            .where(MeetingLine.meeting_id == meeting_id)
            .order_by(
                MeetingLine.track,
                MeetingLine.agenda_id,
                MeetingLine.order_index,
                MeetingLine.id,
            )
        )
    ).all()
    return [_line_to_dto(row.MeetingLine, row.Task) for row in rows]


def _line_to_dto(line: MeetingLine, task: Task | None) -> MeetingLineDTO:
    return MeetingLineDTO(
        id=line.id,
        track=line.track,
        agenda_id=line.agenda_id,
        kind=line.kind,
        content=line.content,
        detail=line.detail,
        evidence=list(line.evidence or []),
        order_index=line.order_index,
        task_id=line.task_id,
        pending_change=line.pending_change,
        source_human_line_id=line.source_human_line_id,
        source_ai_line_id=line.source_ai_line_id,
        task=(
            None
            if task is None
            else LineTaskSummaryDTO(
                id=task.id,
                title=task.title,
                status=task.status,
                due_date=task.due_date,
                is_deleted=task.deleted_at is not None,
            )
        ),
    )


# --- 첨부 ---------------------------------------------------------------


def _attachment_to_dto(row: MeetingAttachment) -> MeetingAttachmentDTO:
    """링크는 `name` = `label` 또는 URL(비우면 URL 을 이름으로 — SPEC-006 §4), `updated_at` = 첨부 시각.

    `doc` 의 이름·경로·크기·수정 시각·삭제 여부는 `document` 에서 와야 하는데 **아직 없다** —
    `doc` 첨부 자체를 거부하므로 이 갈래로 오는 행이 없다(WORK-006 §Open Issues).
    """
    is_link = row.kind == AttachmentKind.LINK.value
    return MeetingAttachmentDTO(
        id=row.id,
        kind=row.kind,
        name=(row.label or row.url or "") if is_link else "",
        document_id=row.document_id,
        folder_path=None,
        size_bytes=None,
        updated_at=row.updated_at,
        url=row.url,
        is_deleted=False,
    )


async def list_attachments(
    session: AsyncSession, meeting_id: int
) -> list[MeetingAttachmentDTO]:
    rows = (
        await session.scalars(
            select(MeetingAttachment)
            .where(MeetingAttachment.meeting_id == meeting_id)
            .order_by(MeetingAttachment.id)
        )
    ).all()
    return [_attachment_to_dto(row) for row in rows]


async def create_attachment(
    session: AsyncSession,
    *,
    meeting_id: int,
    kind: str,
    document_id: int | None,
    url: str | None,
    label: str | None,
) -> MeetingAttachmentDTO:
    row = MeetingAttachment(
        meeting_id=meeting_id, kind=kind, document_id=document_id, url=url, label=label
    )
    session.add(row)
    await session.flush()
    return _attachment_to_dto(row)


async def find_attachment(
    session: AsyncSession, *, meeting_id: int, attachment_id: int
) -> MeetingAttachmentDTO | None:
    row = (
        await session.scalars(
            select(MeetingAttachment).where(
                MeetingAttachment.id == attachment_id,
                MeetingAttachment.meeting_id == meeting_id,
            )
        )
    ).one_or_none()
    return None if row is None else _attachment_to_dto(row)


async def find_attachment_by_document(
    session: AsyncSession, *, meeting_id: int, document_id: int
) -> MeetingAttachmentDTO | None:
    """같은 문서 재첨부 판정 — **행을 늘리지 않고 201**(SPEC-006 §4). 부분 UNIQUE 가 최종 방어선이다."""
    row = (
        await session.scalars(
            select(MeetingAttachment).where(
                MeetingAttachment.meeting_id == meeting_id,
                MeetingAttachment.document_id == document_id,
            )
        )
    ).one_or_none()
    return None if row is None else _attachment_to_dto(row)


async def delete_attachment(
    session: AsyncSession, *, meeting_id: int, attachment_id: int
) -> None:
    """첨부 행만 지운다 — **문서·링크 원본은 건드리지 않는다**(SPEC-006 U-7)."""
    await session.execute(
        delete(MeetingAttachment).where(
            MeetingAttachment.id == attachment_id,
            MeetingAttachment.meeting_id == meeting_id,
        )
    )
    await session.flush()


# --- 배치 이력 (읽기만) --------------------------------------------------


async def max_succeeded_batch_seq(session: AsyncSession, meeting_id: int) -> int:
    """`latestBatchSeq` — 성공한 배치의 최대 `seq`(M-6-a · 파생). 비어 있으면 `0`."""
    current = await session.scalar(
        select(func.max(MeetingBatchRun.seq)).where(
            MeetingBatchRun.meeting_id == meeting_id,
            MeetingBatchRun.status == BatchRunStatus.SUCCEEDED.value,
        )
    )
    return 0 if current is None else current

