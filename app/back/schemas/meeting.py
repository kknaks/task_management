"""SPEC-006 §4 — 회의록의 프론트 ↔ 백 계약.

키는 camelCase(§3 규칙 6). 검증 규칙은 SPEC-006 §4 Validation 표 그대로다.
**시각은 UTC ISO 문자열**(오프셋 필수 — `AwareDatetime`)이고 표시 변환은 화면이 한다(G-2).

`MeetingDetail` 의 필드 이름은 **SPEC-006 §4 필드 소유 표가 정본**이다 —
`agendas.{human,ai,merged}` · `latestBatchSeq`(SPEC-007 의 `tracks.*` · `aiBatchSeq` 표기는 이 표로 정정됐다).
유형·프로젝트 참조는 업무와 같은 형태라 `schemas.task` 의 것을 쓴다.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import (
    AwareDatetime,
    ConfigDict,
    StringConstraints,
    ValidationInfo,
    field_validator,
    model_validator,
)

from dto.enums import PayloadStatus
from dto.meeting import (
    AgendaCreateDTO,
    AgendaUpdateDTO,
    LineCreateDTO,
    LineNewTaskDTO,
    LineTaskUpdateDTO,
    LineTaskSummaryDTO,
    LineUpdateDTO,
    MeetingAgendaDTO,
    MeetingAttachmentCreateDTO,
    MeetingAttachmentDTO,
    MeetingCreateDTO,
    MeetingDetailDTO,
    MeetingLineDTO,
    MeetingListItemDTO,
    MeetingListResultDTO,
    MeetingUpdateDTO,
    MergedSummaryDTO,
    ProjectCountDTO,
    TaskContextDTO,
    TranscriptDTO,
    TranscriptItemDTO,
)
from dto.unset import UNSET, Unset
from schemas.base import CamelModel
from schemas.task import ProjectRef, WorkTypeRef

# SPEC-006 §4 Validation — 상한은 spec 이 정한 값이다(WP §Open Issues).
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
AgendaTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Label = Annotated[str, StringConstraints(max_length=100)]
Url = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]

MeetingStatusValue = Literal["scheduled", "recording", "generating", "ended"]
IntegrationStateValue = Literal["not_started", "running", "succeeded", "failed"]
TrackValue = Literal["human", "ai", "merged"]
AgendaStateValue = Literal["next", "active", "done"]
AttachmentKindValue = Literal["doc", "link"]
# SPEC-007 §4 Validation — 줄 종류 **4종**(DEC-003 §1 표)
LineKindValue = Literal["discussion", "decision", "task", "action"]
# 줄 본문 — 공백 제거 후 1~2000자 · 줄바꿈 불가(줄은 한 줄이다)
LineContent = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]

_NEWLINES = ("\n", "\r")


def _reject_newlines(value: str | None) -> str | None:
    """제목은 줄바꿈 불가(§4 Validation). 조용히 지우지 않고 **거부**한다."""
    if value is None:
        return None
    if any(character in value for character in _NEWLINES):
        raise ValueError("제목에 줄바꿈을 넣을 수 없습니다")
    return value


class _MeetingRequest(CamelModel):
    """요청 공통 — **모르는 필드를 조용히 무시하지 않는다.**

    특히 `status` 가 그렇다. **상태 전이는 전용 엔드포인트**(`/start` · `/end`)다(§4 · BE §10) —
    일반 PATCH 로 보내면 `422 validation_error`. 무시하면 「바뀐 줄 알았는데 안 바뀐」 상태가 조용히 성립한다.
    `recordingStartedAt` · `headline` · `location` · `attendees` 도 같은 방식으로 막힌다(자리가 없다).
    """

    model_config = ConfigDict(extra="forbid")


# --- 입력 ---------------------------------------------------------------


class AgendaCreate(_MeetingRequest):
    title: AgendaTitle

    def to_dto(self) -> AgendaCreateDTO:
        return AgendaCreateDTO(title=self.title)


class AgendaUpdate(_MeetingRequest):
    """`PATCH …/agendas/{id}` — **`title`·`state` 부분 수정 한 표면**(SPEC-007 §7-A).

    `title` 은 시작 전(SPEC-006)·종료 후 편집(SPEC-008), `state` 는 회의 중(SPEC-007 U-2·U-3) 이 보낸다.
    둘 다 `null` 로 비울 수 없다. 상태별 허용은 service 의 표 하나가 판정한다.
    """

    title: AgendaTitle | None = None
    state: AgendaStateValue | None = None

    @model_validator(mode="after")
    def _reject_null(self) -> "AgendaUpdate":
        for name in ("title", "state"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} 은 비울 수 없습니다")
        return self

    def to_dto(self) -> AgendaUpdateDTO:
        sent = self.model_fields_set
        return AgendaUpdateDTO(
            title=self.title if "title" in sent else UNSET,  # type: ignore[arg-type]
            state=self.state if "state" in sent else UNSET,  # type: ignore[arg-type]
        )


# SPEC-008 §4 Validation — `detail` 4000 이하 · `note` 1~2000 · 할일 각 1~200 · 완료 결과 4000 이하
LineDetail = Annotated[str, StringConstraints(max_length=4000)]
PayloadNote = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
TodoText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
CompletionResult = Annotated[str, StringConstraints(max_length=4000)]
# SPEC-003 `POST /api/tasks` Validation 그대로(액션 줄 생성분 · `/lines/{id}/task` 본문) — 제목 1~200 · 설명 4000 이하
TaskTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
TaskDescription = Annotated[str, StringConstraints(max_length=4000)]
# 상태 값 집합의 정본은 **`dto.enums.PayloadStatus`** 다 — 여기에 문자열을 다시 적지 않는다.
# 이것이 **완료 게이트의 뒷문을 층에서 막는 자리**다(MF-59 · BE §12 8-c) — `done`·`cancelled` 는 `422` 로 나간다.
# 액션 payload 에는 상태가 없다(새 업무는 언제나 「시작전」) — 이 타입을 쓰는 것은 **업무 줄의 두 표면뿐**이다


class ActionLinePayload(_MeetingRequest):
    """**액션 줄의 `payload`** — 새로 만들 업무의 **생성분 일곱**(M-14-a · SPEC-008 U-10).

    `title` 만 필수다. **`workTypeId` 는 `null` 이어도 저장된다** — AI 가 못 고르면 비워 두고 「넣기」 때 사람이 고른다
    (SPEC-008 §4 「페이로드 참조」 · WP OQ-12). 상태는 담지 않는다(새 업무는 언제나 「시작전」).
    `extra="forbid"` 가 여덟째 키를 막는다. 저장 형태는 **일곱 키가 모두 있는 camelCase JSON** 이다(§4 예시 그대로).
    """

    title: TaskTitle
    work_type_id: int | None = None
    project_id: int | None = None
    start_date: date | None = None
    due_date: date | None = None
    description: TaskDescription | None = None
    todos: list[TodoText] = []

    _no_newline = field_validator("title")(_reject_newlines)

    def to_json(self) -> dict[str, object]:
        return {
            "title": self.title,
            "workTypeId": self.work_type_id,
            "projectId": self.project_id,
            "startDate": None if self.start_date is None else self.start_date.isoformat(),
            "dueDate": None if self.due_date is None else self.due_date.isoformat(),
            "description": self.description,
            "todos": list(self.todos),
        }


# 변경분 일곱 — **필드 이름 → 저장 키**. 한 곳이다(검증도 직렬화도 이 표를 돈다)
_TASK_CHANGE_KEYS: dict[str, str] = {
    "due_date": "dueDate",
    "status": "status",
    "note": "note",
    "todos": "todos",
    "related_task_ids": "relatedTaskIds",
    "project_id": "projectId",
    "completion_result": "completionResult",
}


class _TaskChange(_MeetingRequest):
    """업무 줄의 **변경분 일곱** — `payload` 와 「넣기」 본문이 **같은 키 · 같은 규칙**을 쓰는 자리(WP §Internal Interface).

    「보내지 않음」이 곧 「변경 없음」이라 **보낸 키를 `null` 로 비울 수 없다**(비우는 뜻의 값이 계약에 없다).
    상태는 `PayloadStatus` 하나로 갈린다 — 그래서 `done` 뒷문이 두 표면에 동시에 없다.
    """

    due_date: date | None = None
    status: PayloadStatus | None = None
    note: PayloadNote | None = None
    todos: list[TodoText] | None = None
    related_task_ids: list[int] | None = None
    project_id: int | None = None
    completion_result: CompletionResult | None = None

    @model_validator(mode="after")
    def _sent_changes_are_not_null(self) -> "_TaskChange":
        for name in _TASK_CHANGE_KEYS:
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} 은 비울 수 없습니다")
        return self

    def _changes_json(self) -> dict[str, object]:
        """**보낸 키만** camelCase 로. 저장값과 「넣기」 본문의 모양이 같아야 드로어가 그대로 프리필한다."""
        changes: dict[str, object] = {}
        for name, key in _TASK_CHANGE_KEYS.items():
            if name not in self.model_fields_set:
                continue
            value = getattr(self, name)
            if isinstance(value, date):
                value = value.isoformat()
            elif isinstance(value, PayloadStatus):
                # 저장 형태는 **평범한 문자열**이다 — JSONB 에 enum 표현이 새지 않게 한다
                value = value.value
            changes[key] = value
        return changes


class TaskLinePayload(_TaskChange):
    """**업무 줄의 `payload`** — 아직 반영하지 않은 변경분 일곱(M-14-a). 옛 세 키 모델(기한·상태·메모)의 자리를 대신한다.

    **키가 0개여도 받는다.** 예전에는 이 저장값이 곧 「업무 갱신」 요청이라 빈 값이 뜻을 잃었지만,
    이제 요청은 드로어가 보내는 `TaskUpdateBody` 다 — `payload` 는 **저장된 초안**일 뿐이라 빈 초안이 계약을 깨지 않는다.
    """

    def to_json(self) -> dict[str, object]:
        return self._changes_json()


class TaskUpdateBody(_TaskChange):
    """`PATCH …/lines/{id}/task` 본문 — U-9 「넣기」(SPEC-008 §4 ①~⑧).

    `taskId` 는 **필수**다(헤더 셀렉터의 업무). 변경분은 `TaskLinePayload` 와 같은 키·같은 규칙이고 **0개도 된다** — ⑧ 만 일어난다.
    """

    task_id: int

    def to_dto(self) -> LineTaskUpdateDTO:
        sent = self.model_fields_set
        return LineTaskUpdateDTO(
            task_id=self.task_id,
            due_date=self.due_date if "due_date" in sent else UNSET,  # type: ignore[arg-type]
            status=self.status.value if "status" in sent and self.status is not None else UNSET,  # type: ignore[arg-type]
            note=self.note if "note" in sent else UNSET,  # type: ignore[arg-type]
            todos=tuple(self.todos or ()) if "todos" in sent else UNSET,  # type: ignore[arg-type]
            related_task_ids=(
                tuple(self.related_task_ids or ()) if "related_task_ids" in sent else UNSET  # type: ignore[arg-type]
            ),
            project_id=self.project_id if "project_id" in sent else UNSET,  # type: ignore[arg-type]
            completion_result=(
                self.completion_result if "completion_result" in sent else UNSET  # type: ignore[arg-type]
            ),
        )


class LineNewTask(_MeetingRequest):
    """`POST …/lines/{id}/task` 본문 — 액션 줄 「넣기」. 규칙은 SPEC-003 `POST /api/tasks` 그대로(첨부·연관은 받지 않는다).

    **줄을 만들면서 업무까지 만드는 갈래는 폐기됐다**(MF-64 정정) — 새 업무의 값은 `payload` 로 저장되고,
    업무가 되는 것은 보기 모드의 「넣기」뿐이다. 그래서 `workTypeId` 는 여기서 **필수**다
    (`payload` 에서는 `null` 이어도 됐다 — 고르는 자리가 여기다).
    """

    title: TaskTitle
    work_type_id: int
    project_id: int | None = None
    start_date: date | None = None
    due_date: date | None = None
    description: TaskDescription | None = None
    todos: list[TodoText] = []

    _no_newline = field_validator("title")(_reject_newlines)

    def to_dto(self) -> LineNewTaskDTO:
        return LineNewTaskDTO(
            title=self.title,
            work_type_id=self.work_type_id,
            project_id=self.project_id,
            start_date=self.start_date,
            due_date=self.due_date,
            description=self.description,
            todos=tuple(self.todos),
        )


# `payload` 의 모양은 **줄 종류가 고른다**(SPEC-008 §4) — 액션 = 생성분 · 업무 = 변경분.
_PAYLOAD_BY_KIND: dict[str, type[ActionLinePayload] | type[TaskLinePayload]] = {
    "action": ActionLinePayload,
    "task": TaskLinePayload,
}
_PAYLOAD_NOT_HERE = "payload 는 액션 · 업무 줄에만 실을 수 있습니다"
_TASK_ID_NOT_HERE = "taskId 는 업무 줄에만 실을 수 있습니다"


def _payload_kind_of(payload: object) -> str:
    """스키마가 알아본 모양을 service 가 줄의 `kind` 와 맞춰 볼 수 있게 이름으로 돌려준다."""
    return "action" if isinstance(payload, ActionLinePayload) else "task"


class LineCreate(_MeetingRequest):
    """`POST …/lines` — 회의 중(SPEC-007 §4)과 종료 후 편집(SPEC-008 §4) **한 표면**.

    회의 중은 `agendaId`·`kind`·`content` 만. 종료 후가 더하는 것 — `detail`(U-8) · **`payload`**(U-9 · U-10 칩 진입) ·
    업무 줄의 `taskId`. **`content` 는 네 종류 모두 필수**이고 서버가 업무 제목으로 채우지 않는다(MF-64 정정).
    **줄 추가로 업무를 만드는 필드는 어느 줄에서도 받지 않는다** — `extra="forbid"` 가 `422` 로 막는다.

    `payload`·`taskId` 는 **`kind ∈ {action, task}` 에만**(`taskId` 는 `task` 줄에만) — 논의·결정에 실리면 `422` 다.
    업무는 생기지 않는다(이 표면은 `task_service` 를 부르지 않는다).
    """

    agenda_id: int
    kind: LineKindValue
    content: LineContent
    detail: LineDetail | None = None
    task_id: int | None = None
    payload: ActionLinePayload | TaskLinePayload | None = None

    _no_newline = field_validator("content")(_reject_newlines)

    @field_validator("task_id")
    @classmethod
    def _task_id_only_on_task_lines(cls, value: int | None, info: ValidationInfo) -> int | None:
        if value is not None and info.data.get("kind") != "task":
            raise ValueError(_TASK_ID_NOT_HERE)
        return value

    @field_validator("payload", mode="before")
    @classmethod
    def _payload_shape_follows_kind(cls, raw: object, info: ValidationInfo) -> object:
        """`kind` 를 보고 **한 모양으로만** 검증한다 — 유니온 추론에 맡기면 실패한 쪽 이름이 오류 위치에 섞인다.

        `kind` 는 이 필드보다 먼저 선언돼 있어 `info.data` 로 읽힌다(그것부터 틀렸으면 그 오류가 먼저 나간다).
        """
        if raw is None:
            return raw
        model = _PAYLOAD_BY_KIND.get(str(info.data.get("kind")))
        if model is None:
            raise ValueError(_PAYLOAD_NOT_HERE)
        return model.model_validate(raw)

    def to_dto(self) -> LineCreateDTO:
        return LineCreateDTO(
            agenda_id=self.agenda_id,
            kind=self.kind,
            content=self.content,
            detail=self.detail,
            task_id=self.task_id,
            payload=None if self.payload is None else self.payload.to_json(),
        )


class LineUpdate(_MeetingRequest):
    """`PATCH …/lines/{id}` — 보낸 필드만(SPEC-008 §4). `content` · `payload` · `taskId` 셋뿐이다.

    **`kind` 를 받지 않는다**(MF-60 — 줄 종류를 바꾸는 표면이 없다). 보내면 `extra="forbid"` 가 `422` 다.
    `content` 는 비울 수 없고, `payload`·`taskId` 는 **`null` 로 비울 수 있다**(드로어에서 지우거나 업무를 아직 안 골랐을 때).

    본문에 `kind` 가 없어 모양은 **`title` 키 유무로** 가린다 — 액션 생성분은 `title` 이 필수이고 변경분에는 그 키가 없다.
    고른 모양이 **그 줄의 종류와 맞는지**는 service 가 본다(줄의 `kind` 는 DB 에 있다).
    """

    content: LineContent | None = None
    payload: ActionLinePayload | TaskLinePayload | None = None
    task_id: int | None = None

    _no_newline = field_validator("content")(_reject_newlines)

    @field_validator("payload", mode="before")
    @classmethod
    def _payload_shape_from_the_title_key(cls, raw: object) -> object:
        if raw is None or not isinstance(raw, dict):
            return raw
        return (ActionLinePayload if "title" in raw else TaskLinePayload).model_validate(raw)

    @model_validator(mode="after")
    def _reject_null_content_and_empty_body(self) -> "LineUpdate":
        if not self.model_fields_set:
            raise ValueError("바꿀 필드가 없습니다")
        if "content" in self.model_fields_set and self.content is None:
            raise ValueError("content 는 비울 수 없습니다")
        return self

    def to_dto(self) -> LineUpdateDTO:
        sent = self.model_fields_set
        payload_sent = "payload" in sent
        return LineUpdateDTO(
            content=self.content if "content" in sent else UNSET,  # type: ignore[arg-type]
            payload=(None if self.payload is None else self.payload.to_json()) if payload_sent else UNSET,
            payload_kind=(
                _payload_kind_of(self.payload) if payload_sent and self.payload is not None else UNSET  # type: ignore[arg-type]
            ),
            task_id=self.task_id if "task_id" in sent else UNSET,  # type: ignore[arg-type]
        )


class MeetingAttachmentCreate(_MeetingRequest):
    """M-17 — `kind` 에 따라 채워지는 값이 갈린다. 서버(service)가 다시 검증한다."""

    kind: AttachmentKindValue
    document_id: int | None = None
    url: Url | None = None
    label: Label | None = None

    def to_dto(self) -> MeetingAttachmentCreateDTO:
        return MeetingAttachmentCreateDTO(
            kind=self.kind,
            document_id=self.document_id,
            url=self.url,
            label=self.label,
        )


class MeetingCreate(_MeetingRequest):
    """생성 — 드로어에 넣은 것이 **한 번에** 간다(§5). **`status` 가 없다** — 항상 `scheduled` 다."""

    title: Title
    work_type_id: int
    project_id: int | None = None
    start_at: AwareDatetime
    end_at: AwareDatetime
    agendas: list[AgendaCreate] = []
    attachments: list[MeetingAttachmentCreate] = []

    _no_newline = field_validator("title")(_reject_newlines)

    def to_dto(self) -> MeetingCreateDTO:
        return MeetingCreateDTO(
            title=self.title,
            work_type_id=self.work_type_id,
            project_id=self.project_id,
            start_at=self.start_at,
            end_at=self.end_at,
            agendas=[agenda.to_dto() for agenda in self.agendas],
            attachments=[attachment.to_dto() for attachment in self.attachments],
        )


class MeetingUpdate(_MeetingRequest):
    """부분 수정 — 보낸 필드만 바뀐다(§4). **일시는 항상 둘을 함께**(반쪽은 service 가 422).

    `projectId: null` 은 무소속으로 바꾸는 뜻. `title`·`workTypeId`·`startAt`·`endAt` 은 **비울 수 없는 값**이라
    명시적 `null` 을 거부한다(M-1 NOT NULL). **`status` 필드가 없다.**
    """

    title: Title | None = None
    work_type_id: int | None = None
    project_id: int | None = None
    start_at: AwareDatetime | None = None
    end_at: AwareDatetime | None = None

    _no_newline = field_validator("title")(_reject_newlines)

    @model_validator(mode="after")
    def _reject_null_on_required_fields(self) -> "MeetingUpdate":
        for field in ("title", "work_type_id", "start_at", "end_at"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} 는 비울 수 없습니다")
        return self

    def to_dto(self) -> MeetingUpdateDTO:
        sent = self.model_fields_set

        def value(name: str) -> object | Unset:
            return getattr(self, name) if name in sent else UNSET

        return MeetingUpdateDTO(
            title=value("title"),  # type: ignore[arg-type]
            work_type_id=value("work_type_id"),  # type: ignore[arg-type]
            project_id=value("project_id"),  # type: ignore[arg-type]
            start_at=value("start_at"),  # type: ignore[arg-type]
            end_at=value("end_at"),  # type: ignore[arg-type]
        )


# --- 응답 ---------------------------------------------------------------


class LineTaskSummary(CamelModel):
    """`kind='task'` 줄의 업무 요약(SPEC-008). 삭제된 업무도 제목 그대로 · `isDeleted` 로 알린다.

    `workType` — AI 업무 줄의 유형 배지 원천(SPEC-007 §4 LineItem L378 · U-4 · SPEC-008 §4 L451). 업무 목록의 `WorkTypeRef` 와 같은 모양.
    """

    id: int
    title: str
    status: str
    due_date: date | None
    is_deleted: bool
    work_type: WorkTypeRef

    @classmethod
    def from_dto(cls, dto: LineTaskSummaryDTO) -> "LineTaskSummary":
        return cls(
            id=dto.id,
            title=dto.title,
            status=dto.status,
            due_date=dto.due_date,  # type: ignore[arg-type]
            is_deleted=dto.is_deleted,
            work_type=WorkTypeRef(
                id=dto.work_type.id,
                name=dto.work_type.name,
                kind=dto.work_type.kind,
                color_token=dto.work_type.color_token,
                is_deleted=dto.work_type.is_deleted,
            ),
        )


class LineItem(CamelModel):
    """줄 — 형태는 ERD `meeting_line`. **의미·표시·쓰기 표면은 SPEC-007·008 이 정본**이고 여기는 자리만 고정한다."""

    id: int
    track: TrackValue
    agenda_id: int
    kind: str
    content: str
    detail: str | None
    evidence: list
    order_index: int
    task_id: int | None
    # 두 모양이다(M-14-a) — 액션 줄 = 생성분 일곱 · 업무 줄 = 변경분(있는 키만). AI 가 채운 것과 사람이 「저장」한 것을 구분하지 않는다
    payload: dict | None
    task: LineTaskSummary | None
    # SPEC-007 §4 — 줄 우측 시각. 안건 우측 시각은 화면이 `min(createdAt)` 으로 파생한다
    created_at: datetime

    @classmethod
    def from_dto(cls, dto: MeetingLineDTO) -> "LineItem":
        return cls(
            id=dto.id,
            track=dto.track,  # type: ignore[arg-type]
            agenda_id=dto.agenda_id,
            kind=dto.kind,
            content=dto.content,
            detail=dto.detail,
            evidence=dto.evidence,
            order_index=dto.order_index,
            task_id=dto.task_id,
            payload=dto.payload,
            task=None if dto.task is None else LineTaskSummary.from_dto(dto.task),
            created_at=dto.created_at,
        )


class AgendaItem(CamelModel):
    """안건 — `state` 는 시작 전 `null`. `lines[]` 가 **안건 안에 중첩**된다(§4)."""

    id: int
    track: TrackValue
    title: str
    order_index: int
    state: AgendaStateValue | None
    source_agenda_id: int | None
    lines: list[LineItem]

    @classmethod
    def from_dto(cls, dto: MeetingAgendaDTO) -> "AgendaItem":
        return cls(
            id=dto.id,
            track=dto.track,  # type: ignore[arg-type]
            title=dto.title,
            order_index=dto.order_index,
            state=dto.state,  # type: ignore[arg-type]
            source_agenda_id=dto.source_agenda_id,
            lines=[LineItem.from_dto(line) for line in dto.lines],
        )


class AgendaTracks(CamelModel):
    """`agendas.{human, ai, merged}` — **세 키가 항상 있고** 비어 있으면 `[]`(화면이 키 유무로 분기하지 않는다)."""

    human: list[AgendaItem]
    ai: list[AgendaItem]
    merged: list[AgendaItem]


class MeetingAttachmentItem(CamelModel):
    id: int
    kind: AttachmentKindValue
    name: str
    document_id: int | None
    folder_path: str | None
    size_bytes: int | None
    updated_at: datetime
    url: str | None
    is_deleted: bool

    @classmethod
    def from_dto(cls, dto: MeetingAttachmentDTO) -> "MeetingAttachmentItem":
        return cls(
            id=dto.id,
            kind=dto.kind,  # type: ignore[arg-type]
            name=dto.name,
            document_id=dto.document_id,
            folder_path=dto.folder_path,
            size_bytes=dto.size_bytes,
            updated_at=dto.updated_at,
            url=dto.url,
            is_deleted=dto.is_deleted,
        )


class MergedSummary(CamelModel):
    """「안건 n · 논의 n · 결정 n · 액션 n · 업무 n」 — **다섯**(SPEC-008 §4 Data Contract).

    `integratedAt` 이 없다 — 통합 단계가 사라져(MF-56) 가리킬 시각이 없다.
    """

    agenda_count: int
    discussion_count: int
    decision_count: int
    action_count: int
    task_count: int

    @classmethod
    def from_dto(cls, dto: MergedSummaryDTO) -> "MergedSummary":
        return cls(
            agenda_count=dto.agenda_count,
            discussion_count=dto.discussion_count,
            decision_count=dto.decision_count,
            action_count=dto.action_count,
            task_count=dto.task_count,
        )


class MeetingDetail(CamelModel):
    """SPEC-006 §4 `GET /api/meetings/{id}` — **필드 소유 표 그대로.** SPEC-007·008 이 이 형태를 승계한다.

    `durationMinutes` · `latestBatchSeq` · `mergedSummary` · `activeJobId` 는 **파생값**(G-7).
    `recordingPath` · `aiSessionId` · 트랜스크립트 · job 은 **싣지 않는다**.
    """

    id: int
    title: str
    status: MeetingStatusValue
    integration_state: IntegrationStateValue
    work_type: WorkTypeRef
    project: ProjectRef | None
    start_at: datetime
    end_at: datetime
    duration_minutes: int
    recording_started_at: datetime | None
    headline: str | None
    merged_summary: MergedSummary | None
    agendas: AgendaTracks
    attachments: list[MeetingAttachmentItem]
    latest_batch_seq: int
    active_job_id: int | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_dto(cls, detail: MeetingDetailDTO) -> "MeetingDetail":
        meeting = detail.meeting
        return cls(
            id=meeting.id,
            title=meeting.title,
            status=meeting.status,  # type: ignore[arg-type]
            integration_state=meeting.integration_state,  # type: ignore[arg-type]
            work_type=WorkTypeRef(
                id=meeting.work_type.id,
                name=meeting.work_type.name,
                kind=meeting.work_type.kind,
                color_token=meeting.work_type.color_token,
                is_deleted=meeting.work_type.is_deleted,
            ),
            project=(
                None
                if meeting.project is None
                else ProjectRef(
                    id=meeting.project.id,
                    name=meeting.project.name,
                    color_token=meeting.project.color_token,
                    is_deleted=meeting.project.is_deleted,
                )
            ),
            start_at=meeting.start_at,
            end_at=meeting.end_at,
            duration_minutes=detail.duration_minutes,
            recording_started_at=meeting.recording_started_at,
            headline=detail.headline,
            merged_summary=(
                None
                if detail.merged_summary is None
                else MergedSummary.from_dto(detail.merged_summary)
            ),
            agendas=AgendaTracks(
                human=[AgendaItem.from_dto(agenda) for agenda in detail.agendas.human],
                ai=[AgendaItem.from_dto(agenda) for agenda in detail.agendas.ai],
                merged=[AgendaItem.from_dto(agenda) for agenda in detail.agendas.merged],
            ),
            attachments=[
                MeetingAttachmentItem.from_dto(attachment)
                for attachment in detail.attachments
            ],
            latest_batch_seq=detail.latest_batch_seq,
            active_job_id=detail.active_job_id,
            created_at=meeting.created_at,
            updated_at=meeting.updated_at,
        )


# --- 트랜스크립트 (SPEC-007 §4) -------------------------------------------


class MeetingTaskItem(CamelModel):
    """`GET /api/meetings/current/tasks` 한 줄 — SPEC-007 §4 도구 표 `list_tasks` 의 필드 그대로
    (`id` · 제목 · 상태 · 기한 · 유형명 · 프로젝트). 화면 계약(`TaskListItem`)과 **다른 표면**이다.
    """

    id: int
    title: str
    status: str
    due_date: date | None
    work_type_name: str
    project_name: str | None

    @classmethod
    def from_dto(cls, dto: TaskContextDTO) -> "MeetingTaskItem":
        return cls(
            id=dto.id,
            title=dto.title,
            status=dto.status,
            due_date=dto.due_date,
            work_type_name=dto.work_type_name,
            project_name=dto.project_name,
        )


class MeetingTaskListResponse(CamelModel):
    """목록 응답은 `{ items: [...] }` 로 감싼다(BE §10 공통)."""

    items: list[MeetingTaskItem]

    @classmethod
    def from_dtos(cls, dtos: list[TaskContextDTO]) -> "MeetingTaskListResponse":
        return cls(items=[MeetingTaskItem.from_dto(dto) for dto in dtos])


class TranscriptItem(CamelModel):
    """확정 발화 블록. `speakerLabel` 은 `"1"`·`"2"` 번호 문자열 — 「화자 1」 접두는 화면 매핑(G-4)."""

    id: int
    speaker_label: str
    at_ms: int
    end_ms: int
    content: str

    @classmethod
    def from_dto(cls, dto: TranscriptItemDTO) -> "TranscriptItem":
        return cls(
            id=dto.id,
            speaker_label=dto.speaker_label,
            at_ms=dto.at_ms,
            end_ms=dto.end_ms,
            content=dto.content,
        )


class TranscriptResponse(CamelModel):
    """`GET …/transcript` — `atMs` 순 전량. 페이지를 나누지 않는다(v1 규모)."""

    recording_started_at: datetime | None
    speaker_count: int
    items: list[TranscriptItem]

    @classmethod
    def from_dto(cls, dto: TranscriptDTO) -> "TranscriptResponse":
        return cls(
            recording_started_at=dto.recording_started_at,
            speaker_count=dto.speaker_count,
            items=[TranscriptItem.from_dto(item) for item in dto.items],
        )


# --- 목록 ---------------------------------------------------------------


class MeetingListItem(CamelModel):
    """목록 항목(§4). `headline`·`agendaTitles`·`attachmentCount` 는 파생 표시값 — 화면이 트리를 다시 조립하지 않는다."""

    id: int
    title: str
    status: MeetingStatusValue
    integration_state: IntegrationStateValue
    start_at: datetime
    end_at: datetime
    work_type: WorkTypeRef
    project: ProjectRef | None
    headline: str | None
    agenda_titles: list[str]
    attachment_count: int
    updated_at: datetime

    @classmethod
    def from_dto(cls, dto: MeetingListItemDTO) -> "MeetingListItem":
        return cls(
            id=dto.id,
            title=dto.title,
            status=dto.status,  # type: ignore[arg-type]
            integration_state=dto.integration_state,  # type: ignore[arg-type]
            start_at=dto.start_at,
            end_at=dto.end_at,
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
            headline=dto.headline,
            agenda_titles=list(dto.agenda_titles),
            attachment_count=dto.attachment_count,
            updated_at=dto.updated_at,
        )


class ProjectCount(CamelModel):
    """`projectId: null` 이 「미정」. 삭제된 프로젝트도 이름·색 그대로 남는다(DEC-001 §4)."""

    project_id: int | None
    name: str | None
    color_token: str | None
    count: int

    @classmethod
    def from_dto(cls, dto: ProjectCountDTO) -> "ProjectCount":
        return cls(
            project_id=dto.project_id,
            name=dto.name,
            color_token=dto.color_token,
            count=dto.count,
        )


class MeetingListResponse(CamelModel):
    """`total` 은 필터 **적용 후** · `projectCounts` 는 **적용 전** 그 달 전체(§4)."""

    items: list[MeetingListItem]
    total: int
    project_counts: list[ProjectCount]

    @classmethod
    def from_dto(cls, dto: MeetingListResultDTO) -> "MeetingListResponse":
        return cls(
            items=[MeetingListItem.from_dto(item) for item in dto.items],
            total=dto.total,
            project_counts=[ProjectCount.from_dto(row) for row in dto.project_counts],
        )
