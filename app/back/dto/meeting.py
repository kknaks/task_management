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
    "LineCreateDTO",
    "LineNewTaskDTO",
    "LinePayloadJson",
    "LineUpdateDTO",
    "LineTaskUpdateDTO",
    "MeetingAiContextDTO",
    "MeetingTaskFilterDTO",
    "TaskContextDTO",
    "TranscriptBlockDTO",
    "TranscriptDTO",
    "TranscriptItemDTO",
    "BatchRunDTO",
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
    """`kind='task'` 줄이 가리키는 업무 요약(SPEC-008 이 정의 · 이 work 는 자리만). 삭제돼도 제목을 그대로 담는다.

    `work_type` — AI 업무 줄의 **유형 배지 원천**(SPEC-007 §4 LineItem · U-4 · Data Contract). 업무의 유형과 같은 것이라
    `WorkTypeRefDTO` 를 그대로 쓴다(WORK-007 검수 F-1).
    """

    id: int
    title: str
    status: str
    due_date: date | None
    is_deleted: bool
    work_type: WorkTypeRefDTO


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
    payload: dict | None
    task: LineTaskSummaryDTO | None
    # SPEC-007 §4 `createdAt` — 줄 우측 시각 · 안건 시각(`min(createdAt)`)의 원천
    created_at: datetime


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
    """요약 바 우측 「안건 n · 논의 n · 결정 n · 액션 n · 업무 n」— **파생 다섯**(SPEC-008 §4 Data Contract).

    저장하지 않는다. `integratedAt` 은 **없다** — 통합 단계가 사라져(MF-56) 가리킬 시각이 없다.
    """

    agenda_count: int
    discussion_count: int
    decision_count: int
    action_count: int
    task_count: int


@dataclass(frozen=True)
class MeetingDetailDTO:
    """`MeetingDetail` — SPEC-006 §4 필드 소유 표의 전 필드.

    **이 dto 를 만드는 곳은 `meeting_service.build_detail()` 하나다.** 상세·생성·PATCH·`/start`·
    안건·첨부 응답이 전부 거기를 지난다. WORK-007·008 은 그 함수에 값을 더한다.
    파생값(`duration_minutes` · `latest_batch_seq` · `merged_summary` · `active_job_id`)은
    **서버가 계산**하고 컬럼으로 두지 않는다(G-7).
    """

    meeting: MeetingDTO
    duration_minutes: int
    headline: str | None
    merged_summary: MergedSummaryDTO | None
    agendas: MeetingAgendaTracksDTO
    attachments: list[MeetingAttachmentDTO]
    latest_batch_seq: int
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

    `title` 은 WORK-006(시작 전) · `state` 는 WORK-007(회의 중 `active`·`done`·`next`)이 연다.
    `active` 최대 하나 · `done` 시 다음 활성 전환의 의미는 `meeting_service.update_agenda()` 가 갖는다.
    """

    title: str | Unset = UNSET
    state: str | Unset = UNSET


# `payload` 는 **줄에 붙는 JSON 그대로**다(M-14-a) — 액션 줄 = 생성분 · 업무 줄 = 변경분, 두 모양.
# 값의 모양을 보는 것은 **스키마 층 하나**이고(`schemas.meeting.ActionLinePayload` · `TaskLinePayload`),
# 여기서부터 아래로는 **저장 형태(camelCase dict)를 그대로 나른다** — service 는 payload 를 해석하지 않는다.
# 「넣기」의 요청은 줄의 저장값이 아니라 드로어가 보낸 본문(`LineTaskUpdateDTO`)이다(MF-59 · SPEC-008 §4).
LinePayloadJson = dict[str, object]


@dataclass(frozen=True)
class LineNewTaskDTO:
    """`POST …/lines/{id}/task` 본문 — 액션 줄 「넣기」의 업무 생성분(SPEC-008 U-10).

    규칙은 SPEC-003 `POST /api/tasks` 그대로다(`todos[]` 포함 · 첨부 · 연관은 받지 않는다).
    **줄에 저장된 `payload` 를 서버가 그대로 쓰지 않는다** — 사람이 드로어에서 확인·수정한 값이 이 본문이다.
    """

    title: str
    work_type_id: int
    project_id: int | None = None
    start_date: date | None = None
    due_date: date | None = None
    description: str | None = None
    todos: tuple[str, ...] = ()


@dataclass(frozen=True)
class LineCreateDTO:
    """`POST …/lines` — 사람 줄 하나. 회의 중(SPEC-007 §4)과 종료 후 편집(SPEC-008 §4)이 **같은 표면**이다.

    회의 중에는 `agenda_id`·`kind`·`content` 만 — `detail`·`task_id`·`payload` 는 **`ended` 에서만** 받고
    `recording` 에서 오면 `meeting_edit_service` 가 `validation_error` 로 거른다(SPEC-007 규칙 유지).
    **`content` 는 네 종류 모두 필수다**(서버가 업무 제목으로 채우는 갈래가 없다 — SPEC-008 §4 Validation).
    `payload`·`task_id` 가 어느 종류에 실릴 수 있는지는 **스키마 층**이 `kind` 로 가른다(줄과 업무를 함께 만드는 갈래는 폐기됐다).
    """

    agenda_id: int
    kind: str
    content: str
    detail: str | None = None
    task_id: int | None = None
    payload: LinePayloadJson | None = None


@dataclass(frozen=True)
class LineUpdateDTO:
    """`PATCH …/lines/{id}` — **보낸 필드만**(SPEC-008 §4). `content` · `payload` · `task_id` 셋뿐이다.

    **`kind` 가 없다**(MF-60 — 줄 종류를 바꾸는 표면이 없다). `payload_kind` 는 스키마가 알아본 `payload` 의 모양
    (`action` = 생성분 · `task` = 변경분)이고, **그 줄의 종류와 같은지**는 service 가 본다 — PATCH 본문에는 `kind` 가 없어
    스키마 혼자서는 알 수 없다. `payload`·`task_id` 는 `None` 으로 **비울 수 있다**(「보내지 않음」과 다르다).
    """

    content: str | Unset = UNSET
    payload: LinePayloadJson | None | Unset = UNSET
    payload_kind: str | Unset = UNSET
    task_id: int | None | Unset = UNSET


@dataclass(frozen=True)
class LineTaskUpdateDTO:
    """`PATCH …/lines/{id}/task` 본문 — 업무 줄 「넣기」(SPEC-008 §4 ①~⑧ · MF-59).

    `task_id` 는 **필수**(드로어 헤더 셀렉터의 업무 — 줄에 저장된 값과 달라도 이 값이 이긴다).
    나머지 일곱은 **변경분**이고 「보내지 않음」(`UNSET`)과 값이 있는 것만 구분한다 — 0개도 받는다(⑧ 만 일어난다).
    """

    task_id: int
    due_date: date | Unset = UNSET
    status: str | Unset = UNSET
    note: str | Unset = UNSET
    todos: tuple[str, ...] | Unset = UNSET
    related_task_ids: tuple[int, ...] | Unset = UNSET
    project_id: int | Unset = UNSET
    completion_result: str | Unset = UNSET


# --- 회의 중 (SPEC-007) ----------------------------------------------------


@dataclass(frozen=True)
class TranscriptItemDTO:
    """확정 발화 블록 한 건(M-9). `at_ms`·`end_ms` 는 `recording_started_at` 기준 오프셋(M-11)."""

    id: int
    speaker_label: str
    at_ms: int
    end_ms: int
    content: str
    created_at: datetime


@dataclass(frozen=True)
class TranscriptDTO:
    """`GET …/transcript` — `at_ms` 순 전량 + 화자 수 + 기준점."""

    recording_started_at: datetime | None
    speaker_count: int
    items: list[TranscriptItemDTO]


@dataclass(frozen=True)
class TranscriptBlockDTO:
    """확정 발화 블록 하나 — 아직 행이 아닌 값(`meeting_transcript_blocks` 가 만들고 repository 가 적재한다).

    실시간·재전사가 **같은 모양**을 낸다(M-9-a).
    """

    speaker_label: str
    at_ms: int
    end_ms: int
    content: str


@dataclass(frozen=True)
class MeetingAiContextDTO:
    """배치·웜스타트가 읽는 회의의 서버 내부값 — `ai_session_id` 는 **여기서만** 읽는다(응답에 싣지 않는다)."""

    id: int
    account_id: int
    title: str
    project_id: int | None
    project_name: str | None
    status: str
    # ① 재전사가 「직전 회의」를 가르는 기준(M-1 — 예정 일시)
    start_at: datetime
    recording_started_at: datetime | None
    # ① 재전사가 올릴 녹음 원본. **응답에 싣지 않는다**(SPEC-006 §4)
    recording_path: str | None
    ai_session_id: str | None


@dataclass(frozen=True)
class MeetingTaskFilterDTO:
    """`GET /api/meetings/current/tasks` 의 `projectId` — **세 갈래를 타입으로 나눈다.**

    - `(None, False)` — 쿼리 생략. **그 회의의 프로젝트**(무소속 회의면 무소속 업무 · DEC-003 §4 L98)
    - `(None, True)` — `projectId=none`. 무소속 업무
    - `(id, False)` — 그 프로젝트

    `"none"` 이라는 **HTTP 인코딩은 router 가 푼다** — service 는 문자열을 모른다
    (`backend/README.md` §2 계층 · §3 · 회의 목록의 `MeetingListFilterDTO` 와 같은 자리).
    """

    project_id: int | None
    unassigned_only: bool


@dataclass(frozen=True)
class TaskContextDTO:
    """회의가 보는 업무 한 줄. **AI 가 보는 목록 = 서버가 검사하는 목록**이다 —
    웜스타트 업무 목록(SPEC-007 §4)이자 화이트리스트(M-15)이자 도구 `list_tasks` 의 응답이다.

    `project_name` 은 SPEC-007 §4 도구 표의 「프로젝트」 — 무소속이면 `None`.
    """

    id: int
    title: str
    status: str
    due_date: date | None
    work_type_name: str
    project_name: str | None


@dataclass(frozen=True)
class BatchRunDTO:
    id: int
    seq: int
    from_transcript_id: int | None
    to_transcript_id: int | None
    phase: str
    status: str
    reason: str | None
    # SPEC-008 §4 — 「종결 · HH:MM」(최종 배치 성공 시각) · `mergedSummary.integratedAt` 의 원천
    created_at: datetime


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
