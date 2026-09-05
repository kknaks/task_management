"""SPEC-003 §4 — 업무의 프론트 ↔ 백 계약.

키는 camelCase(§3 규칙 6). 검증 규칙은 SPEC-003 §4 Validation 표 그대로다.
**시각은 UTC ISO 문자열**이고 표시 변환은 화면이 한다(FE §3-6).
"""

from __future__ import annotations

from datetime import date, datetime, time
from typing import Annotated, Literal

from pydantic import ConfigDict, StringConstraints, field_validator, model_validator

from dto.task import (
    AttachmentCreateDTO,
    StatusChangeDTO,
    TaskListItemDTO,
    TaskListResultDTO,
    TaskAttachmentDTO,
    TaskCreateDTO,
    TaskDetailDTO,
    TaskLogDTO,
    TaskMemoDTO,
    TaskRelationDTO,
    TaskTodoDTO,
    TaskUpdateDTO,
    TodoCreateDTO,
    TodoUpdateDTO,
)
from dto.unset import UNSET, Unset
from schemas.base import CamelModel

# SPEC-003 §4 Validation — 상한은 spec 이 정한 값이다(S003-OQ-5).
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
TodoText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
MemoText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
LongText = Annotated[str, StringConstraints(max_length=4000)]
Label = Annotated[str, StringConstraints(max_length=100)]
Url = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]

Status = Literal["todo", "in_progress", "done", "cancelled"]
AttachmentRoleValue = Literal["reference", "deliverable"]
AttachmentKindValue = Literal["doc", "link"]

_NEWLINES = ("\n", "\r")


def _reject_newlines(value: str | None) -> str | None:
    """제목은 줄바꿈 불가(§4 Validation). 조용히 지우지 않고 **거부**한다."""
    if value is None:
        return None
    if any(character in value for character in _NEWLINES):
        raise ValueError("제목에 줄바꿈을 넣을 수 없습니다")
    return value


class _TaskRequest(CamelModel):
    """요청 공통 — **모르는 필드를 조용히 무시하지 않는다.**

    특히 `status` 가 그렇다. **상태 전이는 전용 엔드포인트**이고 WORK-005 가 갖는다(§4) —
    일반 PATCH 로 보내면 `422 validation_error` 다. 무시하면 「바뀐 줄 알았는데 안 바뀐」
    상태가 조용히 성립한다.
    """

    model_config = ConfigDict(extra="forbid")


# --- 입력 ---------------------------------------------------------------


class TodoCreate(_TaskRequest):
    text: TodoText
    due_date: date | None = None

    def to_dto(self) -> TodoCreateDTO:
        return TodoCreateDTO(text=self.text, due_date=self.due_date)


class TodoUpdate(_TaskRequest):
    text: TodoText | None = None
    done: bool | None = None
    due_date: date | None = None

    def to_dto(self) -> TodoUpdateDTO:
        sent = self.model_fields_set
        return TodoUpdateDTO(
            text=self.text if "text" in sent else UNSET,  # type: ignore[arg-type]
            done=self.done if "done" in sent else UNSET,  # type: ignore[arg-type]
            due_date=self.due_date if "due_date" in sent else UNSET,  # type: ignore[arg-type]
        )

    @model_validator(mode="after")
    def _reject_null_text_or_done(self) -> "TodoUpdate":
        for field in ("text", "done"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} 는 비울 수 없습니다")
        return self


class MemoCreate(_TaskRequest):
    text: MemoText


class AttachmentCreate(_TaskRequest):
    """T-9-a — `kind` 에 따라 채워지는 값이 갈린다. 서버가 다시 검증한다."""

    role: AttachmentRoleValue
    kind: AttachmentKindValue
    document_id: int | None = None
    url: Url | None = None
    label: Label | None = None

    def to_dto(self) -> AttachmentCreateDTO:
        return AttachmentCreateDTO(
            role=self.role,
            kind=self.kind,
            document_id=self.document_id,
            url=self.url,
            label=self.label,
        )


class RelationCreate(_TaskRequest):
    task_ids: list[int]


class TaskCreate(_TaskRequest):
    """생성 — 드로어에 넣은 것이 **한 번에** 간다(§5).

    **`status` 가 없다.** 생성 시 항상 「시작전」이다(DEC-002 §5 · U-1).
    """

    title: Title
    work_type_id: int
    project_id: int | None = None
    due_date: date | None = None
    due_start_time: time | None = None
    due_end_time: time | None = None
    background: LongText | None = None
    goal: LongText | None = None
    todos: list[TodoCreate] = []
    attachments: list[AttachmentCreate] = []
    related_task_ids: list[int] = []

    _no_newline = field_validator("title")(_reject_newlines)

    def to_dto(self) -> TaskCreateDTO:
        return TaskCreateDTO(
            title=self.title,
            work_type_id=self.work_type_id,
            project_id=self.project_id,
            due_date=self.due_date,
            due_start_time=self.due_start_time,
            due_end_time=self.due_end_time,
            background=self.background,
            goal=self.goal,
            todos=[todo.to_dto() for todo in self.todos],
            attachments=[attachment.to_dto() for attachment in self.attachments],
            related_task_ids=list(self.related_task_ids),
        )


class TaskUpdate(_TaskRequest):
    """부분 수정 — 보낸 필드만 바뀐다(§4).

    `dueDate: null` 은 **기한 삭제**이고 파생 일정도 사라진다.
    `title`·`workTypeId` 는 **비울 수 없는 값**이라 명시적 `null` 을 거부한다.
    """

    title: Title | None = None
    work_type_id: int | None = None
    project_id: int | None = None
    due_date: date | None = None
    due_start_time: time | None = None
    due_end_time: time | None = None
    background: LongText | None = None
    goal: LongText | None = None
    completion_result: LongText | None = None

    _no_newline = field_validator("title")(_reject_newlines)

    @model_validator(mode="after")
    def _reject_null_on_required_fields(self) -> "TaskUpdate":
        for field in ("title", "work_type_id"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} 는 비울 수 없습니다")
        return self

    def to_dto(self) -> TaskUpdateDTO:
        sent = self.model_fields_set

        def value(name: str) -> object | Unset:
            return getattr(self, name) if name in sent else UNSET

        return TaskUpdateDTO(
            title=value("title"),  # type: ignore[arg-type]
            work_type_id=value("work_type_id"),  # type: ignore[arg-type]
            project_id=value("project_id"),  # type: ignore[arg-type]
            due_date=value("due_date"),  # type: ignore[arg-type]
            due_start_time=value("due_start_time"),  # type: ignore[arg-type]
            due_end_time=value("due_end_time"),  # type: ignore[arg-type]
            background=value("background"),  # type: ignore[arg-type]
            goal=value("goal"),  # type: ignore[arg-type]
            completion_result=value("completion_result"),  # type: ignore[arg-type]
        )


# --- 응답 ---------------------------------------------------------------


class WorkTypeRef(CamelModel):
    """**삭제된 유형도 이름·색을 그대로 싣는다** — `isDeleted` 로 알린다(A-6)."""

    id: int
    name: str
    kind: str
    color_token: str
    is_deleted: bool


class ProjectRef(CamelModel):
    id: int
    name: str
    color_token: str
    is_deleted: bool


class TodoItem(CamelModel):
    id: int
    text: str
    done: bool
    due_date: date | None

    @classmethod
    def from_dto(cls, dto: TaskTodoDTO) -> "TodoItem":
        return cls(id=dto.id, text=dto.text, done=dto.done, due_date=dto.due_date)


class TodoProgress(CamelModel):
    done: int
    total: int


class MemoItem(CamelModel):
    id: int
    text: str
    created_at: datetime

    @classmethod
    def from_dto(cls, dto: TaskMemoDTO) -> "MemoItem":
        return cls(id=dto.id, text=dto.text, created_at=dto.created_at)


class AttachmentItem(CamelModel):
    id: int
    role: str
    kind: str
    name: str | None
    document_id: int | None
    folder_path: str | None
    url: str | None

    @classmethod
    def from_dto(cls, dto: TaskAttachmentDTO) -> "AttachmentItem":
        return cls(
            id=dto.id,
            role=dto.role,
            kind=dto.kind,
            name=dto.name,
            document_id=dto.document_id,
            folder_path=dto.folder_path,
            url=dto.url,
        )


class RelationItem(CamelModel):
    id: int
    title: str
    status: Status
    project_name: str | None
    due_date: date | None

    @classmethod
    def from_dto(cls, dto: TaskRelationDTO) -> "RelationItem":
        return cls(
            id=dto.id,
            title=dto.title,
            status=dto.status,  # type: ignore[arg-type]
            project_name=dto.project_name,
            due_date=dto.due_date,
        )


class LogItem(CamelModel):
    id: int
    text: str
    created_at: datetime

    @classmethod
    def from_dto(cls, dto: TaskLogDTO) -> "LogItem":
        return cls(id=dto.id, text=dto.text, created_at=dto.created_at)


class TaskDetail(CamelModel):
    """SPEC-003 §4 `GET /api/tasks/{id}` 의 형태.

    `dDay`·`isOverdue`·`todoProgress` 는 **파생값**이다 — 화면이 다시 계산하지 않는다(G-7).
    """

    id: int
    title: str
    status: Status
    work_type: WorkTypeRef
    project: ProjectRef | None
    due_date: date | None
    due_start_time: time | None
    due_end_time: time | None
    d_day: int | None
    is_overdue: bool
    background: str | None
    goal: str | None
    completion_result: str | None
    cancel_reason: str | None
    todos: list[TodoItem]
    todo_progress: TodoProgress
    memos: list[MemoItem]
    attachments: list[AttachmentItem]
    relations: list[RelationItem]
    relation_total: int
    logs: list[LogItem]
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_dto(cls, detail: TaskDetailDTO) -> "TaskDetail":
        task = detail.task
        return cls(
            id=task.id,
            title=task.title,
            status=task.status,  # type: ignore[arg-type]
            work_type=WorkTypeRef(
                id=task.work_type.id,
                name=task.work_type.name,
                kind=task.work_type.kind,
                color_token=task.work_type.color_token,
                is_deleted=task.work_type.is_deleted,
            ),
            project=(
                None
                if task.project is None
                else ProjectRef(
                    id=task.project.id,
                    name=task.project.name,
                    color_token=task.project.color_token,
                    is_deleted=task.project.is_deleted,
                )
            ),
            due_date=task.due_date,
            due_start_time=task.due_start_time,
            due_end_time=task.due_end_time,
            d_day=detail.d_day,
            is_overdue=detail.is_overdue,
            background=task.background,
            goal=task.goal,
            completion_result=task.completion_result,
            cancel_reason=task.cancel_reason,
            todos=[TodoItem.from_dto(todo) for todo in detail.todos],
            todo_progress=TodoProgress(
                done=detail.todo_progress.done, total=detail.todo_progress.total
            ),
            memos=[MemoItem.from_dto(memo) for memo in detail.memos],
            attachments=[
                AttachmentItem.from_dto(attachment) for attachment in detail.attachments
            ],
            relations=[RelationItem.from_dto(relation) for relation in detail.relations],
            relation_total=detail.relation_total,
            logs=[LogItem.from_dto(log) for log in detail.logs],
            created_at=task.created_at,
            updated_at=task.updated_at,
        )


class RelationCandidateItem(CamelModel):
    """연관업무 후보 한 건(U-8). 목록 행이 그리는 것만 담는다."""

    id: int
    title: str
    status: Status
    project_name: str | None
    due_date: date | None


class RelationCandidateListResponse(CamelModel):
    """`total` 은 U-8 우측 카운트 「n건 중 m」의 **`n`** 이다.

    **`scope` 를 적용한 뒤의 총계**이고 `items` 는 거기서 상위 20건(`m = items.length`)이다 —
    후보가 20건을 넘으면 둘이 갈린다.
    """

    items: list[RelationCandidateItem]
    total: int


# --- 상태 전이 · 목록 (SPEC-004 §4) --------------------------------------

CancelReason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class StatusChange(_TaskRequest):
    """**세 진입점이 같은 본문을 보낸다**(SPEC-004 §4).

    `status` 는 4종 중 하나다 — **「지연」은 값이 아니다**(T-4).
    `cancelReason` 은 `cancelled` 일 때만 받는다(판정은 service).
    """

    status: Status
    cancel_reason: CancelReason | None = None
    log_cancel_reason: bool = True

    def to_dto(self) -> StatusChangeDTO:
        return StatusChangeDTO(
            status=self.status,
            cancel_reason=self.cancel_reason,
            log_cancel_reason=self.log_cancel_reason,
        )


class TaskListItem(CamelModel):
    """목록 항목. `dDay`·`isOverdue`·`overdueDays`·`todoProgress` 는 **파생값**이다(G-7)."""

    id: int
    title: str
    status: Status
    work_type: WorkTypeRef
    project: ProjectRef | None
    due_date: date | None
    due_start_time: time | None
    due_end_time: time | None
    d_day: int | None
    is_overdue: bool
    overdue_days: int | None
    memo_count: int
    todo_progress: TodoProgress
    cancel_reason: str | None
    cancelled_at: datetime | None

    @classmethod
    def from_dto(cls, dto: TaskListItemDTO) -> "TaskListItem":
        return cls(
            id=dto.id,
            title=dto.title,
            status=dto.status,  # type: ignore[arg-type]
            work_type=WorkTypeRef(
                id=dto.work_type.id,
                name=dto.work_type.name,
                kind=dto.work_type.kind,
                color_token=dto.work_type.color_token,
                is_deleted=dto.work_type.is_deleted,
            ),
            project=(
                None
                if dto.project is None
                else ProjectRef(
                    id=dto.project.id,
                    name=dto.project.name,
                    color_token=dto.project.color_token,
                    is_deleted=dto.project.is_deleted,
                )
            ),
            due_date=dto.due_date,
            due_start_time=dto.due_start_time,
            due_end_time=dto.due_end_time,
            d_day=dto.d_day,
            is_overdue=dto.is_overdue,
            overdue_days=dto.overdue_days,
            memo_count=dto.memo_count,
            todo_progress=TodoProgress(
                done=dto.todo_progress.done, total=dto.todo_progress.total
            ),
            cancel_reason=dto.cancel_reason,
            cancelled_at=dto.cancelled_at,
        )


class TypeCount(CamelModel):
    """유형 탭에 붙는 수. `workTypeId` 가 `null` 이면 「전체」다."""

    work_type_id: int | None
    name: str
    count: int


class TaskListResponse(CamelModel):
    items: list[TaskListItem]
    total: int
    page: int
    size: int
    type_counts: list[TypeCount]

    @classmethod
    def from_dto(cls, dto: TaskListResultDTO) -> "TaskListResponse":
        return cls(
            items=[TaskListItem.from_dto(item) for item in dto.items],
            total=dto.total,
            page=dto.page,
            size=dto.size,
            type_counts=[
                TypeCount(work_type_id=row.work_type_id, name=row.name, count=row.count)
                for row in dto.type_counts
            ],
        )
