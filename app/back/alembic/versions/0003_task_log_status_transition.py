"""task_log 에 상태 전이 두 컬럼 — from_status · to_status

**WORK-005 가 새로 필요로 한 스키마다**(WP 는 「마이그레이션 없음」으로 봤다).
근거 둘 —

- **실행취소**가 ① 마지막 로그가 상태 전이인지 판정하고 ② **직전 상태를 복원**해야 한다.
  한국어 본문(「상태 시작전 → 진행중」)을 되파싱하면 문구가 바뀌는 순간 깨진다.
- SPEC-004 Data Contract 의 **`cancelledAt`** 이 어디에서도 저장되지 않는다.
  `task` 에 컬럼을 만들지 않고(G-7) **취소 전이 로그의 시각**에서 파생한다.

전이 로그만 두 값을 갖고 나머지 로그는 **둘 다 NULL** 이다(CHECK 로 강제).
기존 행은 전부 비전이 로그라 `NULL` 이 정확하다 — 백필이 필요 없다.

**0002 를 고치지 않고 새 리비전으로 얹는다.**

Revision ID: 0003_task_log_status
Revises: 0002_task_domain
Create Date: 2026-09-06

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_task_log_status"
down_revision: str | None = "0002_task_domain"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_STATUS_VALUES = "'todo', 'in_progress', 'done', 'cancelled'"


def upgrade() -> None:
    op.add_column("task_log", sa.Column("from_status", sa.String(length=20), nullable=True))
    op.add_column("task_log", sa.Column("to_status", sa.String(length=20), nullable=True))

    # 전이 로그는 두 값을 갖고, 그 밖의 로그는 둘 다 NULL 이다
    op.create_check_constraint(
        "ck_task_log_status_pair",
        "task_log",
        "(from_status IS NULL) = (to_status IS NULL)",
    )
    # G-3 — enum 은 varchar + CHECK
    op.create_check_constraint(
        "ck_task_log_from_status",
        "task_log",
        f"from_status IS NULL OR from_status IN ({_STATUS_VALUES})",
    )
    op.create_check_constraint(
        "ck_task_log_to_status",
        "task_log",
        f"to_status IS NULL OR to_status IN ({_STATUS_VALUES})",
    )


def downgrade() -> None:
    op.drop_constraint("ck_task_log_to_status", "task_log", type_="check")
    op.drop_constraint("ck_task_log_from_status", "task_log", type_="check")
    op.drop_constraint("ck_task_log_status_pair", "task_log", type_="check")
    op.drop_column("task_log", "to_status")
    op.drop_column("task_log", "from_status")
