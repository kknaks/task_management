"""3층 — 업무 자식 5종(할일·메모·로그·첨부·연관)의 ORM/SQL 만.

소유 검사는 **service 가 부모 업무로 먼저 한다**(§9) — 여기 오는 `task_id` 는 이미 본인 것이다.
`commit()` 하지 않는다.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from dto.enums import AttachmentKind
from dto.task import (
    TaskAttachmentDTO,
    TaskLogDTO,
    TaskMemoDTO,
    TaskRelationDTO,
    TaskTodoDTO,
    TodoProgressDTO,
)
from models.account import Project
from models.task import Task, TaskAttachment, TaskLog, TaskMemo, TaskRelation, TaskTodo


# --- 할일 ---------------------------------------------------------------


def _todo_to_dto(row: TaskTodo) -> TaskTodoDTO:
    return TaskTodoDTO(
        id=row.id, text=row.content, done=row.done, due_date=row.due_date
    )


async def list_todos(session: AsyncSession, task_id: int) -> list[TaskTodoDTO]:
    rows = (
        await session.scalars(
            select(TaskTodo)
            .where(TaskTodo.task_id == task_id)
            .order_by(TaskTodo.order_index, TaskTodo.id)
        )
    ).all()
    return [_todo_to_dto(row) for row in rows]


async def count_todo_progress(session: AsyncSession, task_id: int) -> TodoProgressDTO:
    """진행률은 **파생값**이다(G-7) — 컬럼으로 두지 않고 셀 때마다 센다."""
    row = (
        await session.execute(
            select(
                func.count().label("total"),
                func.count().filter(TaskTodo.done.is_(True)).label("done"),
            ).where(TaskTodo.task_id == task_id)
        )
    ).one()
    return TodoProgressDTO(done=row.done or 0, total=row.total or 0)


async def next_todo_order_index(session: AsyncSession, task_id: int) -> int:
    current = await session.scalar(
        select(func.max(TaskTodo.order_index)).where(TaskTodo.task_id == task_id)
    )
    return 0 if current is None else current + 1


async def create_todo(
    session: AsyncSession,
    *,
    task_id: int,
    text: str,
    due_date: date | None,
    order_index: int,
) -> TaskTodoDTO:
    row = TaskTodo(
        task_id=task_id, content=text, due_date=due_date, order_index=order_index
    )
    session.add(row)
    await session.flush()
    return _todo_to_dto(row)


async def find_todo(
    session: AsyncSession, *, task_id: int, todo_id: int
) -> TaskTodoDTO | None:
    row = (
        await session.scalars(
            select(TaskTodo).where(TaskTodo.id == todo_id, TaskTodo.task_id == task_id)
        )
    ).one_or_none()
    return None if row is None else _todo_to_dto(row)


async def update_todo(
    session: AsyncSession, *, task_id: int, todo_id: int, values: dict[str, object]
) -> TaskTodoDTO:
    row = (
        await session.scalars(
            select(TaskTodo).where(TaskTodo.id == todo_id, TaskTodo.task_id == task_id)
        )
    ).one()
    for name, value in values.items():
        setattr(row, name, value)
    await session.flush()
    return _todo_to_dto(row)


async def delete_todo(session: AsyncSession, *, task_id: int, todo_id: int) -> None:
    """할일은 **자식 행**이라 하드 삭제다(§0-1 — 복원 창구가 없다)."""
    await session.execute(
        delete(TaskTodo).where(TaskTodo.id == todo_id, TaskTodo.task_id == task_id)
    )
    await session.flush()


# --- 메모 ---------------------------------------------------------------


async def list_memos(session: AsyncSession, task_id: int) -> list[TaskMemoDTO]:
    """최신순(U-9)."""
    rows = (
        await session.scalars(
            select(TaskMemo)
            .where(TaskMemo.task_id == task_id)
            .order_by(TaskMemo.created_at.desc(), TaskMemo.id.desc())
        )
    ).all()
    return [
        TaskMemoDTO(id=row.id, text=row.content, created_at=row.created_at)
        for row in rows
    ]


async def create_memo(session: AsyncSession, *, task_id: int, text: str) -> TaskMemoDTO:
    row = TaskMemo(task_id=task_id, content=text)
    session.add(row)
    await session.flush()
    return TaskMemoDTO(id=row.id, text=row.content, created_at=row.created_at)


# --- 로그 ---------------------------------------------------------------


async def list_logs(session: AsyncSession, task_id: int) -> list[TaskLogDTO]:
    """최신순(U-10)."""
    rows = (
        await session.scalars(
            select(TaskLog)
            .where(TaskLog.task_id == task_id)
            .order_by(TaskLog.created_at.desc(), TaskLog.id.desc())
        )
    ).all()
    return [
        TaskLogDTO(id=row.id, text=row.content, created_at=row.created_at)
        for row in rows
    ]


async def create_log(session: AsyncSession, *, task_id: int, text: str) -> None:
    """**서비스만 부른다.** 사용자는 로그를 쓰거나 지울 수 없다(DEC-002 §6)."""
    session.add(TaskLog(task_id=task_id, content=text))
    await session.flush()


# --- 첨부 ---------------------------------------------------------------


def _attachment_to_dto(row: TaskAttachment) -> TaskAttachmentDTO:
    """`name` — 링크는 표시 이름(비우면 URL 자체).

    `doc` 의 이름·폴더 경로는 `document` 테이블에서 와야 하는데 **아직 없다** —
    `doc` 첨부 자체를 거부하므로 이 갈래로 오는 행이 없다(WORK-004 §Open Issues).
    """
    name = row.label or row.url if row.kind == AttachmentKind.LINK.value else None
    return TaskAttachmentDTO(
        id=row.id,
        role=row.role,
        kind=row.kind,
        name=name,
        document_id=row.document_id,
        folder_path=None,
        url=row.url,
    )


async def list_attachments(
    session: AsyncSession, task_id: int
) -> list[TaskAttachmentDTO]:
    rows = (
        await session.scalars(
            select(TaskAttachment)
            .where(TaskAttachment.task_id == task_id)
            .order_by(TaskAttachment.id)
        )
    ).all()
    return [_attachment_to_dto(row) for row in rows]


async def create_attachment(
    session: AsyncSession,
    *,
    task_id: int,
    role: str,
    kind: str,
    document_id: int | None,
    url: str | None,
    label: str | None,
) -> TaskAttachmentDTO:
    row = TaskAttachment(
        task_id=task_id,
        role=role,
        kind=kind,
        document_id=document_id,
        url=url,
        label=label,
    )
    session.add(row)
    await session.flush()
    return _attachment_to_dto(row)


async def find_attachment(
    session: AsyncSession, *, task_id: int, attachment_id: int
) -> TaskAttachmentDTO | None:
    row = (
        await session.scalars(
            select(TaskAttachment).where(
                TaskAttachment.id == attachment_id, TaskAttachment.task_id == task_id
            )
        )
    ).one_or_none()
    return None if row is None else _attachment_to_dto(row)


async def delete_attachment(
    session: AsyncSession, *, task_id: int, attachment_id: int
) -> None:
    await session.execute(
        delete(TaskAttachment).where(
            TaskAttachment.id == attachment_id, TaskAttachment.task_id == task_id
        )
    )
    await session.flush()


# --- 연관업무 -----------------------------------------------------------


async def list_related_ids(session: AsyncSession, task_id: int) -> set[int]:
    """T-10 — 무방향 1행이라 **두 컬럼을 모두 본다.**"""
    rows = (
        await session.execute(
            select(TaskRelation.low_task_id, TaskRelation.high_task_id).where(
                or_(
                    TaskRelation.low_task_id == task_id,
                    TaskRelation.high_task_id == task_id,
                )
            )
        )
    ).all()
    return {
        (row.high_task_id if row.low_task_id == task_id else row.low_task_id)
        for row in rows
    }


async def list_relations(
    session: AsyncSession, *, task_id: int, limit: int
) -> tuple[list[TaskRelationDTO], int]:
    """상세에는 **최근 5건 + 전체 수**만 싣는다(06-related-tasks).

    상대 업무가 소프트 딜리트됐으면 목록에서 빠진다(T-11).
    """
    related_ids = await list_related_ids(session, task_id)
    if not related_ids:
        return [], 0

    query = (
        select(Task, Project.name.label("project_name"))
        .outerjoin(Project, Project.id == Task.project_id)
        .where(Task.id.in_(related_ids), Task.deleted_at.is_(None))
        .order_by(Task.updated_at.desc(), Task.id.desc())
    )

    total = await session.scalar(
        select(func.count())
        .select_from(Task)
        .where(Task.id.in_(related_ids), Task.deleted_at.is_(None))
    )

    rows = (await session.execute(query.limit(limit))).all()
    return (
        [
            TaskRelationDTO(
                id=row.Task.id,
                title=row.Task.title,
                status=row.Task.status,
                project_name=row.project_name,
                due_date=row.Task.due_date,
            )
            for row in rows
        ],
        total or 0,
    )


async def create_relations(
    session: AsyncSession, *, task_id: int, other_ids: list[int]
) -> int:
    """무방향 1행으로 정규화해 넣는다. **이미 있는 쌍은 건너뛴다**(T-10).

    새로 만든 행 수를 돌려준다 — 로그 문구의 `n` 이 된다.
    """
    existing = await list_related_ids(session, task_id)
    created = 0

    for other_id in other_ids:
        if other_id in existing:
            continue
        low, high = sorted((task_id, other_id))
        session.add(TaskRelation(low_task_id=low, high_task_id=high))
        existing.add(other_id)
        created += 1

    await session.flush()
    return created


async def delete_relation(
    session: AsyncSession, *, task_id: int, other_task_id: int
) -> None:
    low, high = sorted((task_id, other_task_id))
    await session.execute(
        delete(TaskRelation).where(
            TaskRelation.low_task_id == low, TaskRelation.high_task_id == high
        )
    )
    await session.flush()
