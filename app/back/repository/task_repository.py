"""3층 — `task` 본체의 ORM/SQL 만. **ORM 모델을 밖으로 내지 않는다**(§2 · §3 규칙 2).

- **모든 조회는 `account_id` 로 먼저 좁힌다**(G-5).
- **기본 조회는 `deleted_at IS NULL`**(T-11 · §0-1).
- `commit()` 하지 않는다 — flush 까지다(§7).
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

from sqlalchemy import ColumnElement, Select, and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from dto.enums import TaskSort, TaskStatus
from dto.task import (
    ProjectRefDTO,
    TaskDTO,
    TaskListItemDTO,
    TodoProgressDTO,
    WorkTypeRefDTO,
    derive_overdue,
)
from models.account import Project, WorkType
from models.task import Task, TaskLog, TaskMemo, TaskTodo

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


def _candidate_filters(
    *,
    exclude_ids: set[int],
    keyword: str | None,
    scope_project_id: int | None,
    updated_after: datetime | None,
) -> list[ColumnElement[bool]]:
    """후보를 **잘라내는** 조건들(SPEC-003 §4 `scope`).

    총계와 목록이 **같은 조건**을 봐야 `total` 과 `items` 가 어긋나지 않는다 —
    그래서 조건을 여기 한 번만 적고 두 쿼리가 나눠 쓴다.

    `scope_project_id`·`updated_after` 는 service 가 `scope` 를 풀어 넘긴 값이다.
    `None` 이면 그 축으로 자르지 않는다.
    """
    filters: list[ColumnElement[bool]] = []
    if exclude_ids:
        filters.append(Task.id.not_in(exclude_ids))
    if keyword:
        filters.append(Task.title.ilike(f"%{keyword}%"))
    if scope_project_id is not None:
        filters.append(Task.project_id == scope_project_id)
    if updated_after is not None:
        filters.append(Task.updated_at >= updated_after)
    return filters


async def count_relation_candidates(
    session: AsyncSession,
    *,
    account_id: int,
    exclude_ids: set[int],
    keyword: str | None,
    scope_project_id: int | None,
    updated_after: datetime | None,
) -> int:
    """`scope` 를 적용한 뒤의 **총계**(U-8 「n건 중 m」의 `n`).

    **`len(items)` 가 아니다** — 상위 20건만 내려주므로 21건부터 갈린다. 그래서 세어서 준다.
    """
    total = await session.scalar(
        select(func.count())
        .select_from(Task)
        .where(
            Task.account_id == account_id,
            Task.deleted_at.is_(None),
            *_candidate_filters(
                exclude_ids=exclude_ids,
                keyword=keyword,
                scope_project_id=scope_project_id,
                updated_after=updated_after,
            ),
        )
    )
    return total or 0


async def find_relation_candidates(
    session: AsyncSession,
    *,
    account_id: int,
    project_id: int | None,
    due_date: date | None,
    exclude_ids: set[int],
    keyword: str | None,
    scope_project_id: int | None,
    updated_after: datetime | None,
    limit: int,
) -> list[TaskDTO]:
    """연관업무 후보(SPEC-003 U-8 · §4 2026-09-06 개정).

    **자르는 축과 줄 세우는 축이 다르다** —
    `scope_project_id`·`updated_after` 는 필터이고,
    `project_id`·`due_date` 는 **정렬 근거**다(같은 프로젝트 → 기한 ±7일 → 최근 수정).

    **어떤 업무에도 매달리지 않는다** — 뺄 id 는 service 가 정해서 `exclude_ids` 로 넘긴다
    (생성 드로어는 뺄 것이 없고, 상세 드로어는 자기 자신 + 이미 연결된 것을 뺀다).
    """
    query = _with_refs(account_id).where(
        *_candidate_filters(
            exclude_ids=exclude_ids,
            keyword=keyword,
            scope_project_id=scope_project_id,
            updated_after=updated_after,
        )
    )

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


# --- 상태 · 삭제 (SPEC-004) ----------------------------------------------


async def update_status(
    session: AsyncSession,
    *,
    account_id: int,
    task_id: int,
    status: str,
    cancel_reason: str | None,
) -> None:
    """**`task.status` 에 값을 대입하는 유일한 코드다.**

    판정(전이 그래프·완료 게이트)은 하지 않는다 — 그건 `task_service.change_status()` 의 몫이고,
    이 함수를 부르는 곳도 그 판정을 지난 두 경로뿐이다(전이·실행취소).

    T-7 — `cancel_reason` 은 `cancelled` 일 때만 값이 있다. 다른 상태로 가면 **비운다**
    (DB CHECK `ck_task_cancel_reason_only_when_cancelled` 가 최종 방어선이다).
    """
    row = (
        await session.scalars(
            select(Task).where(
                Task.account_id == account_id,
                Task.deleted_at.is_(None),
                Task.id == task_id,
            )
        )
    ).one()

    row.status = status
    row.cancel_reason = cancel_reason
    await session.flush()


async def soft_delete(
    session: AsyncSession, *, account_id: int, task_id: int, deleted_at: datetime
) -> None:
    """T-11 — `deleted_at` 만 채운다. **자식 행을 지우지 않는다**(부모 필터로 함께 사라진다).

    `schedule` 행도 그대로 둔다 — 조회·겹침 검사가 원본을 조인해 거른다(§3-3 · C-5-c).
    """
    row = (
        await session.scalars(
            select(Task).where(
                Task.account_id == account_id,
                Task.deleted_at.is_(None),
                Task.id == task_id,
            )
        )
    ).one()
    row.deleted_at = deleted_at
    await session.flush()


# --- 목록 (SPEC-004 §4) --------------------------------------------------


def _period_filter(
    *, from_date: date, to_date: date, period_from: datetime, period_to: datetime
) -> ColumnElement[bool]:
    """T-1-a — **기한 없는 업무는 생성일 기준 달에 속한다.**

    기한은 달력 날짜(KST)로, 생성일은 순간(UTC)으로 비교한다 — 두 축의 타입이 다르다(G-2 · G-2-e).
    끝 경계는 **열려 있다**(`< to`).
    """
    return or_(
        and_(Task.due_date.is_not(None), Task.due_date >= from_date, Task.due_date < to_date),
        and_(
            Task.due_date.is_(None),
            Task.created_at >= period_from,
            Task.created_at < period_to,
        ),
    )


def _list_filters(
    *,
    from_date: date,
    to_date: date,
    period_from: datetime,
    period_to: datetime,
    work_type_id: int | None,
    status: str | None,
    project_id: int | None,
) -> list[ColumnElement[bool]]:
    """목록·집계가 **같은 조건**을 보도록 한 곳에 둔다.

    `work_type_id` 만 따로 뺄 수 있어야 한다 — `typeCounts` 가 **유형 탭 자신을 반영하지 않기** 때문이다.
    """
    filters = [
        _period_filter(
            from_date=from_date,
            to_date=to_date,
            period_from=period_from,
            period_to=period_to,
        )
    ]
    if work_type_id is not None:
        filters.append(Task.work_type_id == work_type_id)
    if status is not None:
        filters.append(Task.status == status)
    if project_id is not None:
        filters.append(Task.project_id == project_id)
    return filters


def _memo_count() -> ColumnElement[int]:
    return (
        select(func.count())
        .select_from(TaskMemo)
        .where(TaskMemo.task_id == Task.id)
        .scalar_subquery()
    )


def _todo_count(*, done_only: bool) -> ColumnElement[int]:
    query = select(func.count()).select_from(TaskTodo).where(TaskTodo.task_id == Task.id)
    if done_only:
        query = query.where(TaskTodo.done.is_(True))
    return query.scalar_subquery()


def _cancelled_at() -> ColumnElement[datetime]:
    """취소 시각은 **취소 전이 로그**에서 파생한다 — `task` 에 컬럼을 두지 않는다(G-7)."""
    return (
        select(func.max(TaskLog.created_at))
        .select_from(TaskLog)
        .where(
            TaskLog.task_id == Task.id,
            TaskLog.to_status == TaskStatus.CANCELLED.value,
        )
        .scalar_subquery()
    )


_SORTS = {
    # T-1-a — 기한 없는 업무는 **맨 아래**다. Postgres 의 DESC 기본은 NULLS FIRST 라 둘 다 명시한다
    TaskSort.DUE_ASC.value: (Task.due_date.asc().nullslast(), Task.id.asc()),
    TaskSort.DUE_DESC.value: (Task.due_date.desc().nullslast(), Task.id.desc()),
    TaskSort.CREATED_DESC.value: (Task.created_at.desc(), Task.id.desc()),
}


async def list_tasks(
    session: AsyncSession,
    *,
    account_id: int,
    from_date: date,
    to_date: date,
    period_from: datetime,
    period_to: datetime,
    work_type_id: int | None,
    status: str | None,
    project_id: int | None,
    sort: str,
    page: int,
    size: int,
    today: date,
) -> list[TaskListItemDTO]:
    """목록 한 페이지. **`schedule` 을 조인하지 않는다** — `task` 인덱스만 탄다(BE §12 5-a).

    파생 카운트(메모·할일)는 **스칼라 서브쿼리**라 행마다 쿼리가 늘지 않는다.
    """
    filters = _list_filters(
        from_date=from_date,
        to_date=to_date,
        period_from=period_from,
        period_to=period_to,
        work_type_id=work_type_id,
        status=status,
        project_id=project_id,
    )

    query = (
        _with_refs(account_id)
        .add_columns(*_derived_columns())
        .where(*filters)
        .order_by(*_SORTS[sort])
        .offset((page - 1) * size)
        .limit(size)
    )
    rows = (await session.execute(query)).all()
    return [_to_list_item(row, today=today) for row in rows]


async def count_tasks(
    session: AsyncSession,
    *,
    account_id: int,
    from_date: date,
    to_date: date,
    period_from: datetime,
    period_to: datetime,
    work_type_id: int | None,
    status: str | None,
    project_id: int | None,
) -> int:
    total = await session.scalar(
        select(func.count())
        .select_from(Task)
        .where(
            Task.account_id == account_id,
            Task.deleted_at.is_(None),
            *_list_filters(
                from_date=from_date,
                to_date=to_date,
                period_from=period_from,
                period_to=period_to,
                work_type_id=work_type_id,
                status=status,
                project_id=project_id,
            ),
        )
    )
    return total or 0


async def count_by_status(
    session: AsyncSession,
    *,
    account_id: int,
    from_date: date,
    to_date: date,
    period_from: datetime,
    period_to: datetime,
    work_type_id: int | None,
    project_id: int | None,
) -> dict[str, int]:
    """`statusCounts` — **상태 필터 자신은 반영하지 않는다**(SPEC-004 §4).

    `typeCounts` 와 같은 결이다 — 자기 축만 빼고 나머지 필터는 반영한다.
    상태 필터를 걸었다고 다른 컬럼 수가 0 이 되면 칸반 완료 컬럼의 「8월 12」가 흔들린다.

    **`items` 를 세지 않는다** — `size` 상한에 걸리면 두 수가 갈리고,
    그때 「그 달 완료 건수」가 「지금 받아온 것 중 완료 건수」로 조용히 바뀐다.
    """
    rows = (
        await session.execute(
            select(Task.status, func.count().label("count"))
            .where(
                Task.account_id == account_id,
                Task.deleted_at.is_(None),
                *_list_filters(
                    from_date=from_date,
                    to_date=to_date,
                    period_from=period_from,
                    period_to=period_to,
                    work_type_id=work_type_id,
                    status=None,
                    project_id=project_id,
                ),
            )
            .group_by(Task.status)
        )
    ).all()
    return {row.status: row.count for row in rows}


async def count_by_work_type(
    session: AsyncSession,
    *,
    account_id: int,
    from_date: date,
    to_date: date,
    period_from: datetime,
    period_to: datetime,
    status: str | None,
    project_id: int | None,
) -> list[tuple[int, str, int]]:
    """`typeCounts` — **유형 탭 자신은 반영하지 않는다**(SPEC-004 §4).

    `work_type_id` 를 조건에서 뺀 채 센다. 탭에 붙는 수가 **탭을 누를 때마다 흔들리면 안 된다.**
    기간·상태·프로젝트는 반영한다.
    """
    rows = (
        await session.execute(
            select(WorkType.id, WorkType.name, func.count().label("count"))
            .select_from(Task)
            .join(WorkType, WorkType.id == Task.work_type_id)
            .where(
                Task.account_id == account_id,
                Task.deleted_at.is_(None),
                *_list_filters(
                    from_date=from_date,
                    to_date=to_date,
                    period_from=period_from,
                    period_to=period_to,
                    work_type_id=None,
                    status=status,
                    project_id=project_id,
                ),
            )
            .group_by(WorkType.id, WorkType.name)
            .order_by(WorkType.id)
        )
    ).all()
    return [(row.id, row.name, row.count) for row in rows]


def _to_list_item(row: object, *, today: date) -> TaskListItemDTO:
    """행 → 목록 항목. **파생값을 여기서 붙인다**(G-7 — 컬럼으로 두지 않는다).

    「지연」은 **기한 경과 + 완료·취소 아님**이다(T-4). `today` 는 service 가 앱 타임존으로 정해 넘긴다.
    """
    base = _row_to_dto(row)
    is_overdue, overdue_days = derive_overdue(base.due_date, base.status, today)
    return TaskListItemDTO(
        id=base.id,
        title=base.title,
        status=base.status,
        work_type=base.work_type,
        project=base.project,
        due_date=base.due_date,
        due_start_time=base.due_start_time,
        due_end_time=base.due_end_time,
        d_day=None if base.due_date is None else (base.due_date - today).days,
        is_overdue=is_overdue,
        overdue_days=overdue_days,
        memo_count=row.memo_count,  # type: ignore[attr-defined]
        todo_progress=TodoProgressDTO(
            done=row.todo_done,  # type: ignore[attr-defined]
            total=row.todo_total,  # type: ignore[attr-defined]
        ),
        cancel_reason=base.cancel_reason,
        # 취소 상태일 때만 의미가 있다 — 되살아난 업무에 옛 취소 시각을 달지 않는다
        cancelled_at=(
            row.cancelled_at  # type: ignore[attr-defined]
            if base.status == TaskStatus.CANCELLED.value
            else None
        ),
    )


def _derived_columns() -> tuple[ColumnElement, ...]:
    return (
        _memo_count().label("memo_count"),
        _todo_count(done_only=True).label("todo_done"),
        _todo_count(done_only=False).label("todo_total"),
        _cancelled_at().label("cancelled_at"),
    )


async def find_list_item(
    session: AsyncSession, *, account_id: int, task_id: int, today: date
) -> TaskListItemDTO | None:
    """단건을 **목록 항목과 같은 형태**로 읽는다 — 상태 전이 응답이 이것이다(SPEC-004 §4)."""
    row = (
        await session.execute(
            _with_refs(account_id).add_columns(*_derived_columns()).where(Task.id == task_id)
        )
    ).one_or_none()
    return None if row is None else _to_list_item(row, today=today)
