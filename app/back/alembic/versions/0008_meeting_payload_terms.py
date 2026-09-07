"""회의 종료 — `payload` · 용어 보정 표 · 통합 잔재 제거(WORK-012 Phase 0)

다섯 가지를 바꾼다 —

① `meeting_line.pending_change` → **`payload` RENAME**. 이름만 바뀌므로 **값이 살아서 옮겨진다**.
   CHECK 를 붙인다 — `payload` 는 `merged`·`human` 트랙의 `action`·`task` 줄에만 뜻이 있다(MF-59 · SPEC-008 §4 「`payload` 자리」).
② `source_human_line_id` · `source_ai_line_id` **삭제**(컬럼 · FK 2 · 부분 UNIQUE 2 · CHECK 1).
   통합 규칙(사람 줄 전수 계승 · 이중 계승 금지 · 본문 복사)이 MF-56 · 57 로 사라졌다 — 가리킬 원본이 없다.
③ `meeting.term_corrections jsonb NULL` 추가 — ② 최종 회의록이 낸 용어 보정 표(M-9-b).
④ `meeting_batch_run.phase` CHECK 를 `incremental|final` 로 재작성. `integration` 행이 있으면 **먼저 지운다**
   (통합 호출이 없어졌으므로 그 회차 기록도 뜻이 없다).
⑤ `job.error_code` CHECK 를 **5종**으로 재작성(`transcription_failed` · `transcription_timeout` ·
   `final_failed` · `final_timeout` · `job_timeout`). 옛 `integration_*` 행이 있으면 먼저 지운다.

`downgrade` 는 역순이다. ② 로 지운 컬럼은 되살아나지만 **값은 없다** — 통합 줄 자체가 이 리비전 뒤로는 만들어지지 않는다.

Revision ID: 0008_meeting_payload_terms
Revises: 0007_auth_session_meeting_token
Create Date: 2026-09-07

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008_meeting_payload_terms"
down_revision: str | None = "0007_auth_session_meeting_token"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# SPEC-008 §4 「`payload` 자리」 — `kind ∈ {action, task}` 줄에만. 트랙은 사람이 편집하는 둘뿐이다
_PAYLOAD_CHECK = (
    "payload IS NULL OR (track IN ('merged', 'human') AND kind IN ('action', 'task'))"
)


def upgrade() -> None:
    # ① 이름만 바꾼다 — 값이 그대로 따라온다
    op.alter_column("meeting_line", "pending_change", new_column_name="payload")
    # 자리 밖에 실려 있던 값은 **버린다**(SPEC-008 §4 「`payload` 자리」 — 폐기 사유가 아니라 버림).
    # `ai` 트랙과 논의·결정 줄이 여기 걸린다 — 옛 컬럼에는 자리 제약이 없었다
    op.execute(sa.text(f"UPDATE meeting_line SET payload = NULL WHERE NOT ({_PAYLOAD_CHECK})"))
    op.create_check_constraint("ck_meeting_line_payload", "meeting_line", _PAYLOAD_CHECK)

    # ② 통합 잔재 — 인덱스 · CHECK · FK · 컬럼 순
    op.drop_index("uq_meeting_line_source_human_line_id", table_name="meeting_line")
    op.drop_index("uq_meeting_line_source_ai_line_id", table_name="meeting_line")
    op.drop_constraint("ck_meeting_line_source_only_merged", "meeting_line", type_="check")
    op.drop_constraint("fk_meeting_line_source_human_line_id", "meeting_line", type_="foreignkey")
    op.drop_constraint("fk_meeting_line_source_ai_line_id", "meeting_line", type_="foreignkey")
    op.drop_column("meeting_line", "source_human_line_id")
    op.drop_column("meeting_line", "source_ai_line_id")

    # ③ 용어 보정 표 — `[{stt, correct, grade}]`
    op.add_column("meeting", sa.Column("term_corrections", sa.dialects.postgresql.JSONB(), nullable=True))

    # ④ 배치 회차 — `integration` 이 사라진다
    op.execute(sa.text("DELETE FROM meeting_batch_run WHERE phase = 'integration'"))
    op.drop_constraint("ck_meeting_batch_run_phase", "meeting_batch_run", type_="check")
    op.create_check_constraint(
        "ck_meeting_batch_run_phase", "meeting_batch_run", "phase IN ('incremental', 'final')"
    )

    # ⑤ job 에러 코드 5종
    op.execute(
        sa.text("DELETE FROM job WHERE error_code IN ('integration_failed', 'integration_timeout')")
    )
    op.drop_constraint("ck_job_error_code", "job", type_="check")
    op.create_check_constraint(
        "ck_job_error_code",
        "job",
        "error_code IS NULL OR error_code IN ("
        "'transcription_failed', 'transcription_timeout', 'final_failed', 'final_timeout', 'job_timeout')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_job_error_code", "job", type_="check")
    op.create_check_constraint(
        "ck_job_error_code",
        "job",
        "error_code IS NULL OR error_code IN ('integration_failed', 'integration_timeout', 'job_timeout')",
    )

    op.drop_constraint("ck_meeting_batch_run_phase", "meeting_batch_run", type_="check")
    op.create_check_constraint(
        "ck_meeting_batch_run_phase",
        "meeting_batch_run",
        "phase IN ('incremental', 'final', 'integration')",
    )

    op.drop_column("meeting", "term_corrections")

    op.add_column("meeting_line", sa.Column("source_ai_line_id", sa.BigInteger(), nullable=True))
    op.add_column("meeting_line", sa.Column("source_human_line_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        "fk_meeting_line_source_ai_line_id", "meeting_line", "meeting_line", ["source_ai_line_id"], ["id"]
    )
    op.create_foreign_key(
        "fk_meeting_line_source_human_line_id", "meeting_line", "meeting_line", ["source_human_line_id"], ["id"]
    )
    op.create_check_constraint(
        "ck_meeting_line_source_only_merged",
        "meeting_line",
        "track = 'merged' OR (source_human_line_id IS NULL AND source_ai_line_id IS NULL)",
    )
    op.create_index(
        "uq_meeting_line_source_ai_line_id",
        "meeting_line",
        ["source_ai_line_id"],
        unique=True,
        postgresql_where=sa.text("source_ai_line_id IS NOT NULL"),
    )
    op.create_index(
        "uq_meeting_line_source_human_line_id",
        "meeting_line",
        ["source_human_line_id"],
        unique=True,
        postgresql_where=sa.text("source_human_line_id IS NOT NULL"),
    )

    op.drop_constraint("ck_meeting_line_payload", "meeting_line", type_="check")
    op.alter_column("meeting_line", "payload", new_column_name="pending_change")
