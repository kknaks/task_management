"""meeting 도메인 — 회의록 본체와 자식 5종(안건 · 줄 · 트랜스크립트 · 첨부 · 배치 이력).

정본은 `40-architecture/database/README.md` §1 ERD · §4 인덱스 와
`domains/meeting.md` 의 불변식(M-1~M-20, 2026-09-06 개정판)이다.

**회의록이 일시를 소유한다**(M-1). `start_at`·`end_at` 은 여기 있고 `schedule` 은 그 **파생**이다 —
이 work 는 `schedule` 을 `service/schedule_service.sync_from_meeting()` 을 통해서만 만든다(SCH-1).

**첨부 `kind` 값의 정본은 `dto.enums.AttachmentKind`** 다 — 업무 첨부(T-9)와 같은 두 갈래
(`doc` · `link`)이고 같은 값이라 enum 을 둘로 두지 않는다(WP 의 `MeetingAttachmentKind` 자리).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from dto.enums import (
    AgendaState,
    AttachmentKind,
    BatchPhase,
    BatchRunStatus,
    IntegrationState,
    LineKind,
    MeetingStatus,
    MeetingTrack,
)
from models.base import Base, TimestampMixin, pk_column

_STATUS_VALUES = ", ".join(f"'{value}'" for value in MeetingStatus)
_INTEGRATION_VALUES = ", ".join(f"'{value}'" for value in IntegrationState)
_TRACK_VALUES = ", ".join(f"'{value}'" for value in MeetingTrack)
_LINE_KIND_VALUES = ", ".join(f"'{value}'" for value in LineKind)
_AGENDA_STATE_VALUES = ", ".join(f"'{value}'" for value in AgendaState)
_ATTACHMENT_KIND_VALUES = ", ".join(f"'{value}'" for value in AttachmentKind)
_BATCH_PHASE_VALUES = ", ".join(f"'{value}'" for value in BatchPhase)
_BATCH_STATUS_VALUES = ", ".join(f"'{value}'" for value in BatchRunStatus)


class Meeting(Base, TimestampMixin):
    """회의록 본체. **일시(`start_at`/`end_at`)를 소유**하고 둘 다 NOT NULL 이다(M-1).

    M-1-a — `start_at` 은 **예정**, `recording_started_at` 은 **실적**(`/start` 성공 시각).
    M-2 — `work_type_id` 는 `kind='meeting'` 유형만(판정은 service).
    M-3 — `status` 4종 / M-4 — `integration_state` 는 다른 축.
    M-13 — `recording_path` 는 **영구 보관**. 소프트 딜리트가 파일을 건드리지 않는다.
    M-19 — `ai_headline` 은 통합(WORK-008)이 채운다. 이 work 는 읽어 그릴 뿐이다.
    """

    __tablename__ = "meeting"

    id: Mapped[int] = pk_column()
    account_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("account.id", name="fk_meeting_account_id"), nullable=False
    )
    work_type_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("work_type.id", name="fk_meeting_work_type_id"),
        nullable=False,
    )
    # NULL 이 「프로젝트 없음」이다(DEC-003 §3 무소속 허용).
    project_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("project.id", name="fk_meeting_project_id"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)

    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # `/start` 가 채운다. 한 번 채우면 바꾸지 않는다(M-1-a · 회의 시작은 한 번뿐).
    recording_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        server_default=text(f"'{MeetingStatus.SCHEDULED.value}'"),
    )
    integration_state: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        server_default=text(f"'{IntegrationState.NOT_STARTED.value}'"),
    )
    ai_headline: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 서버 내부값 둘 — 상세 응답에 싣지 않는다(SPEC-006 §4). WORK-007 이 채운다.
    recording_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    ai_session_id: Mapped[str | None] = mapped_column(String(200), nullable=True)

    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        # G-3 — enum 은 varchar + CHECK
        CheckConstraint(f"status IN ({_STATUS_VALUES})", name="ck_meeting_status"),
        CheckConstraint(
            f"integration_state IN ({_INTEGRATION_VALUES})",
            name="ck_meeting_integration_state",
        ),
        # M-1 — 일시는 뒤집히지 않는다. 길이 5~300분은 service 가 먼저 422 로 거른다(M-18)
        CheckConstraint("end_at > start_at", name="ck_meeting_time_order"),
        # §4 — 목록 월 범위 조회·정렬(SPEC-006 §7 · 2026-09-06 부분 인덱스로 개정)
        Index(
            "ix_meeting_account_id_start_at_active",
            "account_id",
            "start_at",
            postgresql_where=text("deleted_at IS NULL"),
        ),
        # §4 — 목록 상태 표기
        Index(
            "ix_meeting_account_id_status_active",
            "account_id",
            "status",
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


class MeetingAgenda(Base, TimestampMixin):
    """안건 — **트랙별**이다(M-5-a). 「안건 > 줄」 트리가 트랙마다 하나씩 있다.

    이 work 는 `track='human'` 만 만든다. `state` 는 시작 전 `NULL`(M-5-c),
    `source_agenda_id` 는 `ai`·`merged` 안건이 가리키는 원본이고 `human` 은 항상 `NULL`(M-5-b · CHECK).
    자식 행이라 **하드 삭제**다(DB §0-1).
    """

    __tablename__ = "meeting_agenda"

    id: Mapped[int] = pk_column()
    meeting_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("meeting.id", name="fk_meeting_agenda_meeting_id"),
        nullable=False,
    )
    track: Mapped[str] = mapped_column(String(10), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)
    state: Mapped[str | None] = mapped_column(String(10), nullable=True)
    source_agenda_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("meeting_agenda.id", name="fk_meeting_agenda_source_agenda_id"),
        nullable=True,
    )

    __table_args__ = (
        CheckConstraint(f"track IN ({_TRACK_VALUES})", name="ck_meeting_agenda_track"),
        # M-5-c — NULL 허용 + 3종
        CheckConstraint(
            f"state IS NULL OR state IN ({_AGENDA_STATE_VALUES})",
            name="ck_meeting_agenda_state",
        ),
        # M-5-b — 사람 안건은 원본을 가리키지 않는다
        CheckConstraint(
            f"track <> '{MeetingTrack.HUMAN.value}' OR source_agenda_id IS NULL",
            name="ck_meeting_agenda_human_has_no_source",
        ),
        # §4 · M-5-c — 사람 트랙의 「논의 중」 안건은 최대 하나
        Index(
            "uq_meeting_agenda_human_active",
            "meeting_id",
            unique=True,
            postgresql_where=text(
                f"track = '{MeetingTrack.HUMAN.value}'"
                f" AND state = '{AgendaState.ACTIVE.value}'"
            ),
        ),
        Index(
            "ix_meeting_agenda_meeting_id_track_order_index",
            "meeting_id",
            "track",
            "order_index",
        ),
    )


class MeetingLine(Base, TimestampMixin):
    """줄 — **3트랙 한 테이블**(`domains/meeting.md` 「왜 줄이 세 테이블이 아닌가」).

    M-5 — `agenda_id` NOT NULL(줄은 항상 안건에 속한다).
    M-8-a — `source_*_line_id` 는 `track='merged'` 에서만 값을 갖고(CHECK), 각각 부분 UNIQUE 다.
    **이 work 는 읽기만 한다**(상세 응답 조립). 쓰기는 WORK-007·008.
    `task_id` 는 FK 를 건다 — `task` 테이블은 이미 있다(WORK-004).
    """

    __tablename__ = "meeting_line"

    id: Mapped[int] = pk_column()
    meeting_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("meeting.id", name="fk_meeting_line_meeting_id"),
        nullable=False,
    )
    agenda_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("meeting_agenda.id", name="fk_meeting_line_agenda_id"),
        nullable=False,
    )
    track: Mapped[str] = mapped_column(String(10), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    # `[{fromMs, toMs}]` — 근거 타임칩. 기준점은 `meeting.recording_started_at`(M-11)
    evidence: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)
    # M-14 — 버튼을 눌러 업무가 실제로 생기거나 연결됐을 때만 채워진다
    task_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("task.id", name="fk_meeting_line_task_id"), nullable=True
    )
    # M-14-a — 기한 · 상태 · note 셋뿐
    pending_change: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    source_human_line_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("meeting_line.id", name="fk_meeting_line_source_human_line_id"),
        nullable=True,
    )
    source_ai_line_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("meeting_line.id", name="fk_meeting_line_source_ai_line_id"),
        nullable=True,
    )

    __table_args__ = (
        CheckConstraint(f"track IN ({_TRACK_VALUES})", name="ck_meeting_line_track"),
        CheckConstraint(f"kind IN ({_LINE_KIND_VALUES})", name="ck_meeting_line_kind"),
        # M-8-a — 통합 줄만 원본을 가리킨다. 다른 트랙은 둘 다 NULL
        CheckConstraint(
            f"track = '{MeetingTrack.MERGED.value}'"
            " OR (source_human_line_id IS NULL AND source_ai_line_id IS NULL)",
            name="ck_meeting_line_source_only_merged",
        ),
        # §4 — 탭 하나 = 트랙 하나를 통째로 읽는다
        Index(
            "ix_meeting_line_meeting_id_track_agenda_id_order_index",
            "meeting_id",
            "track",
            "agenda_id",
            "order_index",
        ),
        # §4 · M-8-a — 이중 계승 · 중복 AI 참조 금지
        Index(
            "uq_meeting_line_source_human_line_id",
            "source_human_line_id",
            unique=True,
            postgresql_where=text("source_human_line_id IS NOT NULL"),
        ),
        Index(
            "uq_meeting_line_source_ai_line_id",
            "source_ai_line_id",
            unique=True,
            postgresql_where=text("source_ai_line_id IS NOT NULL"),
        ),
    )


class MeetingTranscript(Base, TimestampMixin):
    """확정 발화 블록(M-9). 이 work 는 테이블만 세우고 행을 만들지 않는다(WORK-007).

    M-10 — `speaker_label` 은 익명(「화자 1」). 이름 컬럼을 두지 않는다.
    M-11 — `at_ms` 는 `recording_started_at` 기준 오프셋이다.
    """

    __tablename__ = "meeting_transcript"

    id: Mapped[int] = pk_column()
    meeting_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("meeting.id", name="fk_meeting_transcript_meeting_id"),
        nullable=False,
    )
    speaker_label: Mapped[str] = mapped_column(String(50), nullable=False)
    at_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    end_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        CheckConstraint("end_ms >= at_ms", name="ck_meeting_transcript_ms_order"),
        # §4 — 근거 칩 클릭 → 해당 발화로 스크롤
        Index("ix_meeting_transcript_meeting_id_at_ms", "meeting_id", "at_ms"),
    )


class MeetingAttachment(Base, TimestampMixin):
    """첨부 — **md 문서 · URL 링크 두 갈래**(M-17 · 2026-09-06 개정). `task_attachment` 와 같은 모양.

    **`document_id` 에 FK 를 걸지 않는다** — 대상 `document` 테이블이 아직 없다.
    컬럼·CHECK·부분 UNIQUE 는 최종 형태로 두고 **문서함 work 가 FK 추가 리비전을 낸다**
    (WORK-006 §Open Issues — WORK-004 와 같은 임시 계약).
    """

    __tablename__ = "meeting_attachment"

    id: Mapped[int] = pk_column()
    meeting_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("meeting.id", name="fk_meeting_attachment_meeting_id"),
        nullable=False,
    )
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    # FK 없음 — 위 docstring 참조.
    document_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    label: Mapped[str | None] = mapped_column(String(100), nullable=True)

    __table_args__ = (
        CheckConstraint(
            f"kind IN ({_ATTACHMENT_KIND_VALUES})", name="ck_meeting_attachment_kind"
        ),
        # M-17 — `kind` 에 따라 채워지는 컬럼이 갈린다(T-9-a 와 같다).
        # `doc` 이면 `document_id` 만 / `link` 면 `url`(+선택 `label`) 만.
        CheckConstraint(
            f"(kind = '{AttachmentKind.DOC.value}'"
            " AND document_id IS NOT NULL AND url IS NULL AND label IS NULL)"
            f" OR (kind = '{AttachmentKind.LINK.value}'"
            " AND url IS NOT NULL AND document_id IS NULL)",
            name="ck_meeting_attachment_kind_columns",
        ),
        # §4 — 같은 문서 중복 첨부 금지. 링크는 URL 중복을 막지 않는다(정책에 없다)
        Index(
            "uq_meeting_attachment_meeting_id_document_id",
            "meeting_id",
            "document_id",
            unique=True,
            postgresql_where=text("document_id IS NOT NULL"),
        ),
        Index("ix_meeting_attachment_meeting_id", "meeting_id"),
    )


class MeetingBatchRun(Base, TimestampMixin):
    """배치 실행 이력 — 실패 구간을 다음 배치로 넘기는 커서(DEC-003 §7 · M-16).

    이 work 는 행을 만들지 않는다. `latestBatchSeq` 파생이 `status='succeeded'` 최대 `seq` 를 읽는다(M-6-a).
    """

    __tablename__ = "meeting_batch_run"

    id: Mapped[int] = pk_column()
    meeting_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("meeting.id", name="fk_meeting_batch_run_meeting_id"),
        nullable=False,
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    from_transcript_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    to_transcript_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    phase: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint(
            f"phase IN ({_BATCH_PHASE_VALUES})", name="ck_meeting_batch_run_phase"
        ),
        CheckConstraint(
            f"status IN ({_BATCH_STATUS_VALUES})", name="ck_meeting_batch_run_status"
        ),
        # §4 — 재시도 구간 커서
        Index("ix_meeting_batch_run_meeting_id_seq", "meeting_id", "seq"),
    )
