"""SQLAlchemy 선언 기반 + 공통 믹스인(database/README.md G-1 · G-2 · G-6)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Identity, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def pk_column() -> Mapped[int]:
    """G-1 — PK 는 `bigint GENERATED ALWAYS AS IDENTITY`. slug·영문명 필드를 두지 않는다."""
    return mapped_column(BigInteger, Identity(always=True), primary_key=True)


class TimestampMixin:
    """G-6 — 모든 도메인 테이블 공통. G-2 에 따라 `timestamptz`(저장은 UTC)."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
        onupdate=text("now()"),
    )
