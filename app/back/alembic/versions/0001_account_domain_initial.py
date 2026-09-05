"""account domain initial — account · career · auth_session · work_type · project

`autogenerate` 초안을 사람이 읽고 고쳤다(database/README.md §0-2).
손으로 채운 것 — FK 제약 이름 · CHECK 제약(G-3 · A-5) · 부분 인덱스(§4) ·
컬럼 순서(도메인 컬럼 → deleted_at → 공통 타임스탬프) · downgrade.

Revision ID: 0001_account
Revises:
Create Date: 2026-09-05

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001_account"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# A-5 · SPEC-002 §4 — 허용 팔레트 토큰명 8종. 값의 정본은 `dto/enums.ColorToken`.
_COLOR_TOKENS = "'indigo', 'violet', 'steel', 'mint', 'sky', 'amber', 'rose', 'graphite'"
# G-3 — enum 은 varchar + CHECK. 값의 정본은 `dto/enums.WorkTypeKind`.
_WORK_TYPE_KINDS = "'meeting', 'task'"


def upgrade() -> None:
    # ── account — 계정·프로필. 앱에서 만들 수 없고 시드로만 생긴다(DEC-001 §2) ──
    op.create_table(
        "account",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("login_id", sa.String(length=100), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("avatar_path", sa.String(length=500), nullable=True),
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
        sa.PrimaryKeyConstraint("id", name="pk_account"),
        # §4 — UNIQUE (login_id)
        sa.UniqueConstraint("login_id", name="uq_account_login_id"),
    )

    # ── career — 하드 삭제(§0-1 예외). `ended_on IS NULL` = 재직 중 ──
    op.create_table(
        "career",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("account_id", sa.BigInteger(), nullable=False),
        sa.Column("company_name", sa.String(length=200), nullable=False),
        sa.Column("department", sa.String(length=200), nullable=True),
        sa.Column("job_title", sa.String(length=200), nullable=True),
        sa.Column("started_on", sa.Date(), nullable=False),
        sa.Column("ended_on", sa.Date(), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["account_id"], ["account.id"], name="fk_career_account_id"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_career"),
    )

    # ── auth_session — refresh 토큰 회전 기록. 해시만 저장한다(A-7) ──
    op.create_table(
        "auth_session",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("account_id", sa.BigInteger(), nullable=False),
        sa.Column("refresh_token_hash", sa.String(length=255), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["account_id"], ["account.id"], name="fk_auth_session_account_id"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_auth_session"),
        # §4 — UNIQUE (refresh_token_hash)
        sa.UniqueConstraint(
            "refresh_token_hash", name="uq_auth_session_refresh_token_hash"
        ),
    )
    # §4 — (account_id, expires_at) : 회전 검증·만료 청소
    op.create_index(
        "ix_auth_session_account_id_expires_at",
        "auth_session",
        ["account_id", "expires_at"],
        unique=False,
    )

    # ── work_type — 동적 유형. 기본 3종은 시드가 넣는다(A-4) ──
    op.create_table(
        "work_type",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("account_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("color_token", sa.String(length=30), nullable=False),
        sa.Column(
            "is_default", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["account_id"], ["account.id"], name="fk_work_type_account_id"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_work_type"),
        # G-3 — enum 은 varchar + CHECK (native ENUM 을 쓰지 않는다)
        sa.CheckConstraint(f"kind IN ({_WORK_TYPE_KINDS})", name="ck_work_type_kind"),
        # A-5 — 색은 허용 팔레트 토큰명만. 자유 hex 를 저장하지 않는다
        sa.CheckConstraint(
            f"color_token IN ({_COLOR_TOKENS})", name="ck_work_type_color_token"
        ),
    )
    # §4 — (account_id) WHERE deleted_at IS NULL : 선택 목록이 매 화면에 뜬다
    op.create_index(
        "ix_work_type_account_id_active",
        "work_type",
        ["account_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    # ── project — 이름 + 색뿐(DEC-001 §3). 소프트 딜리트 ──
    op.create_table(
        "project",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("account_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("color_token", sa.String(length=30), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["account_id"], ["account.id"], name="fk_project_account_id"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_project"),
        sa.CheckConstraint(
            f"color_token IN ({_COLOR_TOKENS})", name="ck_project_color_token"
        ),
    )
    op.create_index(
        "ix_project_account_id_active",
        "project",
        ["account_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    """개발 중 되감기용(§0-2). 운영 롤백은 다운그레이드가 아니라 백업 복원이다."""
    op.drop_index(
        "ix_project_account_id_active",
        table_name="project",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_table("project")
    op.drop_index(
        "ix_work_type_account_id_active",
        table_name="work_type",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_table("work_type")
    op.drop_index(
        "ix_auth_session_account_id_expires_at", table_name="auth_session"
    )
    op.drop_table("auth_session")
    op.drop_table("career")
    op.drop_table("account")
