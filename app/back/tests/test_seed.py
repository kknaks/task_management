"""SPEC-000 §5 시드 계약 — 멱등 · 비밀번호 규칙 · 기본 유형 3종."""

from __future__ import annotations

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.exceptions import ValidationError
from dto.enums import WorkTypeKind
from dto.seed import SeedValuesDTO
from models.account import Account, WorkType
from seed.seed import DEFAULT_WORK_TYPES, run_seed

VALID_VALUES = SeedValuesDTO(
    login_id="seed_tester",
    password="Seed!pass1",
    name="시드 계정",
    email="seed@example.test",
)


def _counts(session: Session) -> tuple[int, int]:
    accounts = session.scalar(select(func.count()).select_from(Account)) or 0
    work_types = session.scalar(select(func.count()).select_from(WorkType)) or 0
    return accounts, work_types


def test_seed_creates_one_account_and_three_default_work_types(
    sync_session: Session,
) -> None:
    result = run_seed(sync_session, VALID_VALUES)

    assert result.account_created is True
    assert result.work_types_created == 3
    assert _counts(sync_session) == (1, 3)

    work_types = sync_session.scalars(select(WorkType).order_by(WorkType.id)).all()
    assert [(wt.name, wt.kind) for wt in work_types] == [
        (default.name, default.kind.value) for default in DEFAULT_WORK_TYPES
    ]
    # 셋 다 기본 유형 표시가 켜져 있다(A-4)
    assert all(wt.is_default for wt in work_types)
    assert [wt.kind for wt in work_types].count(WorkTypeKind.MEETING.value) == 1


def test_seed_is_idempotent(sync_session: Session) -> None:
    """한 번 더 실행해도 오류가 없고 행 수가 그대로다."""
    run_seed(sync_session, VALID_VALUES)
    before = _counts(sync_session)

    second = run_seed(sync_session, VALID_VALUES)

    assert second.account_created is False
    assert second.work_types_created == 0
    assert _counts(sync_session) == before


def test_seed_stores_only_the_password_hash(sync_session: Session) -> None:
    run_seed(sync_session, VALID_VALUES)

    account = sync_session.scalars(
        select(Account).where(Account.login_id == VALID_VALUES.login_id)
    ).one()
    assert account.password_hash != VALID_VALUES.password
    assert account.password_hash.startswith("$2b$")


@pytest.mark.parametrize(
    "password",
    ["Short1!", "onlyletters!", "12345678!", "NoSpecial123"],
)
def test_seed_fails_when_password_violates_the_rule(
    sync_session: Session, password: str
) -> None:
    """8자 이상 + 문자·숫자·특수문자 위반이면 시드가 실패한다(DEC-001 §3 · A-2)."""
    values = SeedValuesDTO(
        login_id=VALID_VALUES.login_id,
        password=password,
        name=VALID_VALUES.name,
        email=VALID_VALUES.email,
    )

    with pytest.raises(ValidationError):
        run_seed(sync_session, values)

    assert _counts(sync_session) == (0, 0)
