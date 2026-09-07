"""auth_session — 회의별 단명 토큰(WORK-009 Phase 1 · A-13 · MF-69 · DB README §1 ERD · §4)

한 테이블에 종류 둘을 둔다(A-13 「새 테이블을 만들지 않는다」) —

- `kind` — `refresh` | `meeting`. **기존 행은 전부 `refresh`** 다(`server_default`)
- `meeting_id` — meeting 행만. FK `meeting.id`. 부분 인덱스 `(meeting_id) WHERE kind='meeting'`(§4)
- `meeting_token` — **원문**(A-13 · 2026-09-07 사용자 확정). 해시 컬럼이 아니다
- `refresh_token_hash` — **NULL 허용**으로 완화한다(meeting 행은 NULL). UNIQUE 는 NULL 을 여러 개 허용하므로
  회의 토큰 행이 늘어도 `uq_auth_session_refresh_token_hash` 와 부딪히지 않는다.
  대신 CHECK 로 「refresh 행에는 해시가 반드시 있다」를 남긴다 — A-7 이 기대는 전제다

downgrade — **meeting 행을 먼저 DELETE** 한 뒤 컬럼을 뺀다(그래야 `refresh_token_hash` 를 NOT NULL 로 되돌릴 수 있다).
회의 토큰은 폐기 가능한 단명 값이라 되감으면 사라지는 것이 맞다(WP §Rollback).

Revision ID: 0007_auth_session_meeting_token
Revises: 0006_job
Create Date: 2026-09-07

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_auth_session_meeting_token"
down_revision: str | None = "0006_job"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "auth_session",
        sa.Column(
            "kind", sa.String(length=20), server_default=sa.text("'refresh'"), nullable=False
        ),
    )
    op.add_column("auth_session", sa.Column("meeting_id", sa.BigInteger(), nullable=True))
    op.add_column(
        "auth_session", sa.Column("meeting_token", sa.String(length=255), nullable=True)
    )
    op.alter_column("auth_session", "refresh_token_hash", existing_type=sa.String(length=255), nullable=True)

    op.create_foreign_key(
        "fk_auth_session_meeting_id", "auth_session", "meeting", ["meeting_id"], ["id"]
    )
    # §4 — 회의 토큰 조회와 폐기(행 삭제)가 이 인덱스를 쓴다. refresh 행은 들어오지 않는다
    op.create_index(
        "ix_auth_session_meeting_id",
        "auth_session",
        ["meeting_id"],
        postgresql_where=sa.text("kind = 'meeting'"),
    )

    op.create_check_constraint(
        "ck_auth_session_kind", "auth_session", "kind IN ('refresh', 'meeting')"
    )
    op.create_check_constraint(
        "ck_auth_session_meeting_columns",
        "auth_session",
        "(kind = 'meeting') = (meeting_id IS NOT NULL AND meeting_token IS NOT NULL)",
    )
    op.create_check_constraint(
        "ck_auth_session_refresh_columns",
        "auth_session",
        "kind <> 'refresh' OR refresh_token_hash IS NOT NULL",
    )


def downgrade() -> None:
    # 회의 토큰 행을 먼저 지운다 — 남으면 `refresh_token_hash` NOT NULL 복구가 실패한다
    op.execute(sa.text("DELETE FROM auth_session WHERE kind = 'meeting'"))

    op.drop_constraint("ck_auth_session_refresh_columns", "auth_session", type_="check")
    op.drop_constraint("ck_auth_session_meeting_columns", "auth_session", type_="check")
    op.drop_constraint("ck_auth_session_kind", "auth_session", type_="check")
    op.drop_index("ix_auth_session_meeting_id", table_name="auth_session")
    op.drop_constraint("fk_auth_session_meeting_id", "auth_session", type_="foreignkey")

    op.alter_column(
        "auth_session", "refresh_token_hash", existing_type=sa.String(length=255), nullable=False
    )
    op.drop_column("auth_session", "meeting_token")
    op.drop_column("auth_session", "meeting_id")
    op.drop_column("auth_session", "kind")
