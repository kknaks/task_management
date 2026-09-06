"""meeting domain — meeting · meeting_agenda · meeting_line · meeting_transcript · meeting_attachment · meeting_batch_run

**한 리비전으로 6 테이블**(WORK-004 가 업무 6 테이블을 한 번에 세운 것과 같다). `job` 은 WORK-008.
기준은 `database/domains/meeting.md` **2026-09-06 개정판**(SPEC-006 §7 ERD 5건 + SPEC-007 §7-C 3건 반영분)이다.

`autogenerate` 초안을 사람이 읽고 고쳤다(database/README.md §0-2). 손으로 확인·수정한 것 —

- 리비전 id 를 레포 규약(`000N_<이름>`)으로 바꿨다
- CHECK — `status` 4종 · `integration_state` 4종 · `track` 3종 · `kind`(줄 4종 · 첨부 2종) ·
  `agenda.state` NULL 허용 3종 · **첨부 `kind` 별 컬럼**(`doc` 이면 `document_id` 만 / `link` 면 `url`·`label` 만) ·
  `human` 안건은 `source_agenda_id` NULL · 통합 줄만 `source_*_line_id` · 시각 순서
- **부분 인덱스** — `meeting (account_id, start_at) WHERE deleted_at IS NULL` ·
  `meeting (account_id, status) WHERE deleted_at IS NULL`
- **부분 UNIQUE** — `meeting_attachment (meeting_id, document_id) WHERE document_id IS NOT NULL` ·
  `meeting_agenda (meeting_id) WHERE track='human' AND state='active'` ·
  `meeting_line (source_human_line_id)` · `(source_ai_line_id)` 각각 `WHERE … IS NOT NULL`
- **`meeting_attachment.document_id` 에 FK 가 없다** — 대상 `document` 테이블이 아직 없다.
  컬럼·CHECK·부분 UNIQUE 는 최종 형태이고 **문서함 work 가 FK 추가 리비전을 낸다**(WORK-006 §Open Issues)
- `meeting_line.agenda_id` NOT NULL(M-5) · `meeting.start_at`·`end_at` NOT NULL(M-1)
- `schedule` 은 건드리지 않는다 — `source_type='meeting'` 행은 `schedule_service.sync_from_meeting` 이 만든다(SCH-1)
- downgrade — 생성 역순(자식 → 부모). **WORK-004 까지의 데이터에 영향이 없다**

Revision ID: 0005_meeting_domain
Revises: 0004_task_schedule
Create Date: 2026-09-06

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005_meeting_domain"
down_revision: str | None = "0004_task_schedule"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timestamps() -> list[sa.Column]:
    """G-6 — 공통 믹스인과 같은 두 컬럼."""
    return [
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    ]


def upgrade() -> None:
    # --- meeting — 회의록 본체(일시를 소유한다 — M-1) ------------------------
    op.create_table(
        "meeting",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("account_id", sa.BigInteger(), nullable=False),
        sa.Column("work_type_id", sa.BigInteger(), nullable=False),
        sa.Column("project_id", sa.BigInteger(), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=False),
        # M-1-a — `/start` 성공 시각(실적). 경과 시간·`at_ms` 의 기준점
        sa.Column("recording_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default=sa.text("'scheduled'"),
            nullable=False,
        ),
        sa.Column(
            "integration_state",
            sa.String(length=20),
            server_default=sa.text("'not_started'"),
            nullable=False,
        ),
        # M-19 — 통합(WORK-008)과 같은 응답에서 채운다
        sa.Column("ai_headline", sa.Text(), nullable=True),
        # M-13 — 영구 보관. 소프트 딜리트해도 안 지운다
        sa.Column("recording_path", sa.String(length=500), nullable=True),
        # M-12 — 회의 하나에 하나
        sa.Column("ai_session_id", sa.String(length=200), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.CheckConstraint(
            "status IN ('scheduled', 'recording', 'generating', 'ended')",
            name="ck_meeting_status",
        ),
        sa.CheckConstraint(
            "integration_state IN ('not_started', 'running', 'succeeded', 'failed')",
            name="ck_meeting_integration_state",
        ),
        sa.CheckConstraint("end_at > start_at", name="ck_meeting_time_order"),
        sa.ForeignKeyConstraint(
            ["account_id"], ["account.id"], name="fk_meeting_account_id"
        ),
        sa.ForeignKeyConstraint(
            ["work_type_id"], ["work_type.id"], name="fk_meeting_work_type_id"
        ),
        sa.ForeignKeyConstraint(
            ["project_id"], ["project.id"], name="fk_meeting_project_id"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    # §4 — 목록 월 범위 조회·정렬(SPEC-006 §7 · 부분 인덱스)
    op.create_index(
        "ix_meeting_account_id_start_at_active",
        "meeting",
        ["account_id", "start_at"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "ix_meeting_account_id_status_active",
        "meeting",
        ["account_id", "status"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    # --- meeting_agenda — 안건(트랙별 — M-5-a) --------------------------------
    op.create_table(
        "meeting_agenda",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("meeting_id", sa.BigInteger(), nullable=False),
        sa.Column("track", sa.String(length=10), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False),
        # M-5-c — 시작 전은 NULL
        sa.Column("state", sa.String(length=10), nullable=True),
        # M-5-b — ai·merged 가 가리키는 원본 안건. human 은 항상 NULL
        sa.Column("source_agenda_id", sa.BigInteger(), nullable=True),
        *_timestamps(),
        sa.CheckConstraint(
            "track IN ('human', 'ai', 'merged')", name="ck_meeting_agenda_track"
        ),
        sa.CheckConstraint(
            "state IS NULL OR state IN ('next', 'active', 'done')",
            name="ck_meeting_agenda_state",
        ),
        sa.CheckConstraint(
            "track <> 'human' OR source_agenda_id IS NULL",
            name="ck_meeting_agenda_human_has_no_source",
        ),
        sa.ForeignKeyConstraint(
            ["meeting_id"], ["meeting.id"], name="fk_meeting_agenda_meeting_id"
        ),
        sa.ForeignKeyConstraint(
            ["source_agenda_id"],
            ["meeting_agenda.id"],
            name="fk_meeting_agenda_source_agenda_id",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    # §4 · M-5-c — 사람 트랙의 「논의 중」 안건은 최대 하나
    op.create_index(
        "uq_meeting_agenda_human_active",
        "meeting_agenda",
        ["meeting_id"],
        unique=True,
        postgresql_where=sa.text("track = 'human' AND state = 'active'"),
    )
    op.create_index(
        "ix_meeting_agenda_meeting_id_track_order_index",
        "meeting_agenda",
        ["meeting_id", "track", "order_index"],
        unique=False,
    )

    # --- meeting_line — 줄(3트랙 한 테이블) ------------------------------------
    op.create_table(
        "meeting_line",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("meeting_id", sa.BigInteger(), nullable=False),
        # M-5 — 줄은 항상 안건에 속한다
        sa.Column("agenda_id", sa.BigInteger(), nullable=False),
        sa.Column("track", sa.String(length=10), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column(
            "evidence", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column("task_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "pending_change", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        # M-8-a — merged 만 값. 각각 부분 UNIQUE
        sa.Column("source_human_line_id", sa.BigInteger(), nullable=True),
        sa.Column("source_ai_line_id", sa.BigInteger(), nullable=True),
        *_timestamps(),
        sa.CheckConstraint(
            "track IN ('human', 'ai', 'merged')", name="ck_meeting_line_track"
        ),
        sa.CheckConstraint(
            "kind IN ('discussion', 'decision', 'task', 'action')",
            name="ck_meeting_line_kind",
        ),
        sa.CheckConstraint(
            "track = 'merged'"
            " OR (source_human_line_id IS NULL AND source_ai_line_id IS NULL)",
            name="ck_meeting_line_source_only_merged",
        ),
        sa.ForeignKeyConstraint(
            ["meeting_id"], ["meeting.id"], name="fk_meeting_line_meeting_id"
        ),
        sa.ForeignKeyConstraint(
            ["agenda_id"], ["meeting_agenda.id"], name="fk_meeting_line_agenda_id"
        ),
        sa.ForeignKeyConstraint(
            ["task_id"], ["task.id"], name="fk_meeting_line_task_id"
        ),
        sa.ForeignKeyConstraint(
            ["source_human_line_id"],
            ["meeting_line.id"],
            name="fk_meeting_line_source_human_line_id",
        ),
        sa.ForeignKeyConstraint(
            ["source_ai_line_id"],
            ["meeting_line.id"],
            name="fk_meeting_line_source_ai_line_id",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    # §4 — 탭 하나 = 트랙 하나를 통째로 읽는다
    op.create_index(
        "ix_meeting_line_meeting_id_track_agenda_id_order_index",
        "meeting_line",
        ["meeting_id", "track", "agenda_id", "order_index"],
        unique=False,
    )
    # §4 · M-8-a — 이중 계승 · 중복 AI 참조 금지
    op.create_index(
        "uq_meeting_line_source_human_line_id",
        "meeting_line",
        ["source_human_line_id"],
        unique=True,
        postgresql_where=sa.text("source_human_line_id IS NOT NULL"),
    )
    op.create_index(
        "uq_meeting_line_source_ai_line_id",
        "meeting_line",
        ["source_ai_line_id"],
        unique=True,
        postgresql_where=sa.text("source_ai_line_id IS NOT NULL"),
    )

    # --- meeting_transcript — 확정 발화 블록(M-9) ------------------------------
    op.create_table(
        "meeting_transcript",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("meeting_id", sa.BigInteger(), nullable=False),
        # M-10 — 익명 라벨. 이름 컬럼 없음
        sa.Column("speaker_label", sa.String(length=50), nullable=False),
        # M-11 — `recording_started_at` 기준 오프셋
        sa.Column("at_ms", sa.Integer(), nullable=False),
        sa.Column("end_ms", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        *_timestamps(),
        sa.CheckConstraint("end_ms >= at_ms", name="ck_meeting_transcript_ms_order"),
        sa.ForeignKeyConstraint(
            ["meeting_id"], ["meeting.id"], name="fk_meeting_transcript_meeting_id"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_meeting_transcript_meeting_id_at_ms",
        "meeting_transcript",
        ["meeting_id", "at_ms"],
        unique=False,
    )

    # --- meeting_attachment — 첨부 두 갈래(M-17) --------------------------------
    op.create_table(
        "meeting_attachment",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("meeting_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        # FK 없음 — `document` 테이블이 아직 없다(문서함 work 가 리비전을 낸다)
        sa.Column("document_id", sa.BigInteger(), nullable=True),
        sa.Column("url", sa.String(length=2000), nullable=True),
        sa.Column("label", sa.String(length=100), nullable=True),
        *_timestamps(),
        sa.CheckConstraint(
            "kind IN ('doc', 'link')", name="ck_meeting_attachment_kind"
        ),
        # M-17 — `kind` 별 컬럼(T-9-a 와 같다)
        sa.CheckConstraint(
            "(kind = 'doc' AND document_id IS NOT NULL AND url IS NULL AND label IS NULL)"
            " OR (kind = 'link' AND url IS NOT NULL AND document_id IS NULL)",
            name="ck_meeting_attachment_kind_columns",
        ),
        sa.ForeignKeyConstraint(
            ["meeting_id"], ["meeting.id"], name="fk_meeting_attachment_meeting_id"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    # §4 — 같은 문서 중복 첨부 금지
    op.create_index(
        "uq_meeting_attachment_meeting_id_document_id",
        "meeting_attachment",
        ["meeting_id", "document_id"],
        unique=True,
        postgresql_where=sa.text("document_id IS NOT NULL"),
    )
    op.create_index(
        "ix_meeting_attachment_meeting_id",
        "meeting_attachment",
        ["meeting_id"],
        unique=False,
    )

    # --- meeting_batch_run — 배치 실행 이력(DEC-003 §7) ------------------------
    op.create_table(
        "meeting_batch_run",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("meeting_id", sa.BigInteger(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("from_transcript_id", sa.BigInteger(), nullable=True),
        sa.Column("to_transcript_id", sa.BigInteger(), nullable=True),
        sa.Column("phase", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        *_timestamps(),
        sa.CheckConstraint(
            "phase IN ('incremental', 'final', 'integration')",
            name="ck_meeting_batch_run_phase",
        ),
        sa.CheckConstraint(
            "status IN ('succeeded', 'discarded', 'failed')",
            name="ck_meeting_batch_run_status",
        ),
        sa.ForeignKeyConstraint(
            ["meeting_id"], ["meeting.id"], name="fk_meeting_batch_run_meeting_id"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_meeting_batch_run_meeting_id_seq",
        "meeting_batch_run",
        ["meeting_id", "seq"],
        unique=False,
    )


def downgrade() -> None:
    # 생성 역순(자식 → 부모). `schedule` 의 `source_type='meeting'` 행은 남지만
    # 조회가 원본 조인으로 거른다(§3-4 · FK 없음) — WORK-004 데이터는 영향이 없다.
    op.drop_index("ix_meeting_batch_run_meeting_id_seq", table_name="meeting_batch_run")
    op.drop_table("meeting_batch_run")
    op.drop_index("ix_meeting_attachment_meeting_id", table_name="meeting_attachment")
    op.drop_index(
        "uq_meeting_attachment_meeting_id_document_id", table_name="meeting_attachment"
    )
    op.drop_table("meeting_attachment")
    op.drop_index(
        "ix_meeting_transcript_meeting_id_at_ms", table_name="meeting_transcript"
    )
    op.drop_table("meeting_transcript")
    op.drop_index("uq_meeting_line_source_ai_line_id", table_name="meeting_line")
    op.drop_index("uq_meeting_line_source_human_line_id", table_name="meeting_line")
    op.drop_index(
        "ix_meeting_line_meeting_id_track_agenda_id_order_index", table_name="meeting_line"
    )
    op.drop_table("meeting_line")
    op.drop_index(
        "ix_meeting_agenda_meeting_id_track_order_index", table_name="meeting_agenda"
    )
    op.drop_index("uq_meeting_agenda_human_active", table_name="meeting_agenda")
    op.drop_table("meeting_agenda")
    op.drop_index("ix_meeting_account_id_status_active", table_name="meeting")
    op.drop_index("ix_meeting_account_id_start_at_active", table_name="meeting")
    op.drop_table("meeting")
