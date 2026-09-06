"""2층 — 업무 도메인 규칙. `fastapi` 도 `schemas/` 도 import 하지 않는다.

정본: SPEC-003 §4 Case Matrix(에러) · §5(규칙) · `domains/task.md` T-1~T-11.

**로그를 쓰는 곳은 이 파일 하나다**(T-8 · WP Internal Interface Contract).
대상은 **생성·할일 완료·첨부·연관 연결**뿐이고,
**제목·설명·완료 결과 인라인 편집은 대상이 아니다**(04-task-detail).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from core.exceptions import (
    CancelUndoNotAllowedError,
    InvalidStatusTransitionError,
    NotFoundError,
    TaskCompletionBlockedError,
    UndoNotAvailableError,
    ValidationError,
)
from dto.enums import AttachmentKind, RelationCandidateScope, TaskStatus
from dto.task import (
    AttachmentCreateDTO,
    StatusChangeDTO,
    StatusCountsDTO,
    TaskListFilterDTO,
    TaskListItemDTO,
    TaskListResultDTO,
    TypeCountDTO,
    TaskCreateDTO,
    TaskDetailDTO,
    TaskDTO,
    TaskUpdateDTO,
    TodoCreateDTO,
    TodoUpdateDTO,
    derive_overdue,
)
from dto.unset import UNSET
from repository import (
    project_repository,
    task_child_repository,
    task_repository,
    work_type_repository,
)
from service import schedule_service

# SPEC-003 §4 Case Matrix — 문구까지 계약이다.
_NOT_FOUND = "업무를 찾을 수 없습니다"
_INVALID_WORK_TYPE = "사용할 수 없는 유형입니다"
_INVALID_PROJECT = "사용할 수 없는 프로젝트입니다"
_INVALID_INPUT = "입력값을 확인해 주세요"

# 06-related-tasks — 상세에는 최근 5건만 싣는다
_RELATION_PREVIEW = 5
# SPEC-003 U-8 — 검색어가 없을 때 후보 최대 20건
_RELATION_CANDIDATE_LIMIT = 20
# `scope=recent30` 의 창 — 칩 문구 「최근 30일」이 그대로 값이다
_RECENT_SCOPE_DAYS = 30

_ALLOWED_URL_SCHEMES = frozenset({"http", "https"})


def _not_found() -> NotFoundError:
    """**없는 업무와 남의 업무가 같은 응답이다** — 존재를 흘리지 않는다(§5 · §9)."""
    return NotFoundError(_NOT_FOUND)


def _invalid_input(field: str | None = None) -> ValidationError:
    """`field` 는 요청 스키마의 이름(camelCase) — 화면이 어느 칸에 붙일지 고른다(회의·설정과 같은 규약)."""
    return ValidationError(_INVALID_INPUT, field=field)


def _today() -> date:
    """D-day 는 **앱 타임존(KST) 기준의 오늘**로 잰다 — 기한이 달력 개념이기 때문이다(G-2-e)."""
    return datetime.now(ZoneInfo(get_settings().app_timezone)).date()


# --- 조회 ---------------------------------------------------------------


async def _require_task(
    session: AsyncSession, *, account_id: int, task_id: int
) -> TaskDTO:
    found = await task_repository.find_active(
        session, account_id=account_id, task_id=task_id
    )
    if found is None:
        raise _not_found()
    return found


async def get_detail(
    session: AsyncSession, *, account_id: int, task_id: int
) -> TaskDetailDTO:
    """상세 — 본체 + 자식 + **파생값**(G-7)."""
    task = await _require_task(session, account_id=account_id, task_id=task_id)
    return await _build_detail(session, task)


async def _build_detail(session: AsyncSession, task: TaskDTO) -> TaskDetailDTO:
    relations, relation_total = await task_child_repository.list_relations(
        session, task_id=task.id, limit=_RELATION_PREVIEW
    )
    today = _today()
    # **목록과 같은 파생 규칙**을 쓴다 — 상세 헤더도 「n일 지남」을 그린다(SPEC-004 U-10)
    is_overdue, overdue_days = derive_overdue(task.due_date, task.status, today)

    return TaskDetailDTO(
        task=task,
        todos=await task_child_repository.list_todos(session, task.id),
        todo_progress=await task_child_repository.count_todo_progress(session, task.id),
        memos=await task_child_repository.list_memos(session, task.id),
        attachments=await task_child_repository.list_attachments(session, task.id),
        relations=relations,
        relation_total=relation_total,
        logs=await task_child_repository.list_logs(session, task.id),
        d_day=None if task.due_date is None else (task.due_date - today).days,
        # T-4 — 「지연」은 값이 아니다. 기한 경과 + 완료·취소 아님으로 파생한다.
        is_overdue=is_overdue,
        overdue_days=overdue_days,
    )


# --- 검증 ---------------------------------------------------------------


async def _require_usable_work_type(
    session: AsyncSession, *, account_id: int, work_type_id: int
) -> None:
    """T-2 — **본인의 삭제되지 않은** 유형이어야 한다.

    삭제됐거나 남의 것이면 `422 invalid_work_type`(SPEC-003 §4 Case Matrix).
    """
    found = await work_type_repository.find_active(
        session, account_id=account_id, work_type_id=work_type_id
    )
    if found is None:
        raise ValidationError(_INVALID_WORK_TYPE, code="invalid_work_type", field="workTypeId")


async def _require_usable_project(
    session: AsyncSession, *, account_id: int, project_id: int | None
) -> None:
    """T-3 — 보내면 본인의 삭제되지 않은 프로젝트여야 한다.

    없거나 삭제됐거나 남의 것이면 `422 invalid_project`(SPEC-003 §4 Case Matrix, 2026-09-06 신설).
    **유형과 코드를 나눈 이유는 화면에 셀렉터가 둘이라서**다 — 같은 코드면 어디가 틀렸는지 못 짚는다.
    """
    if project_id is None:
        return
    found = await project_repository.find_active(
        session, account_id=account_id, project_id=project_id
    )
    if found is None:
        raise ValidationError(_INVALID_PROJECT, code="invalid_project", field="projectId")


def _validate_attachment(attachment: AttachmentCreateDTO) -> None:
    """T-9 · T-9-a — `kind` 별로 채워지는 값이 갈린다.

    **`doc` 은 이 work 에서 거부한다** — 대상 `document` 테이블이 아직 없어
    가리킬 수 있는 문서가 존재하지 않는다(WORK-004 §Open Issues 의 임시 계약).
    문서함 work 가 FK 리비전과 함께 이 갈래를 실체화한다.
    """
    if attachment.kind == AttachmentKind.DOC.value:
        raise _invalid_input("kind")

    if attachment.url is None:
        raise _invalid_input("url")

    # `http`/`https` 만(SPEC-003 §4 Validation). `ftp://…` 는 거부한다.
    parsed = urlparse(attachment.url)
    if parsed.scheme not in _ALLOWED_URL_SCHEMES or not parsed.netloc:
        raise _invalid_input("url")

    if attachment.document_id is not None:
        raise _invalid_input("documentId")


async def _resolve_relation_targets(
    session: AsyncSession, *, account_id: int, task_id: int | None, target_ids: list[int]
) -> list[int]:
    """연관 대상 검증 — **본인의 삭제되지 않은 업무**이고 **자기 자신이 아니다**(T-10).

    하나라도 어긋나면 거부한다. 중복은 여기서 걷어낸다(중복 전송이 행을 늘리지 않는다).
    """
    unique_ids = list(dict.fromkeys(target_ids))
    if not unique_ids:
        return []

    if task_id is not None and task_id in unique_ids:
        raise _invalid_input("relatedTaskIds")

    usable = await task_repository.exists_active(
        session, account_id=account_id, task_ids=unique_ids
    )
    if len(usable) != len(unique_ids):
        raise _invalid_input("relatedTaskIds")

    return unique_ids


# --- 기한 · 일정 ---------------------------------------------------------


@dataclass(frozen=True)
class _Plan:
    """업무의 **계획 기간**. 계획 2필드가 전부다.

    실적(`started_at`·`completed_at`)은 여기 없다 — 사용자가 보내는 값이 아니다(T-1-c).
    **시각도 없다** — 2026-09-06 확정으로 업무의 시간 지정이 사라졌다(시간은 회의만 갖는다).
    """

    start_date: date | None
    due_date: date | None


def _validate_plan(plan: _Plan) -> None:
    """T-1 — 둘 다 있으면 `start_date <= due_date`. **한쪽만 있어도 된다.**

    DB CHECK 가 최종 방어선이지만 **여기서 먼저 잡아 계약대로 `422`** 로 낸다.
    """
    if (
        plan.start_date is not None
        and plan.due_date is not None
        and plan.start_date > plan.due_date
    ):
        raise _invalid_input("dueDate")


async def _apply_plan(
    session: AsyncSession, *, account_id: int, task_id: int, plan: _Plan
) -> None:
    """계획 기간 → `schedule` 파생. **원본 쓰기와 같은 트랜잭션**이다(C-2 · §3-4).

    **겹침 검사를 부르지 않는다** — 업무의 배치는 항상 종일이라 검사 대상이 아니다(C-6).
    검사 자체는 `schedule_service` 에 그대로 있고 회의가 쓴다.
    """
    await schedule_service.sync_from_task(
        session,
        account_id=account_id,
        task_id=task_id,
        start_date=plan.start_date,
        due_date=plan.due_date,
    )


# --- 생성 ---------------------------------------------------------------


async def create_task(
    session: AsyncSession, *, account_id: int, command: TaskCreateDTO
) -> TaskDetailDTO:
    """생성은 **한 트랜잭션**이다 — 자식이 절반만 남는 상태를 만들지 않는다(§5).

    순서: 검증 → 본체 → 자식 → 로그 → 일정 파생.
    """
    await _require_usable_work_type(
        session, account_id=account_id, work_type_id=command.work_type_id
    )
    await _require_usable_project(
        session, account_id=account_id, project_id=command.project_id
    )

    plan = _Plan(command.start_date, command.due_date)
    _validate_plan(plan)
    for attachment in command.attachments:
        _validate_attachment(attachment)
    relation_ids = await _resolve_relation_targets(
        session, account_id=account_id, task_id=None, target_ids=command.related_task_ids
    )

    task_id = await task_repository.create(
        session,
        account_id=account_id,
        work_type_id=command.work_type_id,
        title=command.title,
        project_id=command.project_id,
        start_date=plan.start_date,
        due_date=plan.due_date,
        description=command.description,
    )

    for order_index, todo in enumerate(command.todos):
        await task_child_repository.create_todo(
            session,
            task_id=task_id,
            text=todo.text,
            due_date=todo.due_date,
            order_index=order_index,
        )

    for attachment in command.attachments:
        await task_child_repository.create_attachment(
            session,
            task_id=task_id,
            role=attachment.role,
            kind=attachment.kind,
            document_id=None,
            url=attachment.url,
            label=attachment.label,
        )

    if relation_ids:
        await task_child_repository.create_relations(
            session, task_id=task_id, other_ids=relation_ids
        )

    await task_child_repository.create_log(session, task_id=task_id, text="업무 생성")
    await _apply_plan(session, account_id=account_id, task_id=task_id, plan=plan)

    task = await task_repository.find_active(
        session, account_id=account_id, task_id=task_id
    )
    assert task is not None  # 방금 만든 행이다
    return await _build_detail(session, task)


# --- 부분 수정 -----------------------------------------------------------


async def update_task(
    session: AsyncSession, *, account_id: int, task_id: int, command: TaskUpdateDTO
) -> TaskDetailDTO:
    """보낸 필드만 바꾼다(§5).

    **인라인 편집은 로그에 남지 않는다**(04-task-detail) — 이 함수는 로그를 쓰지 않는다.
    계획 기간이 바뀌면 `schedule` 파생이 **같은 트랜잭션**에서 따라간다(C-2).
    """
    current = await _require_task(session, account_id=account_id, task_id=task_id)

    if command.work_type_id is not UNSET:
        await _require_usable_work_type(
            session, account_id=account_id, work_type_id=command.work_type_id
        )
    if command.project_id is not UNSET:
        await _require_usable_project(
            session, account_id=account_id, project_id=command.project_id
        )

    plan = _resolve_plan(current, command)
    _validate_plan(plan)

    plan_changed = (plan.start_date, plan.due_date) != (
        current.start_date,
        current.due_date,
    )

    values = _changed_columns(command, plan, plan_changed)
    if values:
        await task_repository.update_fields(
            session, account_id=account_id, task_id=task_id, values=values
        )
    if plan_changed:
        await _apply_plan(session, account_id=account_id, task_id=task_id, plan=plan)

    task = await _require_task(session, account_id=account_id, task_id=task_id)
    return await _build_detail(session, task)


def _resolve_plan(current: TaskDTO, command: TaskUpdateDTO) -> _Plan:
    """현재 값 위에 보낸 필드만 얹어 **최종 계획 기간**을 만든다.

    `startDate` 와 `dueDate` 는 **서로 독립이다** — 한쪽을 지워도 다른 쪽은 남는다
    (T-1 「한쪽만 있어도 된다」). 기한만 지운 업무는 시작일 하루의 종일 일정이 된다.
    """
    return _Plan(
        current.start_date if command.start_date is UNSET else command.start_date,
        current.due_date if command.due_date is UNSET else command.due_date,
    )


def _changed_columns(
    command: TaskUpdateDTO, plan: _Plan, plan_changed: bool
) -> dict[str, object]:
    values: dict[str, object] = {}

    for field_name, column in (
        ("title", "title"),
        ("work_type_id", "work_type_id"),
        ("project_id", "project_id"),
        ("description", "description"),
        ("completion_result", "completion_result"),
    ):
        value = getattr(command, field_name)
        if value is not UNSET:
            values[column] = value

    if plan_changed:
        values["start_date"] = plan.start_date
        values["due_date"] = plan.due_date

    return values


# --- 할일 ---------------------------------------------------------------


async def add_todo(
    session: AsyncSession, *, account_id: int, task_id: int, command: TodoCreateDTO
) -> TaskDetailDTO:
    """**갱신된 상세를 돌려준다** — 자식 쓰기 표면 넷이 전부 같다(SPEC-003 §4, 2026-09-06 확정).

    부분 응답을 주면 `todoProgress` 같은 파생값을 **화면이 다시 조립**해야 하고
    그 조립 규칙이 화면마다 갈린다.
    """
    task = await _require_task(session, account_id=account_id, task_id=task_id)
    order_index = await task_child_repository.next_todo_order_index(session, task_id)
    await task_child_repository.create_todo(
        session,
        task_id=task_id,
        text=command.text,
        due_date=command.due_date,
        order_index=order_index,
    )
    return await _build_detail(session, task)


async def update_todo(
    session: AsyncSession,
    *,
    account_id: int,
    task_id: int,
    todo_id: int,
    command: TodoUpdateDTO,
) -> TaskDetailDTO:
    """T-8 — **완료로 바뀌면 같은 트랜잭션에서 로그 한 줄**을 남긴다.

    되돌리면(완료 → 미완료) 진행률만 내려가고 **로그는 지워지지 않는다**(로그는 사실의 기록이다).

    **갱신된 상세를 돌려준다**(SPEC-003 §4) — 진행률과 로그가 같이 바뀌므로 부분 응답이면
    화면이 나머지를 다시 조립해야 한다.
    """
    task = await _require_task(session, account_id=account_id, task_id=task_id)

    current = await task_child_repository.find_todo(
        session, task_id=task_id, todo_id=todo_id
    )
    if current is None:
        raise _not_found()

    values: dict[str, object] = {}
    if command.text is not UNSET:
        values["content"] = command.text
    if command.done is not UNSET:
        values["done"] = command.done
    if command.due_date is not UNSET:
        values["due_date"] = command.due_date

    if not values:
        return await _build_detail(session, task)

    await task_child_repository.update_todo(
        session, task_id=task_id, todo_id=todo_id, values=values
    )

    became_done = command.done is not UNSET and command.done and not current.done
    if became_done:
        await task_child_repository.create_log(
            session, task_id=task_id, text="할일 1건 완료"
        )

    return await _build_detail(session, task)


async def remove_todo(
    session: AsyncSession, *, account_id: int, task_id: int, todo_id: int
) -> None:
    await _require_task(session, account_id=account_id, task_id=task_id)
    if (
        await task_child_repository.find_todo(session, task_id=task_id, todo_id=todo_id)
        is None
    ):
        raise _not_found()
    await task_child_repository.delete_todo(session, task_id=task_id, todo_id=todo_id)


# --- 메모 ---------------------------------------------------------------


async def add_memo(
    session: AsyncSession, *, account_id: int, task_id: int, text: str
) -> TaskDetailDTO:
    """메모는 **로그가 아니다** — 등록해도 `task_log` 가 늘지 않는다(DEC-002 §6).

    **수정·삭제 표면을 만들지 않는다**(SPEC-003 S003-OQ-4).
    """
    task = await _require_task(session, account_id=account_id, task_id=task_id)
    await task_child_repository.create_memo(session, task_id=task_id, text=text)
    return await _build_detail(session, task)


# --- 첨부 ---------------------------------------------------------------


async def add_attachment(
    session: AsyncSession, *, account_id: int, task_id: int, command: AttachmentCreateDTO
) -> TaskDetailDTO:
    """T-8 — 첨부는 로그를 남긴다. 문구는 `role` 로 갈린다(U-7)."""
    task = await _require_task(session, account_id=account_id, task_id=task_id)
    _validate_attachment(command)

    await task_child_repository.create_attachment(
        session,
        task_id=task_id,
        role=command.role,
        kind=command.kind,
        document_id=None,
        url=command.url,
        label=command.label,
    )
    await task_child_repository.create_log(
        session, task_id=task_id, text=f"{_role_label(command.role)} 1건 첨부"
    )
    return await _build_detail(session, task)


def _role_label(role: str) -> str:
    return "참고자료" if role == "reference" else "결과자료"


async def remove_attachment(
    session: AsyncSession, *, account_id: int, task_id: int, attachment_id: int
) -> None:
    await _require_task(session, account_id=account_id, task_id=task_id)
    if (
        await task_child_repository.find_attachment(
            session, task_id=task_id, attachment_id=attachment_id
        )
        is None
    ):
        raise _not_found()
    await task_child_repository.delete_attachment(
        session, task_id=task_id, attachment_id=attachment_id
    )


# --- 연관업무 -----------------------------------------------------------


async def link_relations(
    session: AsyncSession, *, account_id: int, task_id: int, target_ids: list[int]
) -> TaskDetailDTO:
    """T-10 — 무방향 1행. **중복 재전송이 행을 늘리지 않는다.**

    새로 생긴 연결이 있을 때만 로그를 남긴다.
    """
    task = await _require_task(session, account_id=account_id, task_id=task_id)
    resolved = await _resolve_relation_targets(
        session, account_id=account_id, task_id=task_id, target_ids=target_ids
    )

    created = await task_child_repository.create_relations(
        session, task_id=task_id, other_ids=resolved
    )
    if created:
        await task_child_repository.create_log(
            session, task_id=task_id, text=f"연관업무 {created}건 연결"
        )

    return await _build_detail(session, task)


async def unlink_relation(
    session: AsyncSession, *, account_id: int, task_id: int, other_task_id: int
) -> None:
    """해제는 로그를 남기지 않는다 — DEC-002 §6 의 로그 대상은 **연결**이다.

    **없는 연관을 지우면 404** 다 — 할일·첨부와 같다(SPEC-003 §4, 2026-09-06 확정).
    멱등 삭제로 두지 않는다: 지우려는 것이 이미 없다는 건 **화면이 낡았다는 뜻**이고,
    조용히 204 를 주면 그 사실이 묻힌다.
    """
    await _require_task(session, account_id=account_id, task_id=task_id)

    linked = await task_child_repository.list_related_ids(session, task_id)
    if other_task_id not in linked:
        raise _not_found()

    await task_child_repository.delete_relation(
        session, task_id=task_id, other_task_id=other_task_id
    )


async def list_relation_candidates(
    session: AsyncSession,
    *,
    account_id: int,
    keyword: str | None = None,
    exclude_id: int | None = None,
    project_id: int | None = None,
    due_date: date | None = None,
    scope: RelationCandidateScope = RelationCandidateScope.PROJECT,
) -> tuple[list[TaskDTO], int]:
    """SPEC-003 U-8 · §4(2026-09-06 개정) — **업무에 매달리지 않는 컬렉션 표면**이다.

    U-1 이 **생성 드로어에도** 「업무 연결」을 두는데 그 시점에는 **자기 id 가 없다** —
    그래서 정렬 근거를 쿼리로 받고, 뺄 대상도 쿼리로 받는다.

    - `exclude_id` 없음(생성 드로어) — 뺄 것이 없고, **폼에 입력 중인** `project_id`·`due_date` 로 정렬한다
    - `exclude_id` 있음(상세 드로어) — 그 업무와 **이미 연결된 것도 함께 빠지고**,
      정렬 근거는 **그 업무의 값이 쿼리 값을 이긴다**(화면이 두 번 보내지 않아도 된다)

    `scope` 는 **자르는 필터**다(칩 3 과 1:1) — 정렬 근거인 `project_id`·`due_date` 와 역할이 다르다.
    돌려주는 것은 `(상위 20건, scope 적용 후 총계)` 다. **총계는 `len(items)` 가 아니다.**

    검색어가 없어도 기본 정렬로 최대 20건을 준다. 삭제된 업무는 처음부터 조회에서 빠진다.
    """
    exclude_ids: set[int] = set()

    if exclude_id is not None:
        # 남의 업무·없는 업무면 404 다 — 존재를 흘리지 않는다(§5 · §9).
        task = await _require_task(session, account_id=account_id, task_id=exclude_id)
        project_id = None if task.project is None else task.project.id
        due_date = task.due_date
        exclude_ids = await task_child_repository.list_related_ids(session, exclude_id)
        exclude_ids.add(exclude_id)

    scope_project_id, updated_after = _resolve_scope(scope, project_id)

    total = await task_repository.count_relation_candidates(
        session,
        account_id=account_id,
        exclude_ids=exclude_ids,
        keyword=keyword,
        scope_project_id=scope_project_id,
        updated_after=updated_after,
    )
    items = await task_repository.find_relation_candidates(
        session,
        account_id=account_id,
        project_id=project_id,
        due_date=due_date,
        exclude_ids=exclude_ids,
        keyword=keyword,
        scope_project_id=scope_project_id,
        updated_after=updated_after,
        limit=_RELATION_CANDIDATE_LIMIT,
    )
    return items, total


def _resolve_scope(
    scope: RelationCandidateScope, project_id: int | None
) -> tuple[int | None, datetime | None]:
    """`scope` 를 repository 가 아는 두 축(프로젝트 · 최근 수정)으로 푼다.

    **기준 프로젝트가 없는데 `scope=project` 면 `all` 과 같게 답한다** — 빈 목록을 주지 않는다.
    무소속 업무이거나 생성 드로어에서 프로젝트를 아직 안 고른 **정상 경로**이고,
    고를 게 없는 팝오버가 뜨는 것이 더 나쁘다. **SPEC-003 §4 가 명시한 동작이지
    조용한 폴백이 아니다** — 그쪽 화면에서는 「이 프로젝트」 칩이 비활성이고 기본이 「전체」로 내려간다.
    """
    if scope is RelationCandidateScope.PROJECT:
        return project_id, None
    if scope is RelationCandidateScope.RECENT30:
        return None, datetime.now(UTC) - timedelta(days=_RECENT_SCOPE_DAYS)
    return None, None


# --- 상태 전이 (SPEC-004) -------------------------------------------------
#
# **이 제품의 규칙이 여기 있다.** 리스트 셀·상세 드롭다운·칸반 DnD·(WORK-008 의) 회의록이
# 전부 `PATCH /api/tasks/{id}/status` 하나로 들어와 `change_status()` 하나가 판정한다.
# 여기서 판정을 한 곳에 못 모으면 이후 세 화면과 회의록이 각자 규칙을 갖는다.

# T-6 전이 그래프. **`done → cancelled` 가 없다** — 먼저 진행중으로 되돌려야 한다(DEC-002 §4).
_TRANSITIONS: dict[str, frozenset[str]] = {
    TaskStatus.TODO.value: frozenset(
        {TaskStatus.IN_PROGRESS.value, TaskStatus.DONE.value, TaskStatus.CANCELLED.value}
    ),
    TaskStatus.IN_PROGRESS.value: frozenset(
        {TaskStatus.DONE.value, TaskStatus.TODO.value, TaskStatus.CANCELLED.value}
    ),
    TaskStatus.DONE.value: frozenset({TaskStatus.IN_PROGRESS.value}),
    TaskStatus.CANCELLED.value: frozenset({TaskStatus.TODO.value}),
}

# 로그 본문의 한국어 라벨 — 저장 값은 영문이고 이것은 **표시 매핑**이다(G-4)
_STATUS_LABELS = {
    TaskStatus.TODO.value: "시작전",
    TaskStatus.IN_PROGRESS.value: "진행중",
    TaskStatus.DONE.value: "완료",
    TaskStatus.CANCELLED.value: "취소",
}

# SPEC-004 §4 Case Matrix — 문구까지 계약이다.
_COMPLETION_BLOCKED = "완료하려면 결과자료 1건 또는 완료 결과가 필요합니다"
_INVALID_TRANSITION = "이 상태로는 바꿀 수 없습니다"
_UNDO_NOT_AVAILABLE = "되돌릴 수 있는 시간이 지났습니다"
# 취소 거부는 **시간과 무관**하다 — 만료와 문구를 나눈다(Case Matrix, 2026-09-06 신설)
_CANCEL_UNDO_NOT_ALLOWED = "취소는 실행취소로 되돌릴 수 없습니다"

_CANCEL_REASON_MAX = 500
# 완료 토스트 수명과 맞춘 spec 값이다(SPEC-004 §4 · BE §8-2)
_UNDO_WINDOW = timedelta(seconds=4)


async def _passes_completion_gate(session: AsyncSession, task: TaskDTO) -> bool:
    """T-5 완료 게이트 — **결과자료 ≥1 또는 완료 결과가 비어 있지 않다.**

    **판정은 이 함수 하나뿐이다.** 화면이 먼저 막아도 이 검사는 그대로 돈다(SPEC-004 §5).
    """
    if task.completion_result is not None and task.completion_result.strip():
        return True
    return await task_child_repository.count_deliverables(session, task.id) >= 1


def _validate_cancel_reason(target: str, cancel_reason: str | None) -> str | None:
    """T-7 — `cancel_reason` 은 취소로 갈 때만 받는다. 다른 상태에 얹어 보내면 거부한다."""
    if target != TaskStatus.CANCELLED.value:
        if cancel_reason is not None:
            raise _invalid_input("cancelReason")
        return None

    if cancel_reason is None or not cancel_reason.strip():
        raise _invalid_input("cancelReason")
    reason = cancel_reason.strip()
    if len(reason) > _CANCEL_REASON_MAX:
        raise _invalid_input("cancelReason")
    return reason


async def change_status(
    session: AsyncSession, *, account_id: int, task_id: int, command: StatusChangeDTO
) -> TaskListItemDTO:
    """**전이 그래프 검사 → 완료 게이트 판정 → 상태 쓰기 + 로그 한 줄**(한 트랜잭션 — T-8).

    거부되면 **행이 바뀌지 않고 로그도 남지 않는다** — 예외가 요청 트랜잭션을 되돌린다.
    `persist_changes` 를 켜지 않는 이유가 이것이다(BE §7): 여기서 실패는 쓰기를 뜻하지 않는다.
    """
    task = await _require_task(session, account_id=account_id, task_id=task_id)
    target = command.status

    if target not in _TRANSITIONS[task.status]:
        raise InvalidStatusTransitionError(_INVALID_TRANSITION)

    reason = _validate_cancel_reason(target, command.cancel_reason)

    if target == TaskStatus.DONE.value and not await _passes_completion_gate(session, task):
        raise TaskCompletionBlockedError(_COMPLETION_BLOCKED)

    await task_repository.update_status(
        session,
        account_id=account_id,
        task_id=task_id,
        status=target,
        cancel_reason=reason,
    )
    await task_child_repository.create_log(
        session,
        task_id=task_id,
        text=f"상태 {_STATUS_LABELS[task.status]} → {_STATUS_LABELS[target]}",
        from_status=task.status,
        to_status=target,
    )
    # T-1-c — **실적 컬럼은 전이 로그와 같은 트랜잭션에서** 쓰인다. 로그를 쓴 **직후**에 부른다:
    # 컬럼이 로그의 파생이라 순서가 뒤집히면 방금 생긴 전이가 빠진 값을 쓰게 된다.
    await task_repository.sync_actuals(
        session, account_id=account_id, task_id=task_id
    )

    # DEC-002 §6 — 기본 켜짐. 이 줄이 마지막 로그가 되므로 **취소는 실행취소 대상이 아니게 된다**
    # (취소는 모달을 지나는 신중한 조작이고, 완료는 한 번의 클릭이라 되돌릴 자리를 준다).
    if target == TaskStatus.CANCELLED.value and command.log_cancel_reason:
        await task_child_repository.create_log(
            session, task_id=task_id, text="취소 사유 기록"
        )

    return await _require_list_item(session, account_id=account_id, task_id=task_id)


async def undo_last_status(
    session: AsyncSession, *, account_id: int, task_id: int
) -> TaskListItemDTO:
    """마지막 전이를 되돌리고 **그 로그를 지운다**(한 트랜잭션).

    조건 넷 — ① 마지막 로그가 상태 전이이고 ② 그 뒤 다른 (로그를 남기는) 변경이 없으며
    ③ **4초 이내**이고 ④ **취소 전이가 아니다.** 하나라도 어긋나면 `undo_not_available`.

    **게이트를 다시 태우지 않는다** — 이미 판정을 지난 상태로 되돌리는 것이라
    「완료 → 진행중」 복원에 결과자료를 요구할 이유가 없다.

    ④ **실행취소는 완료 전용이다**(SPEC-004 — 완료 토스트에만 「실행취소」가 붙고,
    시안에 「취소 직후 토스트」 화면이 없다). 취소는 모달 + 사유를 지나는 신중한 조작이라
    되돌릴 자리를 주지 않았다. 되살리려면 **상태 팝오버에서 직접 고른다**(SPEC-004 L309).
    ④만 `cancel_undo_not_allowed` 이고 ①~③은 `undo_not_available` 이다 — **사유가 다르다.**

    **왜 「마지막 전이가 취소인가」가 아니라 「지금 취소 상태인가」로 보나** —
    전자로 짜면 `log_cancel_reason` 이 참일 때 **④에 닿지 못한다.** 사유 로그가 전이 로그
    뒤에 붙어 `find_last_transition` 이 먼저 `None` 을 주고, ①이 `undo_not_available` 을
    던져 버린다. 그러면 「사유를 남겼는지」가 **이번엔 에러 코드를 가르게** 되어
    없애려던 비일관이 자리만 옮긴다. 상태는 로그 순서와 무관하다.

    **두 판정은 같은 것을 가리킨다** — 상태를 바꾸는 경로가 전이뿐이라(`update_status` 를
    부르는 곳이 전이·실행취소 둘뿐이다) 「마지막 전이가 취소로 갔다」와 「지금 취소다」는
    같은 집합이다. 로그 순서에 흔들리지 않는 쪽을 골랐을 뿐이다.

    되살림(`cancelled → todo`)의 실행취소는 **막지 않는다** — 그 전이는 취소로 *가는* 것이
    아니고, 그 시점의 상태도 취소가 아니다.

    **이 규칙을 로그 순서에 기대지 않고 여기서 명시적으로 판정한다**(2026-09-06 코디 확정).
    전에는 부작용이었다 — `log_cancel_reason` 이 참이면 사유 로그가 전이 로그 **뒤에** 붙어
    ①에 걸려 막혔고, 끄면 통과했다. 「사유를 남겼는지」가 「되돌릴 수 있는지」를 정하는 것은
    **화면에서 설명할 수 없는 동작**이고, 로그 순서를 건드리는 날 조용히 뒤집힌다.
    """
    task = await _require_task(session, account_id=account_id, task_id=task_id)

    # ④ — **로그를 보기 전에 상태로 판정한다.** 이유는 아래 docstring 「왜 상태로 보나」 참조.
    # 만료(`undo_not_available`)와 **코드를 나눈다** — 시간이 지난 게 아니라 금지다.
    if task.status == TaskStatus.CANCELLED.value:
        raise CancelUndoNotAllowedError(_CANCEL_UNDO_NOT_ALLOWED)

    transition = await task_child_repository.find_last_transition(session, task_id)
    if transition is None:
        raise UndoNotAvailableError(_UNDO_NOT_AVAILABLE)
    if datetime.now(UTC) - transition.created_at > _UNDO_WINDOW:
        raise UndoNotAvailableError(_UNDO_NOT_AVAILABLE)

    await task_repository.update_status(
        session,
        account_id=account_id,
        task_id=task_id,
        status=transition.from_status,
        # 취소로 되돌아가는 경우 사유는 복원되지 않는다 — 떠날 때 T-7 이 비우게 했고
        # 우리는 옛 값을 보관하지 않는다(§미결).
        cancel_reason=None,
    )
    await task_child_repository.delete_log(
        session, task_id=task_id, log_id=transition.log_id
    )
    # **실적도 함께 되돌린다** — 로그만 지우고 컬럼을 남기면 「완료 취소했는데 완료 시각이 남은」
    # 업무가 생기고, R-4 가 그 값으로 거르므로 **오늘 완료 칸에 그대로 붙어 있게 된다.**
    # 지운 뒤의 로그를 다시 읽으므로 이전 완료 이력이 있으면 **그 시각이 정확히 살아난다.**
    await task_repository.sync_actuals(
        session, account_id=account_id, task_id=task_id
    )

    return await _require_list_item(session, account_id=account_id, task_id=task_id)


async def delete_task(session: AsyncSession, *, account_id: int, task_id: int) -> None:
    """T-11 소프트 딜리트 — 목록·집계에서 빠지고 **자식 행은 지우지 않는다.**

    **복원 경로를 만들지 않는다**(DEC-004 §4).
    """
    await _require_task(session, account_id=account_id, task_id=task_id)
    await task_repository.soft_delete(
        session, account_id=account_id, task_id=task_id, deleted_at=datetime.now(UTC)
    )


async def _require_list_item(
    session: AsyncSession, *, account_id: int, task_id: int
) -> TaskListItemDTO:
    item = await task_repository.find_list_item(
        session, account_id=account_id, task_id=task_id, today=_today()
    )
    if item is None:
        raise _not_found()
    return item


# --- 목록 (SPEC-004 §4) --------------------------------------------------


def default_period_bounds() -> tuple[datetime, datetime]:
    """**기본 기간은 「오늘 하루」다**(DEC-002 §「조회 단위 전환 — 월 → 일」, 2026-09-06 확정).

    「내 업무」는 오늘 업무다 — 들어가면 이번 달이 아니라 오늘 기준으로 뜬다.
    두 값이 **같은 순간**인 것이 정상이다: 조회 규칙은 이 둘을 KST 날짜로 떨어뜨려 쓰고
    **끝 경계가 닫혀 있어**(`<= to`) `from = to = 오늘` 이 오늘 하루를 뜻한다.
    """
    tz = ZoneInfo(get_settings().app_timezone)
    today = datetime.now(tz).date()
    start_of_today = datetime.combine(today, time.min, tzinfo=tz).astimezone(UTC)
    return start_of_today, start_of_today


async def list_tasks(
    session: AsyncSession, *, account_id: int, command: TaskListFilterDTO
) -> TaskListResultDTO:
    """리스트와 칸반이 **같은 응답**을 본다 — 칸반은 이 목록을 상태로 나눠 그릴 뿐이다.

    `typeCounts` 는 **유형 탭 자신을 반영하지 않는다**(SPEC-004 §4) —
    탭에 붙는 수가 탭을 누를 때마다 흔들리면 안 된다.
    """
    tz = ZoneInfo(get_settings().app_timezone)
    # **`from`·`to` 는 순간으로 오지만 뜻은 날짜다**(G-2-e — 계획은 달력 개념이다).
    # 앱 타임존으로 떨어뜨린 뒤 **양끝을 포함**해서 쓴다.
    from_date = command.period_from.astimezone(tz).date()
    to_date = command.period_to.astimezone(tz).date()
    bounds = {
        "from_date": from_date,
        "to_date": to_date,
        # 같은 날짜 범위를 **순간**으로 옮긴 것 — R-4(실적 시각)가 쓴다.
        # 끝은 `to_date` **다음 날 `00:00`**(KST)이라 반열림이지만 날짜로는 닫혀 있다.
        "moment_from": datetime.combine(from_date, time.min, tzinfo=tz),
        "moment_to": datetime.combine(to_date + timedelta(days=1), time.min, tzinfo=tz),
    }

    items = await task_repository.list_tasks(
        session,
        account_id=account_id,
        **bounds,
        work_type_id=command.work_type_id,
        status=command.status,
        project_id=command.project_id,
        sort=command.sort,
        page=command.page,
        size=command.size,
        today=_today(),
    )
    total = await task_repository.count_tasks(
        session,
        account_id=account_id,
        **bounds,
        work_type_id=command.work_type_id,
        status=command.status,
        project_id=command.project_id,
    )
    by_type = await task_repository.count_by_work_type(
        session,
        account_id=account_id,
        **bounds,
        status=command.status,
        project_id=command.project_id,
    )
    # 상태 축만 뺀 집계 — 상태 필터를 걸어도 칸반의 네 컬럼 수가 흔들리지 않는다
    by_status = await task_repository.count_by_status(
        session,
        account_id=account_id,
        **bounds,
        work_type_id=command.work_type_id,
        project_id=command.project_id,
    )
    # U-9 「필터를 지우면 n건이 보입니다」 — **기간만** 남기고 셋 다 뺀다
    unfiltered_total = await task_repository.count_tasks(
        session,
        account_id=account_id,
        **bounds,
        work_type_id=None,
        status=None,
        project_id=None,
    )

    type_counts = [
        TypeCountDTO(work_type_id=None, name="전체", count=sum(row[2] for row in by_type)),
        *[
            TypeCountDTO(work_type_id=row[0], name=row[1], count=row[2])
            for row in by_type
        ],
    ]
    return TaskListResultDTO(
        items=items,
        total=total,
        page=command.page,
        size=command.size,
        type_counts=type_counts,
        # **네 키를 항상 담는다** — 0건 상태도 0 이다(칸반 컬럼이 항상 넷이다)
        status_counts=StatusCountsDTO(
            todo=by_status.get(TaskStatus.TODO.value, 0),
            in_progress=by_status.get(TaskStatus.IN_PROGRESS.value, 0),
            done=by_status.get(TaskStatus.DONE.value, 0),
            cancelled=by_status.get(TaskStatus.CANCELLED.value, 0),
        ),
        unfiltered_total=unfiltered_total,
    )
