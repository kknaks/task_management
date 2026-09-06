"""enum 값의 정본(database/README.md G-3 · G-4).

Postgres native ENUM 을 쓰지 않는다 — `varchar` + `CHECK` 로 잡고 값의 정본은 여기다.
값은 **영문 소문자 snake_case** 로 저장한다. 한국어 라벨은 프론트가 매핑한다.
"""

from __future__ import annotations

from enum import StrEnum


class WorkTypeKind(StrEnum):
    """유형이 속하는 상위 축(DEC-001 §3)."""

    MEETING = "meeting"
    TASK = "task"


class ColorToken(StrEnum):
    """허용 팔레트 토큰명 8종(A-5 · SPEC-002 §4).

    자유 색상(임의 hex)을 저장하지 않는다. hex 는 프론트 토큰이 갖는다.
    """

    INDIGO = "indigo"
    VIOLET = "violet"
    STEEL = "steel"
    MINT = "mint"
    SKY = "sky"
    AMBER = "amber"
    ROSE = "rose"
    GRAPHITE = "graphite"


class TaskStatus(StrEnum):
    """업무 상태 **4종만**(T-4).

    **「지연」은 값이 아니다** — 기한 경과 + 완료·취소 아님으로 조회 시 파생한다(G-7).
    전이 규칙과 완료 게이트는 **WORK-005** 가 갖는다. 이 work 는 생성 시 `TODO` 만 쓴다.
    """

    TODO = "todo"
    IN_PROGRESS = "in_progress"
    DONE = "done"
    CANCELLED = "cancelled"


# 「미완료」의 정본이다(SPEC-004 §4 「미완료는 todo·in_progress 다. 정의를 코드 한 곳에 둔다」).
#
# **문자열을 흩지 않는다** — 조회 규칙 R-2·R-3 와 지연 파생(`derive_overdue`)이 같은 뜻의
# 「아직 안 끝났다」를 각자 적으면 한쪽만 고쳐지는 날이 온다. 여기가 그 한 곳이다.
UNFINISHED_STATUSES = frozenset({TaskStatus.TODO.value, TaskStatus.IN_PROGRESS.value})
# 종결 2종 — R-4 가 이것들만 **실적 시각**으로 거른다(`due_date` 로 거르지 않는다).
FINISHED_STATUSES = frozenset({TaskStatus.DONE.value, TaskStatus.CANCELLED.value})


class AttachmentRole(StrEnum):
    """첨부의 쓰임 축 — 참고자료 / 결과자료(T-9).

    `DELIVERABLE` 이 1건 이상인지가 완료 게이트의 한 축이다(T-5 · 판정은 WORK-005).
    """

    REFERENCE = "reference"
    DELIVERABLE = "deliverable"


class AttachmentKind(StrEnum):
    """첨부의 대상 축 — 자료함 문서 / URL 링크(T-9).

    `kind` 에 따라 채워지는 컬럼이 갈린다(T-9-a) — `DOC` 은 `document_id` 만,
    `LINK` 는 `url`·`label` 만.
    """

    DOC = "doc"
    LINK = "link"


class TaskSort(StrEnum):
    """목록 정렬 3종(SPEC-004 §4). 기본은 `DUE_ASC` 이고 **기한 없는 업무는 맨 아래**다(T-1-a)."""

    DUE_ASC = "due_asc"
    DUE_DESC = "due_desc"
    CREATED_DESC = "created_desc"


class RelationCandidateScope(StrEnum):
    """연관업무 후보를 **잘라내는 필터**(SPEC-003 §4 · U-8 필터 칩 3 과 1:1).

    저장되는 값이 아니라 **요청 어휘**다 — 그래도 값의 정본을 한 곳에 두려고 여기 둔다.
    router 가 이 타입으로 받으면 세 값 밖은 FastAPI 가 422 로 거른다(손으로 잡지 않는다).

    `projectId`·`dueDate` 와 **역할이 다르다** — 그 둘은 정렬 근거이고 이것은 필터다.
    """

    PROJECT = "project"
    RECENT30 = "recent30"
    ALL = "all"


class ScheduleSourceType(StrEnum):
    """`schedule` 의 원본 종류(C-1 · §3-1).

    v2 의 `external`(외부 캘린더)은 **지금 만들지 않는다**(G-8) — 그때 CHECK 를 넓힌다.
    """

    TASK = "task"
    MEETING = "meeting"


# --- 회의 도메인 (WORK-006 · `domains/meeting.md`) ------------------------------


class MeetingStatus(StrEnum):
    """회의 상태 **4종** — `scheduled → recording → generating → ended` 한 방향(M-3 · DEC-003 §4).

    「예정」·「기록 중」·「생성중」·「종료」는 표시 매핑이다(G-4). 취소 상태는 없다 — 회의는 지우는 것뿐이다.
    상태를 대입하는 코드는 `meeting_service` 의 전이 함수(이 work 는 `start()` 하나)가 부르는
    repository 함수 안에만 있다.
    """

    SCHEDULED = "scheduled"
    RECORDING = "recording"
    GENERATING = "generating"
    ENDED = "ended"


class IntegrationState(StrEnum):
    """통합 결과 — `status` 와 **다른 축**이다(M-4). `ended + failed` 가 「다시 생성」의 조건이다."""

    NOT_STARTED = "not_started"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class MeetingTrack(StrEnum):
    """안건·줄의 트랙 3종(M-5-a). 이 work 는 **`HUMAN` 만** 만든다 — `AI` 는 WORK-007, `MERGED` 는 WORK-008."""

    HUMAN = "human"
    AI = "ai"
    MERGED = "merged"


class LineKind(StrEnum):
    """줄의 종류(ERD `meeting_line.kind`). 이 work 는 줄을 읽기만 한다."""

    DISCUSSION = "discussion"
    DECISION = "decision"
    TASK = "task"
    ACTION = "action"


class AgendaState(StrEnum):
    """안건 상태(M-5-c). **시작 전에는 `NULL`** 이라 값 자체는 회의 중·종료 후의 것이다.

    `ACTIVE`「논의 중」· `DONE`「완료」· `NEXT`「대기」. 이 work 는 값을 쓰지 않고 자리만 둔다(WORK-007).
    """

    NEXT = "next"
    ACTIVE = "active"
    DONE = "done"


class BatchPhase(StrEnum):
    """`meeting_batch_run.phase`. 이 work 는 행을 만들지 않는다 — CHECK 값의 정본만 둔다."""

    INCREMENTAL = "incremental"
    FINAL = "final"
    INTEGRATION = "integration"


class BatchRunStatus(StrEnum):
    """`meeting_batch_run.status`(DEC-003 §7 · M-16). `latestBatchSeq` 는 `SUCCEEDED` 분의 최대 `seq` 다."""

    SUCCEEDED = "succeeded"
    DISCARDED = "discarded"
    FAILED = "failed"


class MeetingSort(StrEnum):
    """회의록 목록 정렬 2종(SPEC-006 §4). 기본은 `LATEST`(`startAt` 내림차순)."""

    LATEST = "latest"
    OLDEST = "oldest"
