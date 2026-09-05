"""2층 — 업무 도메인 규칙. `fastapi` 도 `schemas/` 도 import 하지 않는다.

정본: SPEC-003 §4 Case Matrix(에러) · §5(규칙) · `domains/task.md` T-1~T-11.

**로그를 쓰는 곳은 이 파일 하나다**(T-8 · WP Internal Interface Contract).
대상은 **생성·할일 완료·첨부·연관 연결**뿐이고,
**제목·배경·목표·완료 결과 인라인 편집은 대상이 아니다**(04-task-detail).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from core.exceptions import (
    InvalidStatusTransitionError,
    NotFoundError,
    TaskCompletionBlockedError,
    UndoNotAvailableError,
    ValidationError,
)
from dto.enums import (
    AttachmentKind,
    RelationCandidateScope,
    ScheduleSourceType,
    TaskStatus,
)
from dto.task import (
    AttachmentCreateDTO,
    StatusChangeDTO,
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


def _invalid_input() -> ValidationError:
    return ValidationError(_INVALID_INPUT)


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
        is_overdue=(
            task.due_date is not None
            and task.due_date < today
            and task.status not in (TaskStatus.DONE.value, TaskStatus.CANCELLED.value)
        ),
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
        raise ValidationError(_INVALID_WORK_TYPE, code="invalid_work_type")


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
        raise ValidationError(_INVALID_PROJECT, code="invalid_project")


def _validate_attachment(attachment: AttachmentCreateDTO) -> None:
    """T-9 · T-9-a — `kind` 별로 채워지는 값이 갈린다.

    **`doc` 은 이 work 에서 거부한다** — 대상 `document` 테이블이 아직 없어
    가리킬 수 있는 문서가 존재하지 않는다(WORK-004 §Open Issues 의 임시 계약).
    문서함 work 가 FK 리비전과 함께 이 갈래를 실체화한다.
    """
    if attachment.kind == AttachmentKind.DOC.value:
        raise _invalid_input()

    if attachment.url is None:
        raise _invalid_input()

    # `http`/`https` 만(SPEC-003 §4 Validation). `ftp://…` 는 거부한다.
    parsed = urlparse(attachment.url)
    if parsed.scheme not in _ALLOWED_URL_SCHEMES or not parsed.netloc:
        raise _invalid_input()

    if attachment.document_id is not None:
        raise _invalid_input()


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
        raise _invalid_input()

    usable = await task_repository.exists_active(
        session, account_id=account_id, task_ids=unique_ids
    )
    if len(usable) != len(unique_ids):
        raise _invalid_input()

    return unique_ids


# --- 기한 · 일정 ---------------------------------------------------------


@dataclass(frozen=True)
class _Due:
    date: date | None
    start: time | None
    end: time | None


def _validate_due(due: _Due) -> None:
    """T-1-b — 시각 두 개는 함께 있거나 함께 없고, 있으면 기한 날짜가 있어야 하며 `end > start`.

    DB CHECK 가 최종 방어선이지만 **여기서 먼저 잡아 계약대로 `422`** 로 낸다.
    """
    if (due.start is None) != (due.end is None):
        raise _invalid_input()
    if due.start is not None and due.date is None:
        raise _invalid_input()
    if due.start is not None and due.end is not None and due.end <= due.start:
        raise _invalid_input()


async def _apply_due(
    session: AsyncSession, *, account_id: int, task_id: int, due: _Due
) -> None:
    """기한 → `schedule` 파생. **원본 쓰기와 같은 트랜잭션**이다(C-2 · §3-4)."""
    await schedule_service.sync_from_task(
        session,
        account_id=account_id,
        task_id=task_id,
        due_date=due.date,
        due_start_time=due.start,
        due_end_time=due.end,
    )


# --- 생성 ---------------------------------------------------------------


async def create_task(
    session: AsyncSession, *, account_id: int, command: TaskCreateDTO
) -> TaskDetailDTO:
    """생성은 **한 트랜잭션**이다 — 자식이 절반만 남는 상태를 만들지 않는다(§5).

    순서: 검증 → **겹침 검사(원본 쓰기 전)** → 본체 → 자식 → 로그 → 일정 파생.
    """
    await _require_usable_work_type(
        session, account_id=account_id, work_type_id=command.work_type_id
    )
    await _require_usable_project(
        session, account_id=account_id, project_id=command.project_id
    )

    due = _Due(command.due_date, command.due_start_time, command.due_end_time)
    _validate_due(due)
    for attachment in command.attachments:
        _validate_attachment(attachment)
    relation_ids = await _resolve_relation_targets(
        session, account_id=account_id, task_id=None, target_ids=command.related_task_ids
    )

    # C-9 — 걸리면 원본도 만들어지지 않는다
    await schedule_service.check_overlap(
        session,
        account_id=account_id,
        placement=schedule_service.build_placement(due.date, due.start, due.end),
    )

    task_id = await task_repository.create(
        session,
        account_id=account_id,
        work_type_id=command.work_type_id,
        title=command.title,
        project_id=command.project_id,
        due_date=due.date,
        due_start_time=due.start,
        due_end_time=due.end,
        background=command.background,
        goal=command.goal,
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
    await _apply_due(session, account_id=account_id, task_id=task_id, due=due)

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
    기한이 바뀌면 겹침 검사가 **원본을 쓰기 전에** 돌고, 걸리면 원본도 바뀌지 않는다(C-9).
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

    _reject_times_without_a_date(current, command)
    due = _resolve_due(current, command)
    _validate_due(due)

    due_changed = (due.date, due.start, due.end) != (
        current.due_date,
        current.due_start_time,
        current.due_end_time,
    )
    if due_changed:
        await schedule_service.check_overlap(
            session,
            account_id=account_id,
            placement=schedule_service.build_placement(due.date, due.start, due.end),
            exclude_source_type=ScheduleSourceType.TASK.value,
            exclude_source_id=task_id,
        )

    values = _changed_columns(command, due, due_changed)
    if values:
        await task_repository.update_fields(
            session, account_id=account_id, task_id=task_id, values=values
        )
    if due_changed:
        await _apply_due(session, account_id=account_id, task_id=task_id, due=due)

    task = await _require_task(session, account_id=account_id, task_id=task_id)
    return await _build_detail(session, task)


def _reject_times_without_a_date(current: TaskDTO, command: TaskUpdateDTO) -> None:
    """**요청 자체**를 본다 — 시각을 보냈는데 최종 기한 날짜가 없으면 `422`(§4 Validation · T-1-b).

    `_resolve_due` 는 기한 날짜가 없으면 `_Due(None, None, None)` 으로 **접어 버리기** 때문에,
    그 뒤에 오는 `_validate_due` 는 **접힌 결과**를 보고 통과시킨다 → 아무것도 안 바뀐 채 200.
    「실패가 안 보이는」 종류라 접기 **전에** 잡는다(WORK-004 검수 W-1).

    보낸 시각이 `null` 인 것은 **시각만 지우는 정상 경로**라 여기 걸리지 않는다.
    """
    sent_times = [
        value
        for value in (command.due_start_time, command.due_end_time)
        if value is not UNSET and value is not None
    ]
    if not sent_times:
        return

    final_due_date = current.due_date if command.due_date is UNSET else command.due_date
    if final_due_date is None:
        raise _invalid_input()


def _resolve_due(current: TaskDTO, command: TaskUpdateDTO) -> _Due:
    """현재 값 위에 보낸 필드만 얹어 **최종 기한**을 만든다.

    `dueDate: null` 은 기한 삭제다 — **시각도 함께 사라진다**(T-1-b 가 시각만 남는 상태를
    허용하지 않는다). 시각을 따로 지우려면 `dueStartTime`/`dueEndTime` 을 `null` 로 보낸다.
    """
    due_date = current.due_date if command.due_date is UNSET else command.due_date
    if due_date is None:
        return _Due(None, None, None)

    return _Due(
        due_date,
        current.due_start_time if command.due_start_time is UNSET else command.due_start_time,
        current.due_end_time if command.due_end_time is UNSET else command.due_end_time,
    )


def _changed_columns(
    command: TaskUpdateDTO, due: _Due, due_changed: bool
) -> dict[str, object]:
    values: dict[str, object] = {}

    for field_name, column in (
        ("title", "title"),
        ("work_type_id", "work_type_id"),
        ("project_id", "project_id"),
        ("background", "background"),
        ("goal", "goal"),
        ("completion_result", "completion_result"),
    ):
        value = getattr(command, field_name)
        if value is not UNSET:
            values[column] = value

    if due_changed:
        values["due_date"] = due.date
        values["due_start_time"] = due.start
        values["due_end_time"] = due.end

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
            raise _invalid_input()
        return None

    if cancel_reason is None or not cancel_reason.strip():
        raise _invalid_input()
    reason = cancel_reason.strip()
    if len(reason) > _CANCEL_REASON_MAX:
        raise _invalid_input()
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

    조건 셋 — ① 마지막 로그가 상태 전이이고 ② 그 뒤 다른 (로그를 남기는) 변경이 없으며
    ③ **4초 이내**다(SPEC-004 §4). 하나라도 어긋나면 `undo_not_available`.

    **게이트를 다시 태우지 않는다** — 이미 판정을 지난 상태로 되돌리는 것이라
    「완료 → 진행중」 복원에 결과자료를 요구할 이유가 없다.
    """
    await _require_task(session, account_id=account_id, task_id=task_id)

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


def current_month_bounds() -> tuple[datetime, datetime]:
    """기본 기간은 **이번 달**이다. 경계는 앱 타임존(KST)의 달 경계를 UTC 순간으로 준다(G-2)."""
    tz = ZoneInfo(get_settings().app_timezone)
    today = datetime.now(tz).date()
    start = datetime(today.year, today.month, 1, tzinfo=tz)
    end = datetime(
        today.year + (today.month // 12), (today.month % 12) + 1, 1, tzinfo=tz
    )
    return start.astimezone(UTC), end.astimezone(UTC)


async def list_tasks(
    session: AsyncSession, *, account_id: int, command: TaskListFilterDTO
) -> TaskListResultDTO:
    """리스트와 칸반이 **같은 응답**을 본다 — 칸반은 이 목록을 상태로 나눠 그릴 뿐이다.

    `typeCounts` 는 **유형 탭 자신을 반영하지 않는다**(SPEC-004 §4) —
    탭에 붙는 수가 탭을 누를 때마다 흔들리면 안 된다.
    """
    tz = ZoneInfo(get_settings().app_timezone)
    # 기한은 달력 날짜라 KST 로, 생성일은 순간이라 UTC 로 비교한다(G-2 · G-2-e)
    from_date = command.period_from.astimezone(tz).date()
    to_date = command.period_to.astimezone(tz).date()
    bounds = {
        "from_date": from_date,
        "to_date": to_date,
        "period_from": command.period_from,
        "period_to": command.period_to,
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
    )
