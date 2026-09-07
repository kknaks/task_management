"""시드 — 계정 1 + 기본 유형 3종. **멱등**이다(SPEC-000 §5 시드 계약).

- 마이그레이션 **이후**에만 돈다. 자동 기동에 묶지 않는다 — `make seed` 로 명시 실행한다.
- 비밀번호는 규칙(8자 이상 + 문자·숫자·특수문자)을 만족해야 하고, **해시만 저장**한다.
  규칙 위반이면 시드가 실패한다(DEC-001 §3 · A-2).
- 마이그레이션은 동기 psycopg3 를 쓴다 — 시드도 같다(backend/README.md §5).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from config import get_seed_settings, get_settings
from core.security import hash_password, validate_password_strength
from dto.enums import ColorToken, WorkTypeKind
from dto.seed import SeedResultDTO, SeedValuesDTO
from models.account import Account, WorkType

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _DefaultWorkType:
    name: str
    kind: WorkTypeKind
    color_token: ColorToken
    description: str | None


# SPEC-000 §4 Data Contract — 기본 유형 3종. 색 토큰은 SPEC-002 §4 가 정본이다.
# 설명 문구는 A-12 가 정본이다 — **미팅·회의는 빈 값**이다(DEC-003 OQ-11 · 문구가 정해지지 않았다).
# 리비전 `0009` 가 **이미 있는 계정의 행에** 같은 문구를 UPDATE 한다 — 여기는 새로 만들 때의 값이다.
DEFAULT_WORK_TYPES: tuple[_DefaultWorkType, ...] = (
    _DefaultWorkType("미팅·회의", WorkTypeKind.MEETING, ColorToken.INDIGO, None),
    _DefaultWorkType("개인 업무", WorkTypeKind.TASK, ColorToken.VIOLET, "혼자 처리하는 실무. 개발·수정·확인 등"),
    _DefaultWorkType("문서·보고", WorkTypeKind.TASK, ColorToken.STEEL, "산출물이 문서인 것. 기획서·보고서·회의록 정리"),
)


def _upsert_account(session: Session, values: SeedValuesDTO) -> tuple[Account, bool]:
    """로그인 식별자 기준 1건. 있으면 시드 값으로 맞춘다(비밀번호 재설정 경로다)."""
    account = session.scalars(
        select(Account).where(Account.login_id == values.login_id)
    ).one_or_none()

    created = account is None
    if account is None:
        account = Account(login_id=values.login_id)
        session.add(account)

    account.name = values.name
    account.email = values.email
    account.password_hash = hash_password(values.password)
    session.flush()
    return account, created


def _upsert_default_work_types(session: Session, account_id: int) -> int:
    """기본 3종을 이름 기준으로 맞춘다.

    이름·종류·기본 표시는 **잠긴 값**이라 시드가 강제한다(A-4).
    `color_token` · `description` 은 **사용자가 편집할 수 있는 값**이라 새로 만들 때만 넣는다 —
    재실행이 사용자의 색·설명 변경을 덮어쓰지 않는다(A-12 — 기본 3종도 설명은 편집 가능).
    """
    created = 0
    for default in DEFAULT_WORK_TYPES:
        work_type = session.scalars(
            select(WorkType).where(
                WorkType.account_id == account_id, WorkType.name == default.name
            )
        ).one_or_none()

        if work_type is None:
            session.add(
                WorkType(
                    account_id=account_id,
                    kind=default.kind.value,
                    name=default.name,
                    color_token=default.color_token.value,
                    description=default.description,
                    is_default=True,
                )
            )
            created += 1
            continue

        work_type.kind = default.kind.value
        work_type.is_default = True
        # 기본 3종은 삭제할 수 없다(A-4) — 되살려 둔다.
        work_type.deleted_at = None

    session.flush()
    return created


def run_seed(session: Session, values: SeedValuesDTO) -> SeedResultDTO:
    """멱등. 여러 번 실행해도 행 수가 늘지 않는다."""
    validate_password_strength(values.password)

    account, account_created = _upsert_account(session, values)
    work_types_created = _upsert_default_work_types(session, account.id)

    return SeedResultDTO(
        account_created=account_created,
        work_types_created=work_types_created,
        account_total=session.scalar(select(func.count()).select_from(Account)) or 0,
        work_type_total=session.scalar(
            select(func.count())
            .select_from(WorkType)
            .where(WorkType.account_id == account.id)
        )
        or 0,
    )


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    settings = get_settings()
    seed_settings = get_seed_settings()
    values = SeedValuesDTO(
        login_id=seed_settings.login_id,
        password=seed_settings.password,
        name=seed_settings.name,
        email=seed_settings.email,
    )

    engine = create_engine(settings.database_url)
    try:
        with Session(engine) as session:
            result = run_seed(session, values)
            session.commit()
    finally:
        engine.dispose()

    # 평문 비밀번호는 어디에도 남기지 않는다.
    logger.info(
        "시드 완료 — account %d행(신규 %s) · work_type %d행(신규 %d)",
        result.account_total,
        "예" if result.account_created else "아니오",
        result.work_type_total,
        result.work_types_created,
    )


if __name__ == "__main__":
    main()
