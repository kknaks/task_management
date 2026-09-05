"""enum 값의 정본(database/README.md G-3 · G-4).

Postgres native ENUM 을 쓰지 않는다 — `varchar` + `CHECK` 로 잡고 값의 정본은 여기다.
값은 **영문 소문자 snake_case** 로 저장한다. 한국어 라벨은 프론트가 매핑한다.
"""

from __future__ import annotations

from enum import StrEnum


class WorkTypeKind(StrEnum):
    """유형이 속하는 상위 축(DEC-001 §3)."""

    MEETING = "meeting"
    TASK = "task"


class ColorToken(StrEnum):
    """허용 팔레트 토큰명 8종(A-5 · SPEC-002 §4).

    자유 색상(임의 hex)을 저장하지 않는다. hex 는 프론트 토큰이 갖는다.
    """

    INDIGO = "indigo"
    VIOLET = "violet"
    STEEL = "steel"
    MINT = "mint"
    SKY = "sky"
    AMBER = "amber"
    ROSE = "rose"
    GRAPHITE = "graphite"
