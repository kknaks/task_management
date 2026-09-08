"""job — 장시간 작업 정본 행(WORK-008 Phase 1 · BE §5-3 · §6 · ERD `job`)

**WORK-006 리비전(`0005_meeting_domain`) 이 이미 담은 것** — `meeting_line.source_human_line_id`·`source_ai_line_id`
(+ CHECK + 부분 UNIQUE 2) · `meeting_agenda.source_agenda_id` · `meeting.ai_headline`. 그래서 이 리비전은
**`job` 테이블 하나**다(WP §Domain / Schema 「조건부」의 확인 결과 — 2026-09-07).

손으로 확인·수정한 것 —

- CHECK — `kind`(`meeting_finalize`) · `target_type`(`meeting`) · `status` 4종 · `error_code` 3종(NULL 허용)
- 인덱스 — `(account_id, status)` 폴링 · 스윕 / `(target_type, target_id)` `activeJobId` 파생(DB README §4)
- `progress{phase, attempt}` 는 컬럼이 아니다 — `attempt` 만 둔다(G-7)
- downgrade — 테이블 삭제. `job` 의 소비자는 이 work 뿐이라 다른 데이터에 영향이 없다

Revision ID: 0006_job
Revises: 0005_meeting_domain
Create Date: 2026-09-07

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_job"
down_revision: str | None = "0005_meeting_domain"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "job",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), primary_key=True),
        sa.Column("account_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(length=30), nullable=False),
        sa.Column("target_type", sa.String(length=20), nullable=False),
        sa.Column("target_id", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(length=20), server_default=sa.text("'queued'"), nullable=False),
        sa.Column("attempt", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("error_code", sa.String(length=30), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("kind IN ('meeting_finalize')", name="ck_job_kind"),
        sa.CheckConstraint("target_type IN ('meeting')", name="ck_job_target_type"),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'succeeded', 'failed')", name="ck_job_status"
        ),
        sa.CheckConstraint(
            "error_code IS NULL OR error_code IN ('integration_failed', 'integration_timeout', 'job_timeout')",
            name="ck_job_error_code",
        ),
        sa.ForeignKeyConstraint(["account_id"], ["account.id"], name="fk_job_account_id"),
    )
    op.create_index("ix_job_account_id_status", "job", ["account_id", "status"])
    op.create_index("ix_job_target_type_target_id", "job", ["target_type", "target_id"])


def downgrade() -> None:
    op.drop_index("ix_job_target_type_target_id", table_name="job")
    op.drop_index("ix_job_account_id_status", table_name="job")
    op.drop_table("job")
