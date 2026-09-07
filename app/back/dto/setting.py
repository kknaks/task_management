"""업무 설정(유형·프로젝트)의 내부 계층 이동용 dto — 프론트 계약이 아니다(§3).

**입력도 dto 다**(§3 규칙 3) — router 가 `schema → dto` 로 바꿔 넘긴다.
부분 수정은 `T | Unset` 로 「보내지 않음」을 표현한다(§3 규칙 4).
"""

from __future__ import annotations

from dataclasses import dataclass

from dto.unset import UNSET, Unset


@dataclass(frozen=True)
class WorkTypeDTO:
    """유형 한 건. `kind` 는 영문 소문자로 저장·전송한다(DB G-4). `description` 은 비어 있을 수 있다(A-12 · 선택 입력)."""

    id: int
    kind: str
    name: str
    color_token: str
    description: str | None
    is_default: bool


@dataclass(frozen=True)
class WorkTypeCreateDTO:
    kind: str
    name: str
    color_token: str
    description: str | None = None


@dataclass(frozen=True)
class WorkTypeUpdateDTO:
    """**`kind` 가 없다** — 종류는 생성 시에만 정해진다(SPEC-002 §5).

    이미 참조된 유형의 종류를 바꾸면 기존 참조가 규약을 어긴 상태가 된다.
    **`description` 만 `None` 을 값으로 받는다** — 「설명을 지운다」는 뜻이 있는 유일한 필드다(SPEC-002 §4).
    """

    name: str | Unset = UNSET
    color_token: str | Unset = UNSET
    description: str | None | Unset = UNSET


@dataclass(frozen=True)
class ProjectDTO:
    id: int
    name: str
    color_token: str


@dataclass(frozen=True)
class ProjectCreateDTO:
    name: str
    color_token: str


@dataclass(frozen=True)
class ProjectUpdateDTO:
    name: str | Unset = UNSET
    color_token: str | Unset = UNSET
