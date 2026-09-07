"""account 도메인 — 계정·경력·세션·유형·프로젝트.

정본은 `40-architecture/database/README.md` §1 ERD · §4 인덱스 와
`domains/account.md` 의 불변식(A-1~A-11)이다.
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from dto.enums import ColorToken, WorkTypeKind
from models.base import Base, TimestampMixin, pk_column

_KIND_VALUES = ", ".join(f"'{value}'" for value in WorkTypeKind)
_COLOR_VALUES = ", ".join(f"'{value}'" for value in ColorToken)


class Account(Base, TimestampMixin):
    """계정·프로필. **앱에서 만들 수 없고 시드로만 생긴다**(DEC-001 §2).

    A-1 — `login_id` 가 로그인 식별자다(이메일 형식이 아니다). `email` 은 표시 전용.
    A-3 — 회사·소속·직무를 여기 두지 않는다(현재 경력에서 파생).
    A-11 — 업무 시간 필드를 두지 않는다.
    """

    __tablename__ = "account"

    id: Mapped[int] = pk_column()
    login_id: Mapped[str] = mapped_column(String(100), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    avatar_path: Mapped[str | None] = mapped_column(String(500), nullable=True)

    __table_args__ = (
        # §4 — UNIQUE (login_id)
        UniqueConstraint("login_id", name="uq_account_login_id"),
    )


class Career(Base, TimestampMixin):
    """경력 행. **하드 삭제**다(§0-1 예외) — `deleted_at` 을 두지 않는다."""

    __tablename__ = "career"

    id: Mapped[int] = pk_column()
    account_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("account.id", name="fk_career_account_id"),
        nullable=False,
    )
    company_name: Mapped[str] = mapped_column(String(200), nullable=False)
    department: Mapped[str | None] = mapped_column(String(200), nullable=True)
    job_title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    started_on: Mapped[date] = mapped_column(Date, nullable=False)
    # NULL = 재직 중 → A-3 의 「현재」 경력
    ended_on: Mapped[date | None] = mapped_column(Date, nullable=True)


class AuthSession(Base, TimestampMixin):
    """세션 행 **두 종류**가 한 테이블에 산다(A-13 · MF-69) — `kind` 가 가른다.

    - `kind='refresh'` — refresh 토큰 회전 기록. **해시만 저장**하고 원문은 남기지 않는다(A-7).
    - `kind='meeting'` — 회의별 단명 토큰. **원문을 `meeting_token` 에 둔다**(A-13 · 2026-09-07 사용자 확정).
      회의당 하나 · 회전 없음 · `revoked_at` 을 찍지 않는다 — **폐기는 행 삭제**다.

    `refresh_token_hash` 는 meeting 행에서 NULL 이다. UNIQUE 는 NULL 을 여러 개 허용하므로
    회의 토큰 행이 몇 개가 되든 `uq_auth_session_refresh_token_hash` 와 부딪히지 않는다.
    """

    __tablename__ = "auth_session"

    id: Mapped[int] = pk_column()
    account_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("account.id", name="fk_auth_session_account_id"),
        nullable=False,
    )
    # G-3 — enum 은 varchar + CHECK. 기존 행은 전부 `refresh` 다(리비전 0007 의 server_default)
    kind: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text("'refresh'")
    )
    refresh_token_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # meeting 행만 값을 갖는다. FK 라 회의가 지워지면 남지 않는다
    meeting_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("meeting.id", name="fk_auth_session_meeting_id"),
        nullable=True,
    )
    # **원문**이다(A-13). 해시 컬럼이 아니다 — 제출부가 이 값을 읽어 MCP 헤더에 싣는다
    meeting_token: Mapped[str | None] = mapped_column(String(255), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        # §4 — UNIQUE (refresh_token_hash), (account_id, expires_at), (meeting_id) WHERE kind='meeting'
        UniqueConstraint("refresh_token_hash", name="uq_auth_session_refresh_token_hash"),
        Index("ix_auth_session_account_id_expires_at", "account_id", "expires_at"),
        Index(
            "ix_auth_session_meeting_id",
            "meeting_id",
            postgresql_where=text("kind = 'meeting'"),
        ),
        CheckConstraint(
            "kind IN ('refresh', 'meeting')", name="ck_auth_session_kind"
        ),
        # A-13 — meeting 행 ⇔ 회의와 원문이 둘 다 있다
        CheckConstraint(
            "(kind = 'meeting') = (meeting_id IS NOT NULL AND meeting_token IS NOT NULL)",
            name="ck_auth_session_meeting_columns",
        ),
        # A-7 — refresh 행은 해시가 반드시 있다(NULL 허용은 meeting 행 때문이다)
        CheckConstraint(
            "kind <> 'refresh' OR refresh_token_hash IS NOT NULL",
            name="ck_auth_session_refresh_columns",
        ),
    )


class WorkType(Base, TimestampMixin):
    """동적 유형. 기본 3종은 `is_default=true` 로 시드가 넣는다(A-4).

    잠금(삭제·개명 금지)은 **service 가 판정**한다 — DB 제약으로 걸지 않는다
    (색만 편집 가능해야 해서 행 자체는 UPDATE 대상이다).
    """

    __tablename__ = "work_type"

    id: Mapped[int] = pk_column()
    account_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("account.id", name="fk_work_type_account_id"),
        nullable=False,
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    color_token: Mapped[str] = mapped_column(String(30), nullable=False)
    is_default: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    # §0-1 — 소프트 딜리트는 `deleted_at`(boolean 을 쓰지 않는다)
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        # G-3 — enum 은 varchar + CHECK
        CheckConstraint(f"kind IN ({_KIND_VALUES})", name="ck_work_type_kind"),
        # A-5 — 색은 허용 팔레트 토큰명만
        CheckConstraint(
            f"color_token IN ({_COLOR_VALUES})", name="ck_work_type_color_token"
        ),
        # §4 — (account_id) WHERE deleted_at IS NULL
        Index(
            "ix_work_type_account_id_active",
            "account_id",
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


class Project(Base, TimestampMixin):
    """프로젝트. 이름 + 색뿐이다(DEC-001 §3). 기본 프로젝트는 없다."""

    __tablename__ = "project"

    id: Mapped[int] = pk_column()
    account_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("account.id", name="fk_project_account_id"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    color_token: Mapped[str] = mapped_column(String(30), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        CheckConstraint(
            f"color_token IN ({_COLOR_VALUES})", name="ck_project_color_token"
        ),
        Index(
            "ix_project_account_id_active",
            "account_id",
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )
