"""허용 색 팔레트 — **서버 검증의 단일 출처**(SPEC-002 §4 Data Contract · A-5).

토큰명 8종의 **값 자체**는 `dto/enums.py` 의 `ColorToken` 에 이미 있다(WORK-001).
`work_type.color_token`·`project.color_token` 의 DB CHECK 제약도 그 enum 에서 생성된다 —
여기서 8종을 다시 나열하면 **정의가 둘이 되고** 언젠가 갈린다(WORK-003 Done Criteria
「팔레트 8종이 서버 상수와 CSS 변수 두 곳에만 정의돼 있다 — 중복 정의 없음」).

그래서 이 파일은 **값을 갖지 않고 검증만** 갖는다. 팔레트를 늘리려면 `dto/enums.py` 와
프론트 `tokens.css` 두 곳만 고치면 된다(SPEC-002 §4 규칙 4 · S002-OQ-5).
"""

from __future__ import annotations

from core.exceptions import ValidationError
from dto.enums import ColorToken

# 값의 정본은 `ColorToken` 이다. 이 집합은 그 파생이다.
ALLOWED_COLOR_TOKENS: frozenset[str] = frozenset(token.value for token in ColorToken)


def validate_color_token(color_token: str) -> str:
    """팔레트 밖 값·임의 hex 는 거부한다(SPEC-002 §4 Case Matrix `invalid_color_token`).

    「비슷한 색으로 떨어뜨리기」 같은 조용한 대체를 하지 않는다 — 거부한다.
    """
    if color_token not in ALLOWED_COLOR_TOKENS:
        raise ValidationError("허용된 색이 아닙니다", code="invalid_color_token", field="colorToken")
    return color_token
