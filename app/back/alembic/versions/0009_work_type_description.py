"""유형 설명 — `work_type.description` + 기본 유형 2건 시드 문구(WORK-013 Phase 2)

두 가지를 한다 —

① `work_type.description text NULL` 추가(A-12 · MF-21). 「어떤 업무인지」를 적는 칸이고 **비어 있어도 유형은 유효하다**.
   쓰는 곳은 회의록 AI 의 `list_work_types()`(이름 · 종류 · 설명) — AI 가 새 업무의 유형을 고르는 근거다.
   길이 상한(0~200)은 스키마 층이 본다 — 문구가 늘어날 때 컬럼을 고치지 않으려고 `text` 로 둔다.
② **기본 유형 2건**에 시드 문구를 UPDATE 한다(A-12 정본) — 개인 업무 · 문서·보고.
   **미팅·회의는 건드리지 않는다**(빈 값 — DEC-003 OQ-11 은 「문구를 정하지 않는다」로 닫혔다).
   `is_default` 인 행만, **아직 비어 있는 행만** 채운다 — 이미 사람이 적어 둔 설명을 덮지 않는다.

`downgrade` 는 컬럼을 지운다. **값도 함께 사라지고 되살아나지 않는다** — 다시 올리면 ② 가 기본 2건만 다시 채운다.

Revision ID: 0009_work_type_description
Revises: 0008_meeting_payload_terms
Create Date: 2026-09-08

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009_work_type_description"
down_revision: str | None = "0008_meeting_payload_terms"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# `domains/account.md` A-12 가 정본인 문구. 이름으로 찾는다 — 기본 3종의 이름은 잠긴 값이다(A-4)
_SEED_DESCRIPTIONS: tuple[tuple[str, str], ...] = (
    ("개인 업무", "혼자 처리하는 실무. 개발·수정·확인 등"),
    ("문서·보고", "산출물이 문서인 것. 기획서·보고서·회의록 정리"),
)


def upgrade() -> None:
    op.add_column("work_type", sa.Column("description", sa.Text(), nullable=True))
    for name, description in _SEED_DESCRIPTIONS:
        op.execute(
            sa.text(
                "UPDATE work_type SET description = :description"
                " WHERE is_default = true AND name = :name AND description IS NULL"
            ).bindparams(description=description, name=name)
        )


def downgrade() -> None:
    op.drop_column("work_type", "description")
