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

from pydantic import AwareDatetime, ConfigDict, StringConstraints, field_validator, model_validator

from dto.meeting import (
    AgendaCreateDTO,
    AgendaUpdateDTO,
    LineCreateDTO,
    LineTaskSummaryDTO,
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


class LineCreate(_MeetingRequest):
    """`POST …/lines` — 회의 중 사람 줄 하나(SPEC-007 §4). `agendaId` 는 **이 회의의 사람 트랙** 안건(service 가 판정)."""

    agenda_id: int
    kind: LineKindValue
    content: LineContent

    _no_newline = field_validator("content")(_reject_newlines)

    def to_dto(self) -> LineCreateDTO:
        return LineCreateDTO(agenda_id=self.agenda_id, kind=self.kind, content=self.content)


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
    pending_change: dict | None
    source_human_line_id: int | None
    source_ai_line_id: int | None
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
            pending_change=dto.pending_change,
            source_human_line_id=dto.source_human_line_id,
            source_ai_line_id=dto.source_ai_line_id,
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
    agenda_count: int
    decision_count: int
    action_count: int
    integrated_at: datetime

    @classmethod
    def from_dto(cls, dto: MergedSummaryDTO) -> "MergedSummary":
        return cls(
            agenda_count=dto.agenda_count,
            decision_count=dto.decision_count,
            action_count=dto.action_count,
            integrated_at=dto.integrated_at,
        )


class MeetingDetail(CamelModel):
    """SPEC-006 §4 `GET /api/meetings/{id}` — **필드 소유 표 그대로.** SPEC-007·008 이 이 형태를 승계한다.

    `durationMinutes` · `latestBatchSeq` · `mergedSummary` · `finalBatchState` · `activeJobId` 는 **파생값**(G-7).
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
    final_batch_state: Literal["succeeded", "failed"] | None
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
            final_batch_state=detail.final_batch_state,  # type: ignore[arg-type]
            active_job_id=detail.active_job_id,
            created_at=meeting.created_at,
            updated_at=meeting.updated_at,
        )


# --- 트랜스크립트 (SPEC-007 §4) -------------------------------------------


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
