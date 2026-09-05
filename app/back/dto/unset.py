"""부분 수정(PATCH)의 「보내지 않음」 표식(backend/README.md §3 규칙 4).

`None` 을 그 자리에 쓸 수 없다 — **「보내지 않음」과 「null 로 지움」은 다른 뜻**이고,
인라인 자동 저장이 필드 하나만 보내기 때문에 이 구분이 실제로 필요하다(SPEC-002 §5).

    name: str | Unset = UNSET
    if dto.name is not UNSET:
        ...  # 보낸 필드만 바꾼다

`Enum` 으로 두는 이유 — 값이 하나뿐인 enum 은 타입 검사기가 `is UNSET` 을 좁혀 준다.
"""

from __future__ import annotations

from enum import Enum


class Unset(Enum):
    """값이 하나뿐인 sentinel 타입."""

    UNSET = "unset"

    def __bool__(self) -> bool:
        return False

    def __repr__(self) -> str:
        return "UNSET"


UNSET = Unset.UNSET
