"""업무 도메인의 내부 계층 이동용 dto — 프론트 계약이 아니다(§3).

**입력도 dto 다**(§3 규칙 3). 부분 수정은 `T | Unset` 로 「보내지 않음」과
「`null` 로 지움」을 구분한다(§3 규칙 4) — 인라인 자동 저장이 필드 하나씩 오기 때문이다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time

from dto.unset import UNSET, Unset


@dataclass(frozen=True)
class WorkTypeRefDTO:
    """업무가 참조하는 유형의 표시 정보.

    **삭제된 유형도 이름·색을 그대로 담는다**(A-6) — `is_deleted` 로 알리고 숨기지 않는다.
    """

    id: int
    name: str
    kind: str
    color_token: str
    is_deleted: bool


@dataclass(frozen=True)
class ProjectRefDTO:
    id: int
    name: str
    color_token: str
    is_deleted: bool


@dataclass(frozen=True)
class TaskTodoDTO:
    id: int
    text: str
    done: bool
    due_date: date | None


@dataclass(frozen=True)
class TaskMemoDTO:
    id: int
    text: str
    created_at: datetime


@dataclass(frozen=True)
class TaskAttachmentDTO:
    """`role` × `kind` 두 축(T-9).

    `folder_path` 는 `kind='doc'` 의 표시값인데 **문서함이 아직 없어 항상 `None`** 이다
    (WORK-004 §Open Issues — `doc` 요청 자체를 거부한다).
    """

    id: int
    role: str
    kind: str
    name: str | None
    document_id: int | None
    folder_path: str | None
    url: str | None


@dataclass(frozen=True)
class TaskRelationDTO:
    id: int
    title: str
    status: str
    project_name: str | None
    due_date: date | None


@dataclass(frozen=True)
class TaskLogDTO:
    id: int
    text: str
    created_at: datetime


@dataclass(frozen=True)
class TodoProgressDTO:
    """진행률 — 파생값이다(G-7). 컬럼으로 두지 않는다."""

    done: int
    total: int


@dataclass(frozen=True)
class TaskDTO:
    """업무 본체 한 건. 자식은 담지 않는다."""

    id: int
    title: str
    status: str
    work_type: WorkTypeRefDTO
    project: ProjectRefDTO | None
    due_date: date | None
    due_start_time: time | None
    due_end_time: time | None
    background: str | None
    goal: str | None
    completion_result: str | None
    cancel_reason: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class TaskDetailDTO:
    """상세 — 본체 + 자식 + **파생값**.

    `d_day` · `is_overdue` · `todo_progress` 는 **서버가 계산해 내려준다**(G-7) —
    화면이 다시 계산하지 않는다.
    """

    task: TaskDTO
    todos: list[TaskTodoDTO]
    todo_progress: TodoProgressDTO
    memos: list[TaskMemoDTO]
    attachments: list[TaskAttachmentDTO]
    # 06-related-tasks — 상세에는 **최근 5건**만 싣고 전체 수는 `relation_total` 이다
    relations: list[TaskRelationDTO]
    relation_total: int
    logs: list[TaskLogDTO]
    d_day: int | None
    is_overdue: bool


# --- 입력 ---------------------------------------------------------------


@dataclass(frozen=True)
class TodoCreateDTO:
    text: str
    due_date: date | None = None


@dataclass(frozen=True)
class AttachmentCreateDTO:
    role: str
    kind: str
    document_id: int | None = None
    url: str | None = None
    label: str | None = None


@dataclass(frozen=True)
class TaskCreateDTO:
    """생성은 **한 요청**이다 — 자식이 본체와 같은 트랜잭션으로 저장된다(§5)."""

    title: str
    work_type_id: int
    project_id: int | None = None
    due_date: date | None = None
    due_start_time: time | None = None
    due_end_time: time | None = None
    background: str | None = None
    goal: str | None = None
    todos: list[TodoCreateDTO] = field(default_factory=list)
    attachments: list[AttachmentCreateDTO] = field(default_factory=list)
    related_task_ids: list[int] = field(default_factory=list)


@dataclass(frozen=True)
class TaskUpdateDTO:
    """**`status` 가 없다** — 상태 전이는 전용 엔드포인트이고 WORK-005 가 갖는다(§4).

    `due_date=None`(보냄)은 **기한 삭제**이고 파생 일정도 사라진다.
    `UNSET` 은 「보내지 않음」이라 그대로 둔다.
    """

    title: str | Unset = UNSET
    work_type_id: int | Unset = UNSET
    project_id: int | None | Unset = UNSET
    due_date: date | None | Unset = UNSET
    due_start_time: time | None | Unset = UNSET
    due_end_time: time | None | Unset = UNSET
    background: str | None | Unset = UNSET
    goal: str | None | Unset = UNSET
    completion_result: str | None | Unset = UNSET


@dataclass(frozen=True)
class TodoUpdateDTO:
    text: str | Unset = UNSET
    done: bool | Unset = UNSET
    due_date: date | None | Unset = UNSET


# --- 상태 전이 · 목록 (SPEC-004) -----------------------------------------


@dataclass(frozen=True)
class StatusChangeDTO:
    """상태 전이 요청. **세 진입점이 같은 것을 보낸다**(SPEC-004 §4).

    `cancel_reason` 은 `cancelled` 로 갈 때만 받는다(T-7).
    `log_cancel_reason` 기본 참 — 취소 사유를 로그에 남긴다(DEC-002 §6).
    """

    status: str
    cancel_reason: str | None = None
    log_cancel_reason: bool = True


@dataclass(frozen=True)
class StatusTransitionDTO:
    """`task_log` 의 상태 전이 한 줄. 실행취소가 이 값을 보고 판정한다.

    본문(한국어)이 아니라 **컬럼**으로 판정한다 — 문구가 바뀌어도 안 깨진다.
    """

    log_id: int
    from_status: str
    to_status: str
    created_at: datetime


@dataclass(frozen=True)
class TaskListItemDTO:
    """목록 항목 — 상세보다 얕고, **파생값이 함께 온다**(G-7).

    리스트와 칸반이 **같은 응답**을 본다. 칸반은 이 목록을 상태로 나눠 그릴 뿐이다.
    """

    id: int
    title: str
    status: str
    work_type: WorkTypeRefDTO
    project: ProjectRefDTO | None
    due_date: date | None
    due_start_time: time | None
    due_end_time: time | None
    d_day: int | None
    is_overdue: bool
    overdue_days: int | None
    memo_count: int
    todo_progress: TodoProgressDTO
    cancel_reason: str | None
    cancelled_at: datetime | None


@dataclass(frozen=True)
class TypeCountDTO:
    """유형 탭에 붙는 수. `work_type_id` 가 `None` 이면 「전체」다."""

    work_type_id: int | None
    name: str
    count: int


@dataclass(frozen=True)
class TaskListFilterDTO:
    """목록 조건. **기간·필터·정렬·페이지가 전부 쿼리에서 온다**(FE §1-2)."""

    period_from: datetime
    period_to: datetime
    work_type_id: int | None = None
    status: str | None = None
    project_id: int | None = None
    sort: str = "due_asc"
    page: int = 1
    size: int = 12


@dataclass(frozen=True)
class TaskListResultDTO:
    items: list[TaskListItemDTO]
    total: int
    page: int
    size: int
    type_counts: list[TypeCountDTO]
