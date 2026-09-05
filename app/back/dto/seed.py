"""시드 입력 dto — 값은 `SEED_*` env 에서 온다(SPEC-000 §5).

**소스에 계정 정보를 적지 않는다.**
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SeedValuesDTO:
    login_id: str
    password: str
    name: str
    email: str


@dataclass(frozen=True)
class SeedResultDTO:
    account_created: bool
    work_types_created: int
    account_total: int
    work_type_total: int
