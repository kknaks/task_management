"""task 도메인 — 업무 본체와 자식 5종.

정본은 `40-architecture/database/README.md` §1 ERD · §4 인덱스 와
`domains/task.md` 의 불변식(T-1~T-11)이다.

**시간은 여기 없다** — 기한(`due_date`·`due_*_time`)은 업무가 소유하고,
시간축 배치는 `schedule` 이 **파생**으로 갖는다(T-1 · C-1).
"""

from __future__ import annotations

from datetime import date, datetime, time

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from dto.enums import AttachmentKind, AttachmentRole, TaskStatus
from models.base import Base, TimestampMixin, pk_column

_STATUS_VALUES = ", ".join(f"'{value}'" for value in TaskStatus)
_ROLE_VALUES = ", ".join(f"'{value}'" for value in AttachmentRole)
_KIND_VALUES = ", ".join(f"'{value}'" for value in AttachmentKind)


class Task(Base, TimestampMixin):
    """업무 본체. **기한을 소유한다**(T-1).

    T-2 — `work_type_id` 필수 / T-3 — `project_id` 는 0..1(무소속 허용)
    T-4 — `status` 4종만. 「지연」은 컬럼이 아니다 / T-11 — 소프트 딜리트
    """

    __tablename__ = "task"

    id: Mapped[int] = pk_column()
    account_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("account.id", name="fk_task_account_id"), nullable=False
    )
    # T-2 — 필수. 고정 enum 3종은 폐기됐다(§A-1).
    work_type_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("work_type.id", name="fk_task_work_type_id"),
        nullable=False,
    )
    # T-3 — NULL 이 「프로젝트 없음」이다. 기본 프로젝트 행을 만들지 않는다.
    project_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("project.id", name="fk_task_project_id"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text(f"'{TaskStatus.TODO.value}'")
    )

    # G-2-e — 기한은 **달력 개념**이라 `date`/`time` 그대로 둔다(전역 timestamptz 규약의 예외).
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_start_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    due_end_time: Mapped[time | None] = mapped_column(Time, nullable=True)

    background: Mapped[str | None] = mapped_column(Text, nullable=True)
    goal: Mapped[str | None] = mapped_column(Text, nullable=True)
    # T-5 — 완료 게이트의 한 축(판정은 WORK-005).
    completion_result: Mapped[str | None] = mapped_column(Text, nullable=True)
    # T-7 — `status='cancelled'` 일 때만 값이 있다.
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        # G-3 — enum 은 varchar + CHECK
        CheckConstraint(f"status IN ({_STATUS_VALUES})", name="ck_task_status"),
        # T-1-b — 시각 두 개는 **함께 있거나 함께 없다**
        CheckConstraint(
            "(due_start_time IS NULL) = (due_end_time IS NULL)",
            name="ck_task_due_time_pair",
        ),
        # T-1-b — 시간만 있고 기한 날짜가 없는 상태를 만들지 않는다
        CheckConstraint(
            "due_start_time IS NULL OR due_date IS NOT NULL",
            name="ck_task_due_time_needs_date",
        ),
        # SPEC-003 §4 Validation — 있으면 `end > start`
        CheckConstraint(
            "due_start_time IS NULL OR due_end_time > due_start_time",
            name="ck_task_due_time_order",
        ),
        # T-7 — 취소 사유는 취소 상태에서만
        CheckConstraint(
            f"cancel_reason IS NULL OR status = '{TaskStatus.CANCELLED.value}'",
            name="ck_task_cancel_reason_only_when_cancelled",
        ),
        # §4 — 리스트·칸반·프로젝트 필터
        Index(
            "ix_task_account_id_status_active",
            "account_id",
            "status",
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "ix_task_account_id_project_id_active",
            "account_id",
            "project_id",
            postgresql_where=text("deleted_at IS NULL"),
        ),
        # §4 — **리스트 기본 정렬·D-day 가 조인 없이 이 인덱스만 탄다**(DEC-005 §3 개정의 이유)
        Index(
            "ix_task_account_id_due_date_active",
            "account_id",
            text("due_date NULLS LAST"),
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


class TaskTodo(Base, TimestampMixin):
    """할일 — 진행률의 분모·분자. 완료로 바뀌면 로그가 같은 트랜잭션에서 남는다(T-8)."""

    __tablename__ = "task_todo"

    id: Mapped[int] = pk_column()
    task_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("task.id", name="fk_task_todo_task_id"), nullable=False
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    done: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (Index("ix_task_todo_task_id_order_index", "task_id", "order_index"),)


class TaskMemo(Base, TimestampMixin):
    """메모 — 사람 기록. **등록만** 있다(SPEC-003 S003-OQ-4). 로그가 아니다."""

    __tablename__ = "task_memo"

    id: Mapped[int] = pk_column()
    task_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("task.id", name="fk_task_memo_task_id"), nullable=False
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        Index("ix_task_memo_task_id_created_at", "task_id", text("created_at DESC")),
    )


class TaskLog(Base, TimestampMixin):
    """시스템 로그. **서비스만 쓴다** — 사용자는 쓰거나 지울 수 없다(DEC-002 §6).

    **상태 전이 로그는 두 컬럼을 더 갖는다**(`from_status`·`to_status`) — 나머지 로그는 둘 다 `NULL` 이다.
    실행취소가 「마지막 로그가 상태 전이인가」를 판정하고 **직전 상태를 복원**해야 하는데,
    한국어 본문(「상태 시작전 → 진행중」)을 되파싱하면 문구가 바뀌는 순간 깨진다.
    취소 시각(`cancelledAt`)도 여기서 나온다 — `task` 에 컬럼을 만들지 않는다(G-7).
    """

    __tablename__ = "task_log"

    id: Mapped[int] = pk_column()
    task_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("task.id", name="fk_task_log_task_id"), nullable=False
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # 전이 로그만 채운다. 둘은 **함께 있거나 함께 없다**(아래 CHECK).
    from_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    to_status: Mapped[str | None] = mapped_column(String(20), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "(from_status IS NULL) = (to_status IS NULL)",
            name="ck_task_log_status_pair",
        ),
        CheckConstraint(
            f"from_status IS NULL OR from_status IN ({_STATUS_VALUES})",
            name="ck_task_log_from_status",
        ),
        CheckConstraint(
            f"to_status IS NULL OR to_status IN ({_STATUS_VALUES})",
            name="ck_task_log_to_status",
        ),
        Index("ix_task_log_task_id_created_at", "task_id", text("created_at DESC")),
    )


class TaskAttachment(Base, TimestampMixin):
    """참고자료·결과자료. `role` × `kind` 두 축(T-9).

    **`document_id` 에 FK 를 걸지 않는다** — 대상 `document` 테이블이 아직 없다.
    컬럼과 CHECK 는 T-9-a 최종 형태로 두고, **문서함 work 가 FK 추가 리비전을 낸다**
    (WORK-004 §Open Issues — 사용자 확정).
    """

    __tablename__ = "task_attachment"

    id: Mapped[int] = pk_column()
    task_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("task.id", name="fk_task_attachment_task_id"),
        nullable=False,
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    # FK 없음 — 위 docstring 참조.
    document_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    label: Mapped[str | None] = mapped_column(String(100), nullable=True)

    __table_args__ = (
        CheckConstraint(f"role IN ({_ROLE_VALUES})", name="ck_task_attachment_role"),
        CheckConstraint(f"kind IN ({_KIND_VALUES})", name="ck_task_attachment_kind"),
        # T-9-a — `kind` 에 따라 채워지는 컬럼이 갈린다.
        # `doc` 이면 `document_id` 만 / `link` 면 `url`(+선택 `label`) 만.
        CheckConstraint(
            f"(kind = '{AttachmentKind.DOC.value}'"
            " AND document_id IS NOT NULL AND url IS NULL AND label IS NULL)"
            f" OR (kind = '{AttachmentKind.LINK.value}'"
            " AND url IS NOT NULL AND document_id IS NULL)",
            name="ck_task_attachment_kind_columns",
        ),
        Index("ix_task_attachment_task_id", "task_id"),
    )


class TaskRelation(Base, TimestampMixin):
    """연관업무 — **무방향 1행**(T-10).

    `low_task_id < high_task_id` 로 정규화해 같은 쌍이 두 행이 되는 것을 DB 가 막는다.
    조회는 두 컬럼을 모두 본다.
    """

    __tablename__ = "task_relation"

    id: Mapped[int] = pk_column()
    low_task_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("task.id", name="fk_task_relation_low_task_id"),
        nullable=False,
    )
    high_task_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("task.id", name="fk_task_relation_high_task_id"),
        nullable=False,
    )

    __table_args__ = (
        # 자기 자신과의 연관도 이 제약이 함께 막는다(low < high 라 같을 수 없다).
        CheckConstraint("low_task_id < high_task_id", name="ck_task_relation_order"),
        UniqueConstraint(
            "low_task_id", "high_task_id", name="uq_task_relation_low_high"
        ),
        # §4 — 역방향 조회
        Index("ix_task_relation_high_task_id", "high_task_id"),
    )
