"""task domain — task · task_todo · task_memo · task_log · task_attachment · task_relation · schedule

`autogenerate` 초안을 사람이 읽고 고쳤다(database/README.md §0-2).
손으로 확인·수정한 것 —

- 리비전 id 를 레포 규약(`000N_<이름>`)으로 바꿨다
- **표현식 인덱스** 두 종류가 살아 있는지 확인했다 — `task (account_id, due_date NULLS LAST)`(§4,
  리스트 기본 정렬·D-day 가 조인 없이 타는 인덱스)와 `created_at DESC`(상세 패널)
- **부분 인덱스**(`WHERE deleted_at IS NULL`) 3종
- CHECK — T-1-b(시각 쌍·기한 필요·순서) · T-4(상태 4종) · T-7(취소 사유) ·
  T-9-a(`kind` 별 컬럼) · T-10(`low < high`) · C-4(source_type) · 일정 시각 순서
- **`task_attachment.document_id` 에 FK 가 없다** — 대상 `document` 테이블이 아직 없다.
  컬럼·CHECK 는 T-9-a 최종 형태이고 **문서함 work 가 FK 추가 리비전을 낸다**(WORK-004 §Open Issues)
- **`schedule` 에도 `source_id` FK 가 없다** — 다형 참조이고 v2 `external` 이 그 자리를 쓴다(§3-4 · C-5-b)
- downgrade — 생성 역순(자식 → 부모)

Revision ID: 0002_task_domain
Revises: 0001_account
Create Date: 2026-09-06

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_task_domain"
down_revision: str | None = "0001_account"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- schedule — 시간축 배치의 파생 테이블(§3) ---------------------------
    op.create_table(
        "schedule",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("account_id", sa.BigInteger(), nullable=False),
        sa.Column("source_type", sa.String(length=20), nullable=False),
        # FK 없음 — 다형 참조(§3-4 · C-5-b)
        sa.Column("source_id", sa.BigInteger(), nullable=False),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_all_day", sa.Boolean(), nullable=False),
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
        sa.CheckConstraint(
            "source_type IN ('task', 'meeting')", name="ck_schedule_source_type"
        ),
        sa.CheckConstraint("end_at > start_at", name="ck_schedule_time_order"),
        sa.ForeignKeyConstraint(
            ["account_id"], ["account.id"], name="fk_schedule_account_id"
        ),
        sa.PrimaryKeyConstraint("id"),
        # SCH-3 — 업무·회의는 일정을 0..1개 갖는다
        sa.UniqueConstraint(
            "source_type", "source_id", name="uq_schedule_source_type_source_id"
        ),
    )
    # §4 — 캘린더 기간 조회와 겹침 검사가 둘 다 이 하나를 탄다
    op.create_index(
        "ix_schedule_account_id_start_at_end_at",
        "schedule",
        ["account_id", "start_at", "end_at"],
        unique=False,
    )

    # --- task — 업무 본체(기한을 소유한다 — T-1) ----------------------------
    op.create_table(
        "task",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("account_id", sa.BigInteger(), nullable=False),
        sa.Column("work_type_id", sa.BigInteger(), nullable=False),
        sa.Column("project_id", sa.BigInteger(), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default=sa.text("'todo'"),
            nullable=False,
        ),
        # G-2-e — 기한은 달력 개념이라 date/time 그대로 둔다
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("due_start_time", sa.Time(), nullable=True),
        sa.Column("due_end_time", sa.Time(), nullable=True),
        sa.Column("background", sa.Text(), nullable=True),
        sa.Column("goal", sa.Text(), nullable=True),
        sa.Column("completion_result", sa.Text(), nullable=True),
        sa.Column("cancel_reason", sa.Text(), nullable=True),
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
        sa.CheckConstraint(
            "status IN ('todo', 'in_progress', 'done', 'cancelled')",
            name="ck_task_status",
        ),
        # T-1-b — 시각 두 개는 함께 있거나 함께 없다
        sa.CheckConstraint(
            "(due_start_time IS NULL) = (due_end_time IS NULL)",
            name="ck_task_due_time_pair",
        ),
        sa.CheckConstraint(
            "due_start_time IS NULL OR due_date IS NOT NULL",
            name="ck_task_due_time_needs_date",
        ),
        sa.CheckConstraint(
            "due_start_time IS NULL OR due_end_time > due_start_time",
            name="ck_task_due_time_order",
        ),
        # T-7 — 취소 사유는 취소 상태에서만
        sa.CheckConstraint(
            "cancel_reason IS NULL OR status = 'cancelled'",
            name="ck_task_cancel_reason_only_when_cancelled",
        ),
        sa.ForeignKeyConstraint(["account_id"], ["account.id"], name="fk_task_account_id"),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], name="fk_task_project_id"),
        sa.ForeignKeyConstraint(
            ["work_type_id"], ["work_type.id"], name="fk_task_work_type_id"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    # §4 — **표현식 + 부분 인덱스.** 리스트 기본 정렬·D-day 가 조인 없이 이것만 탄다
    op.create_index(
        "ix_task_account_id_due_date_active",
        "task",
        ["account_id", sa.literal_column("due_date NULLS LAST")],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "ix_task_account_id_project_id_active",
        "task",
        ["account_id", "project_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "ix_task_account_id_status_active",
        "task",
        ["account_id", "status"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    # --- 자식 5종 -----------------------------------------------------------
    op.create_table(
        "task_todo",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("task_id", sa.BigInteger(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("done", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("order_index", sa.Integer(), nullable=False),
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
        sa.ForeignKeyConstraint(["task_id"], ["task.id"], name="fk_task_todo_task_id"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_task_todo_task_id_order_index",
        "task_todo",
        ["task_id", "order_index"],
        unique=False,
    )

    op.create_table(
        "task_memo",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("task_id", sa.BigInteger(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
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
        sa.ForeignKeyConstraint(["task_id"], ["task.id"], name="fk_task_memo_task_id"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_task_memo_task_id_created_at",
        "task_memo",
        ["task_id", sa.literal_column("created_at DESC")],
        unique=False,
    )

    op.create_table(
        "task_log",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("task_id", sa.BigInteger(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
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
        sa.ForeignKeyConstraint(["task_id"], ["task.id"], name="fk_task_log_task_id"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_task_log_task_id_created_at",
        "task_log",
        ["task_id", sa.literal_column("created_at DESC")],
        unique=False,
    )

    op.create_table(
        "task_attachment",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("task_id", sa.BigInteger(), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        # **FK 없음** — `document` 테이블이 아직 없다. 문서함 work 가 FK 리비전을 낸다.
        sa.Column("document_id", sa.BigInteger(), nullable=True),
        sa.Column("url", sa.String(length=2000), nullable=True),
        sa.Column("label", sa.String(length=100), nullable=True),
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
        sa.CheckConstraint(
            "role IN ('reference', 'deliverable')", name="ck_task_attachment_role"
        ),
        sa.CheckConstraint("kind IN ('doc', 'link')", name="ck_task_attachment_kind"),
        # T-9-a — kind 에 따라 채워지는 컬럼이 갈린다
        sa.CheckConstraint(
            "(kind = 'doc' AND document_id IS NOT NULL AND url IS NULL AND label IS NULL)"
            " OR (kind = 'link' AND url IS NOT NULL AND document_id IS NULL)",
            name="ck_task_attachment_kind_columns",
        ),
        sa.ForeignKeyConstraint(
            ["task_id"], ["task.id"], name="fk_task_attachment_task_id"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_task_attachment_task_id", "task_attachment", ["task_id"], unique=False
    )

    op.create_table(
        "task_relation",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("low_task_id", sa.BigInteger(), nullable=False),
        sa.Column("high_task_id", sa.BigInteger(), nullable=False),
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
        # T-10 — 무방향 1행. 자기 자신과의 연관도 이 제약이 함께 막는다
        sa.CheckConstraint("low_task_id < high_task_id", name="ck_task_relation_order"),
        sa.ForeignKeyConstraint(
            ["high_task_id"], ["task.id"], name="fk_task_relation_high_task_id"
        ),
        sa.ForeignKeyConstraint(
            ["low_task_id"], ["task.id"], name="fk_task_relation_low_task_id"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "low_task_id", "high_task_id", name="uq_task_relation_low_high"
        ),
    )
    op.create_index(
        "ix_task_relation_high_task_id", "task_relation", ["high_task_id"], unique=False
    )


def downgrade() -> None:
    """생성 역순 — 자식부터 지운다. 개발 중 되감기용이다(§0-2)."""
    op.drop_index("ix_task_relation_high_task_id", table_name="task_relation")
    op.drop_table("task_relation")
    op.drop_index("ix_task_attachment_task_id", table_name="task_attachment")
    op.drop_table("task_attachment")
    op.drop_index("ix_task_log_task_id_created_at", table_name="task_log")
    op.drop_table("task_log")
    op.drop_index("ix_task_memo_task_id_created_at", table_name="task_memo")
    op.drop_table("task_memo")
    op.drop_index("ix_task_todo_task_id_order_index", table_name="task_todo")
    op.drop_table("task_todo")
    op.drop_index(
        "ix_task_account_id_status_active",
        table_name="task",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_index(
        "ix_task_account_id_project_id_active",
        table_name="task",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_index(
        "ix_task_account_id_due_date_active",
        table_name="task",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_table("task")
    op.drop_index("ix_schedule_account_id_start_at_end_at", table_name="schedule")
    op.drop_table("schedule")
