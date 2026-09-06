"""3층 — `task` 본체의 ORM/SQL 만. **ORM 모델을 밖으로 내지 않는다**(§2 · §3 규칙 2).

- **모든 조회는 `account_id` 로 먼저 좁힌다**(G-5).
- **기본 조회는 `deleted_at IS NULL`**(T-11 · §0-1).
- `commit()` 하지 않는다 — flush 까지다(§7).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy import ColumnElement, Select, and_, case, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from dto.enums import UNFINISHED_STATUSES, TaskSort, TaskStatus
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
        start_date=task.start_date,
        due_date=task.due_date,
        started_at=task.started_at,
        completed_at=task.completed_at,
        cancelled_at=task.cancelled_at,
        description=task.description,
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
    start_date: date | None,
    due_date: date | None,
    description: str | None,
) -> int:
    """새 업무의 id 를 돌려준다. **상태는 DB 기본값(`todo`)** 이다(DEC-002 §5).

    **실적 두 컬럼은 받지 않는다** — 생성 시점에는 어떤 전이도 없었으므로 `NULL` 이다(T-1-c).
    """
    row = Task(
        account_id=account_id,
        work_type_id=work_type_id,
        project_id=project_id,
        title=title,
        start_date=start_date,
        due_date=due_date,
        description=description,
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


def _last_transition_at(to_status: str) -> ColumnElement[datetime]:
    """그 상태로 **들어간 마지막 전이 로그**의 시각(T-8-a)."""
    return (
        select(func.max(TaskLog.created_at))
        .select_from(TaskLog)
        .where(TaskLog.task_id == Task.id, TaskLog.to_status == to_status)
        .scalar_subquery()
    )


async def sync_actuals(session: AsyncSession, *, account_id: int, task_id: int) -> None:
    """실적 3컬럼을 **전이 로그에서 다시 계산한다**(T-1-c).

    **컬럼은 로그의 파생이고 로그가 정본이다**(T-8-a). 그래서 값을 손으로 대입하지 않고
    로그를 다시 읽어 채운다 — 전이가 로그를 **쓴 뒤**, 실행취소가 로그를 **지운 뒤**
    같은 트랜잭션에서 이 함수가 돌면 둘은 갈릴 수 없다.

    **실행취소가 실적을 되돌리는 방식이 이것이다.** 「무엇을 되돌릴지」를 따로 기억하지 않는다 —
    되돌린 뒤의 로그를 그대로 읽으면 되돌린 뒤의 실적이 나온다. 완료 → 진행중 → (실행취소) →
    완료 처럼 **이전 완료 이력이 남아 있는 경우**에도 옛 값이 정확히 살아난다.

    `NOW()` 를 쓰지 않는 이유도 같다 — 로그 행의 `created_at` 이 전이 시각의 정본이라
    두 시각이 몇 밀리초 어긋나는 자리를 만들지 않는다.
    """
    await session.execute(
        update(Task)
        .where(
            Task.account_id == account_id,
            Task.deleted_at.is_(None),
            Task.id == task_id,
        )
        .values(
            started_at=_last_transition_at(TaskStatus.IN_PROGRESS.value),
            completed_at=_last_transition_at(TaskStatus.DONE.value),
            cancelled_at=_last_transition_at(TaskStatus.CANCELLED.value),
        )
        # 값을 DB 가 계산하므로 세션에 남은 인스턴스는 **낡는다.**
        # `fetch` 가 해당 행의 속성을 만료시켜, 바로 뒤의 응답 조회가 새 값을 읽는다.
        .execution_options(synchronize_session="fetch")
    )
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
    *, from_date: date, to_date: date, moment_from: datetime, moment_to: datetime
) -> ColumnElement[bool]:
    """**조회 규칙 4종**(SPEC-004 §4 · DEC-002 §「오늘 화면에 뜨는 것 — 4종」, 2026-09-06 사용자 확정).

    이전 규칙(「기한이 범위 안 **또는** 기한 없으면 생성일 기준 달」)을 **대체한다.**
    T-1-a 의 「기한 없는 업무는 생성일 기준 달에 속한다」는 폐기됐다 — 아래 R-2 가 그 자리를 갖는다.

    **상태가 규칙을 가른다.** 미완료는 계획(R-1~R-3)으로, 종결은 **실적**(R-4)으로 거른다.
    두 갈래는 겹치지 않는다 — 그래서 「어제 기한·어제 완료」가 오늘 화면에서 사라지고,
    「어제 기한·오늘 완료」는 오늘 화면에 남는다(사용자 확정 규칙의 핵심).

    | # | 무엇 | 조건 |
    |---|---|---|
    | R-1 | 계획 기간이 범위에 걸침 | 구간 겹침. 한쪽이 `NULL` 이면 **있는 쪽을 점으로** 본다 |
    | R-2 | 기한 없음 | `due_date IS NULL` + 미완료 → **범위와 무관하게 항상** |
    | R-3 | 지연 | `due_date < from` + 미완료 → 포함 |
    | R-4 | 완료 · 취소 | 실적 시각이 범위 안일 때만. **`due_date` 로 거르지 않는다** |

    **끝 경계는 닫는다**(`<= to`). 프론트가 `from = to = 오늘` 을 보내므로 열려 있으면
    오늘 업무가 하나도 안 나온다 — WORK-005 검수 FAIL-① 이 이 어긋남이었고(말일 업무가 통째로
    사라졌다) 조회 단위가 일이 된 지금은 **매일** 터진다.

    기한은 달력 날짜(KST)로, 실적은 순간(UTC)으로 비교한다 — 두 축의 타입이 다르다(G-2 · G-2-e).
    `moment_from`·`moment_to` 는 service 가 **같은 날짜 범위를 순간으로 옮겨** 넘긴 값이다.
    """
    unfinished = Task.status.in_(UNFINISHED_STATUSES)

    # R-1 — **구간 겹침**이다. 한쪽이 없으면 있는 쪽을 점 구간으로 본다
    # (DEC-002 「시작이 없으면 due_date = 오늘」 — 2026-09-06 코디 확인).
    # 계획이 아예 없는 업무는 여기 걸리지 않는다(R-2 가 맡는다).
    plan_start = func.coalesce(Task.start_date, Task.due_date)
    plan_end = func.coalesce(Task.due_date, Task.start_date)
    r1 = and_(plan_start <= to_date, plan_end >= from_date)

    # R-2 — 기한이 없으면 **매일** 뜬다. 안 뜨면 영영 안 보이고 기한을 정할 계기가 생기지 않는다
    r2 = Task.due_date.is_(None)

    # R-3 — 지연. 범위보다 앞선 기한이어도 아직 안 끝났으면 **가장 봐야 할 것**이다
    r3 = Task.due_date < from_date

    # R-4 — 종결 2종은 **실적 시각**만 본다. 취소 시각은 취소 전이 로그가 정본이다(T-8-a)
    return or_(
        and_(unfinished, or_(r1, r2, r3)),
        and_(
            Task.status == TaskStatus.DONE.value,
            _in_moment_range(Task.completed_at, moment_from, moment_to),
        ),
        and_(
            Task.status == TaskStatus.CANCELLED.value,
            _in_moment_range(Task.cancelled_at, moment_from, moment_to),
        ),
    )


def _in_moment_range(
    moment: ColumnElement[datetime], moment_from: datetime, moment_to: datetime
) -> ColumnElement[bool]:
    """실적 **순간**이 조회 날짜 범위 안인가.

    범위는 **반열림**(`>= from`, `< to`)인데 **끝 경계가 닫힌 것**이다 — service 가 `to_date`
    **다음 날 `00:00`(KST)** 을 `moment_to` 로 넘기기 때문이다. 순간 축에서 날짜의 마지막
    밀리초를 적어 내려는 시도(`23:59:59.999`)는 정밀도에 기대게 되므로 하지 않는다.

    **행마다 타임존 변환을 하지 않는다** — 변환은 service 에서 두 상수에 한 번 일어난다.
    """
    return and_(moment.is_not(None), moment >= moment_from, moment < moment_to)


def _list_filters(
    *,
    from_date: date,
    to_date: date,
    moment_from: datetime,
    moment_to: datetime,
    work_type_id: int | None,
    status: str | None,
    project_id: int | None,
) -> list[ColumnElement[bool]]:
    """목록·집계가 **같은 조건**을 보도록 한 곳에 둔다.

    `total`·`statusCounts`·`typeCounts`·`unfilteredTotal` 이 전부 여기를 지난다 —
    **기간 규칙의 단일 진입점이 `_period_filter` 하나**여야 네 수가 서로 어긋나지 않는다.

    `work_type_id` 만 따로 뺄 수 있어야 한다 — `typeCounts` 가 **유형 탭 자신을 반영하지 않기** 때문이다.
    """
    filters = [
        _period_filter(
            from_date=from_date,
            to_date=to_date,
            moment_from=moment_from,
            moment_to=moment_to,
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


_SORTS = {
    # 기한 없는 업무는 **맨 아래**다(DEC-002 §3). Postgres 의 DESC 기본은 NULLS FIRST 라 둘 다 명시한다.
    # 정렬 축은 **계획 종료(`due_date`)** 하나다 — 「기한 빠른 순」이 그 뜻이고(SPEC-004 §4 정렬 3종)
    # `start_date` 가 생겼다고 축을 늘리지 않는다.
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
    moment_from: datetime,
    moment_to: datetime,
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
        moment_from=moment_from,
        moment_to=moment_to,
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
    moment_from: datetime,
    moment_to: datetime,
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
                moment_from=moment_from,
                moment_to=moment_to,
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
    moment_from: datetime,
    moment_to: datetime,
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
                    moment_from=moment_from,
                    moment_to=moment_to,
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
    moment_from: datetime,
    moment_to: datetime,
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
                    moment_from=moment_from,
                    moment_to=moment_to,
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
        start_date=base.start_date,
        due_date=base.due_date,
        started_at=base.started_at,
        completed_at=base.completed_at,
        d_day=None if base.due_date is None else (base.due_date - today).days,
        is_overdue=is_overdue,
        overdue_days=overdue_days,
        memo_count=row.memo_count,  # type: ignore[attr-defined]
        todo_progress=TodoProgressDTO(
            done=row.todo_done,  # type: ignore[attr-defined]
            total=row.todo_total,  # type: ignore[attr-defined]
        ),
        cancel_reason=base.cancel_reason,
        # **마스킹하지 않는다**(2026-09-06 코디 확정) — 실적 셋은 전부 「마지막으로 그 상태에
        # 들어간 시각」이고 상태가 바뀌어도 지우지 않는다. 되살아난 업무를 조회에서 거르는 것은
        # R-4 의 `status` 게이트다. `cancel_reason` 과 성격이 다르다 — 저건 **사용자 입력**이라
        # 떠날 때 비우는 게 맞고(T-7), 이건 **시스템 이력**이라 남는 게 맞다.
        cancelled_at=base.cancelled_at,
    )


def _derived_columns() -> tuple[ColumnElement, ...]:
    return (
        _memo_count().label("memo_count"),
        _todo_count(done_only=True).label("todo_done"),
        _todo_count(done_only=False).label("todo_total"),
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
