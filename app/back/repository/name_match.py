"""이름 유일성 비교의 정규화 — **SQL 표현 한 곳**(SPEC-002 §4 Validation).

「대소문자·공백을 정규화해 비교한다」를 유형과 프로젝트가 **같은 방식으로** 판정해야 한다.
두 repository 에 정규식을 각각 적으면 언젠가 갈리므로 여기 한 번만 둔다.

**저장 값은 사용자가 넣은 그대로**(앞뒤 공백만 제거)다 — 정규화는 **비교에만** 쓴다.
"""

from __future__ import annotations

from sqlalchemy import ColumnElement, func


def normalize_for_compare(value: str) -> str:
    """파이썬 쪽 정규화 — 아래 SQL 표현과 **같은 규칙**이어야 한다."""
    return " ".join(value.split()).lower()


def normalized_column(column: ColumnElement[str]) -> ColumnElement[str]:
    """SQL 쪽 정규화 — 소문자 + 연속 공백을 하나로 + 앞뒤 공백 제거."""
    return func.btrim(func.regexp_replace(func.lower(column), r"\s+", " ", "g"))
