"""3층 — `task` 본체의 ORM/SQL 만. **ORM 모델을 밖으로 내지 않는다**(§2 · §3 규칙 2).

- **모든 조회는 `account_id` 로 먼저 좁힌다**(G-5).
- **기본 조회는 `deleted_at IS NULL`**(T-11 · §0-1).
- `commit()` 하지 않는다 — flush 까지다(§7).
"""

from __future__ import annotations

from datetime import date, time, timedelta

from sqlalchemy import Select, case, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from dto.task import ProjectRefDTO, TaskDTO, WorkTypeRefDTO
from models.account import Project, WorkType
from models.task import Task

# 참조 표시용 조인 — **삭제된 유형·프로젝트도 이름·색을 그대로 가져온다**(A-6).
_WorkTypeRef = aliased(WorkType)
_ProjectRef = aliased(Project)


def _row_to_dto(row: object) -> TaskDTO:
    task: Task = row.Task  # type: ignore[attr-defined]
    return TaskDTO(
        id=task.id,
        title=task.title,
        status=task.status,
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
        due_date=task.due_date,
        due_start_time=task.due_start_time,
        due_end_time=task.due_end_time,
        background=task.background,
        goal=task.goal,
        completion_result=task.completion_result,
        cancel_reason=task.cancel_reason,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


def _with_refs(account_id: int) -> Select:
    """본체 + 유형·프로젝트 표시 정보를 한 번에 읽는다.

    유형은 필수라 INNER, 프로젝트는 0..1 이라 LEFT 다(T-2 · T-3).
    **삭제 여부로 거르지 않는다** — 삭제된 것도 이름·색을 그대로 보여줘야 한다(A-6).
    """
    return (
        select(
            Task,
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
        .join(_WorkTypeRef, _WorkTypeRef.id == Task.work_type_id)
        .outerjoin(_ProjectRef, _ProjectRef.id == Task.project_id)
        .where(Task.account_id == account_id, Task.deleted_at.is_(None))
    )


async def find_active(
    session: AsyncSession, *, account_id: int, task_id: int
) -> TaskDTO | None:
    """남의 것도 없는 것도 똑같이 `None` 이다 — 존재를 흘리지 않는다(§9)."""
    row = (
        await session.execute(_with_refs(account_id).where(Task.id == task_id))
    ).one_or_none()
    return None if row is None else _row_to_dto(row)


async def exists_active(
    session: AsyncSession, *, account_id: int, task_ids: list[int]
) -> set[int]:
    """주어진 id 중 **본인의 살아 있는** 업무만 돌려준다. 연관업무 검증이 쓴다."""
    if not task_ids:
        return set()
    rows = (
        await session.scalars(
            select(Task.id).where(
                Task.account_id == account_id,
                Task.deleted_at.is_(None),
                Task.id.in_(task_ids),
            )
        )
    ).all()
    return set(rows)


async def create(
    session: AsyncSession,
    *,
    account_id: int,
    work_type_id: int,
    title: str,
    project_id: int | None,
    due_date: date | None,
    due_start_time: time | None,
    due_end_time: time | None,
    background: str | None,
    goal: str | None,
) -> int:
    """새 업무의 id 를 돌려준다. **상태는 DB 기본값(`todo`)** 이다(DEC-002 §5)."""
    row = Task(
        account_id=account_id,
        work_type_id=work_type_id,
        project_id=project_id,
        title=title,
        due_date=due_date,
        due_start_time=due_start_time,
        due_end_time=due_end_time,
        background=background,
        goal=goal,
    )
    session.add(row)
    await session.flush()
    return row.id


async def update_fields(
    session: AsyncSession, *, account_id: int, task_id: int, values: dict[str, object]
) -> None:
    """**보낸 필드만** 바꾼다. `values` 는 service 가 `Unset` 을 걷어낸 결과다."""
    row = (
        await session.scalars(
            select(Task).where(
                Task.account_id == account_id,
                Task.deleted_at.is_(None),
                Task.id == task_id,
            )
        )
    ).one()

    for name, value in values.items():
        setattr(row, name, value)

    await session.flush()


async def find_relation_candidates(
    session: AsyncSession,
    *,
    account_id: int,
    project_id: int | None,
    due_date: date | None,
    exclude_ids: set[int],
    keyword: str | None,
    limit: int,
) -> list[TaskDTO]:
    """연관업무 후보(SPEC-003 U-8 · §4 2026-09-06 개정).

    검색어가 없으면 **같은 프로젝트 → 기한 ±7일 → 최근 수정** 순이다.
    **어떤 업무에도 매달리지 않는다** — 뺄 id 는 service 가 정해서 `exclude_ids` 로 넘긴다
    (생성 드로어는 뺄 것이 없고, 상세 드로어는 자기 자신 + 이미 연결된 것을 뺀다).
    """
    query = _with_refs(account_id)
    if exclude_ids:
        query = query.where(Task.id.not_in(exclude_ids))
    if keyword:
        query = query.where(Task.title.ilike(f"%{keyword}%"))

    # 우선순위를 정수로 낮춰 정렬한다 — 같은 프로젝트 0 · 기한 ±7일 1 · 나머지 2
    branches = []
    if project_id is not None:
        branches.append((Task.project_id == project_id, 0))
    if due_date is not None:
        branches.append(
            (
                Task.due_date.between(
                    due_date - timedelta(days=7), due_date + timedelta(days=7)
                ),
                1,
            )
        )

    if branches:
        query = query.order_by(case(*branches, else_=2))

    rows = (
        await session.execute(
            query.order_by(Task.updated_at.desc(), Task.id.desc()).limit(limit)
        )
    ).all()
    return [_row_to_dto(row) for row in rows]
