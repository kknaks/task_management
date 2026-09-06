"""회의 도메인의 내부 계층 이동용 dto — 프론트 계약이 아니다(§3).

**입력도 dto 다**(§3 규칙 3). 부분 수정은 `T | Unset` 로 「보내지 않음」과
「`null` 로 지움」을 구분한다(§3 규칙 4).

유형·프로젝트 참조(`WorkTypeRefDTO` · `ProjectRefDTO`)는 업무와 **같은 것**이라 `dto.task` 의 것을 쓴다 —
삭제된 것도 이름·색을 그대로 담고 `is_deleted` 로 알린다(A-6).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime

from dto.task import ProjectRefDTO, WorkTypeRefDTO
from dto.unset import UNSET, Unset

__all__ = [
    "AgendaCreateDTO",
    "AgendaUpdateDTO",
    "LineTaskSummaryDTO",
    "MeetingAgendaDTO",
    "MeetingAgendaTracksDTO",
    "MeetingAttachmentCreateDTO",
    "MeetingAttachmentDTO",
    "MeetingCreateDTO",
    "MeetingDTO",
    "MeetingDetailDTO",
    "MeetingLineDTO",
    "MeetingListFilterDTO",
    "MeetingListItemDTO",
    "MeetingListResultDTO",
    "MeetingUpdateDTO",
    "MergedSummaryDTO",
    "ProjectCountDTO",
    "ProjectRefDTO",
    "WorkTypeRefDTO",
]


@dataclass(frozen=True)
class MeetingDTO:
    """회의록 본체 한 건. 자식은 담지 않는다.

    `recording_path`·`ai_session_id` 는 **서버 내부값**이라 여기 없다 — 상세에 싣지 않는다(SPEC-006 §4).
    이 work 의 어떤 경로도 둘을 읽지 않는다.
    """

    id: int
    title: str
    status: str
    integration_state: str
    work_type: WorkTypeRefDTO
    project: ProjectRefDTO | None
    # M-1 — 예정 일시(회의록이 소유)
    start_at: datetime
    end_at: datetime
    # M-1-a — 실적. `/start` 가 채우고 그전엔 None
    recording_started_at: datetime | None
    # M-19 — 통합(WORK-008)이 채운다
    ai_headline: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class LineTaskSummaryDTO:
    """`kind='task'` 줄이 가리키는 업무 요약(SPEC-008 이 정의 · 이 work 는 자리만). 삭제돼도 제목을 그대로 담는다."""

    id: int
    title: str
    status: str
    due_date: date | None
    is_deleted: bool


@dataclass(frozen=True)
class MeetingLineDTO:
    """줄 한 건 — 형태는 ERD `meeting_line` 그대로. **의미·쓰기는 SPEC-007·008** 이 정본이다."""

    id: int
    track: str
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
    task: LineTaskSummaryDTO | None


@dataclass(frozen=True)
class MeetingAgendaDTO:
    """안건 한 건 + 딸린 줄. 트랙별 트리의 노드다(M-5-a)."""

    id: int
    track: str
    title: str
    order_index: int
    state: str | None
    source_agenda_id: int | None
    lines: list[MeetingLineDTO] = field(default_factory=list)


@dataclass(frozen=True)
class MeetingAgendaTracksDTO:
    """`agendas.{human, ai, merged}` — **세 키가 항상 있고** 비어 있으면 `[]` 다(SPEC-006 §4)."""

    human: list[MeetingAgendaDTO]
    ai: list[MeetingAgendaDTO]
    merged: list[MeetingAgendaDTO]


@dataclass(frozen=True)
class MeetingAttachmentDTO:
    """첨부 두 갈래(M-17).

    `doc` 갈래의 `name`·`folder_path`·`size_bytes`·`is_deleted` 는 `document` 에서 와야 하는데
    **문서함이 아직 없다** — `doc` 요청 자체를 거부하므로(§Open Issues) 이 갈래로 오는 행이 없다.
    링크는 `name` = `label` 또는 URL, `updated_at` = 첨부 시각, `is_deleted` = 항상 False.
    """

    id: int
    kind: str
    name: str
    document_id: int | None
    folder_path: str | None
    size_bytes: int | None
    updated_at: datetime
    url: str | None
    is_deleted: bool


@dataclass(frozen=True)
class MergedSummaryDTO:
    """요약 바 우측 「안건 n · 결정 n · 액션 n」— **파생**, 통합 전 None(SPEC-008 이 채운다)."""

    agenda_count: int
    decision_count: int
    action_count: int
    integrated_at: datetime


@dataclass(frozen=True)
class MeetingDetailDTO:
    """`MeetingDetail` — SPEC-006 §4 필드 소유 표의 전 필드.

    **이 dto 를 만드는 곳은 `meeting_service.build_detail()` 하나다.** 상세·생성·PATCH·`/start`·
    안건·첨부 응답이 전부 거기를 지난다. WORK-007·008 은 그 함수에 값을 더한다.
    파생값(`duration_minutes` · `latest_batch_seq` · `merged_summary` · `final_batch_state` · `active_job_id`)은
    **서버가 계산**하고 컬럼으로 두지 않는다(G-7).
    """

    meeting: MeetingDTO
    duration_minutes: int
    headline: str | None
    merged_summary: MergedSummaryDTO | None
    agendas: MeetingAgendaTracksDTO
    attachments: list[MeetingAttachmentDTO]
    latest_batch_seq: int
    final_batch_state: str | None
    active_job_id: int | None


# --- 목록 ---------------------------------------------------------------


@dataclass(frozen=True)
class MeetingListItemDTO:
    """목록 항목(SPEC-006 §4). `headline`·`agenda_titles`·`attachment_count` 는 파생 표시값이다.

    `agenda_titles` 는 **사람 트랙** 제목을 `order_index` 순으로 — 화면이 트리를 다시 조립하지 않는다.
    """

    id: int
    title: str
    status: str
    integration_state: str
    start_at: datetime
    end_at: datetime
    work_type: WorkTypeRefDTO
    project: ProjectRefDTO | None
    headline: str | None
    agenda_titles: list[str]
    attachment_count: int
    updated_at: datetime


@dataclass(frozen=True)
class ProjectCountDTO:
    """프로젝트 칩에 붙는 수. `project_id` 가 None 이면 「미정」이다. 삭제된 프로젝트도 이름·색 그대로."""

    project_id: int | None
    name: str | None
    color_token: str | None
    count: int


@dataclass(frozen=True)
class MeetingListFilterDTO:
    """목록 조건. `from`·`to` 는 UTC 경계 `[from, to)` 이고 **`start_at` 기준**이다.

    `unassigned_only=True` 가 `projectId=none`(무소속)이다 — `project_id=None` 은 「필터 없음」이라 뜻이 다르다.
    """

    period_from: datetime
    period_to: datetime
    project_id: int | None = None
    unassigned_only: bool = False
    sort: str = "latest"


@dataclass(frozen=True)
class MeetingListResultDTO:
    """`total` 은 필터 **적용 후**, `project_counts` 는 필터 **적용 전** 그 달 전체(SPEC-006 §4)."""

    items: list[MeetingListItemDTO]
    total: int
    project_counts: list[ProjectCountDTO]


# --- 입력 ---------------------------------------------------------------


@dataclass(frozen=True)
class AgendaCreateDTO:
    title: str


@dataclass(frozen=True)
class AgendaUpdateDTO:
    """`PATCH …/agendas/{id}` — **보낸 필드만**.

    `state` 는 **이 work 가 받지 않는다**(schema 에 없어 보내면 422) — 자리만 비워 둔다.
    WORK-007 이 schema 에 열고 service 의 `agenda_state` 갈래를 채운다(상태별 허용 표에 행은 이미 있다).
    """

    title: str | Unset = UNSET
    state: str | None | Unset = UNSET


@dataclass(frozen=True)
class MeetingAttachmentCreateDTO:
    kind: str
    document_id: int | None = None
    url: str | None = None
    label: str | None = None


@dataclass(frozen=True)
class MeetingCreateDTO:
    """생성은 **한 요청**이다 — 안건·첨부·`schedule` 파생이 본체와 같은 트랜잭션으로 저장된다(SPEC-006 §5).

    **`status` 가 없다** — 생성 시 항상 `scheduled` 다.
    """

    title: str
    work_type_id: int
    start_at: datetime
    end_at: datetime
    project_id: int | None = None
    agendas: list[AgendaCreateDTO] = field(default_factory=list)
    attachments: list[MeetingAttachmentCreateDTO] = field(default_factory=list)


@dataclass(frozen=True)
class MeetingUpdateDTO:
    """**`status` 가 없다** — 상태 전이는 전용 엔드포인트(`/start` · `/end`)다(SPEC-006 §4 · BE §10).
    필드가 없으니 일반 PATCH 로 상태를 보내면 스키마 층에서 422 다.

    일시는 **둘을 항상 함께** 보낸다 — 한쪽만 오면 service 가 `validation_error` 로 거른다(M-1 NOT NULL).
    `project_id=None`(보냄)은 무소속으로 바꾸는 뜻이고 `UNSET` 은 「보내지 않음」이다.
    """

    title: str | Unset = UNSET
    work_type_id: int | Unset = UNSET
    project_id: int | None | Unset = UNSET
    start_at: datetime | Unset = UNSET
    end_at: datetime | Unset = UNSET
