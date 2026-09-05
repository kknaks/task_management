"""비밀번호 해시·규칙 검증 · access JWT · refresh 토큰(SPEC-001 §4·§5).

- 비밀번호는 bcrypt. **해시만 저장**한다(A-2).
- access 는 JWT(HS256, 1시간). 서명 키는 `Settings.jwt_secret` 이고 **코드에 상수로 박지 않는다**.
- refresh 는 **의미 없는 난수 문자열**(opaque)이다. 서버는 **해시만** 갖는다(A-7 · SPEC-001 Data Contract).
  대조 조회가 필요하므로(=`uq_auth_session_refresh_token_hash`) 해시는 SHA-256 이다 —
  bcrypt 는 salt 때문에 해시로 찾을 수 없다. 원문이 384비트 난수라 사전 공격 대상이 아니다.
"""

from __future__ import annotations

import hashlib
import re
import secrets
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt

from core.exceptions import UnauthorizedError, ValidationError

# DEC-001 §3 / A-2 — 8자 이상 + 문자·숫자·특수문자
_MIN_LENGTH = 8
_LETTER = re.compile(r"[A-Za-z]")
_DIGIT = re.compile(r"[0-9]")
_SPECIAL = re.compile(r"[^A-Za-z0-9]")

_JWT_ALGORITHM = "HS256"
# access 토큰임을 명시한다 — refresh 는 JWT 가 아니지만, 다른 용도의 JWT 가 생겨도
# 서로의 자리에 끼워 넣을 수 없게 한다.
_ACCESS_TOKEN_TYPE = "access"
# refresh 원문 길이(바이트). 48바이트 = 384비트.
_REFRESH_TOKEN_BYTES = 48

# 아이디가 없을 때도 같은 비용의 검증을 태워 **계정 존재가 응답 시간으로 새지 않게** 한다.
_DUMMY_PASSWORD_HASH = bcrypt.hashpw(b"dummy-password-for-timing", bcrypt.gensalt()).decode(
    "utf-8"
)


def validate_password_strength(password: str) -> None:
    """규칙 위반이면 `ValidationError` 를 던진다. **평문을 로그·메시지에 싣지 않는다.**"""
    problems: list[str] = []
    if len(password) < _MIN_LENGTH:
        problems.append(f"{_MIN_LENGTH}자 이상")
    if not _LETTER.search(password):
        problems.append("문자 포함")
    if not _DIGIT.search(password):
        problems.append("숫자 포함")
    if not _SPECIAL.search(password):
        problems.append("특수문자 포함")
    if problems:
        raise ValidationError(
            "비밀번호 규칙을 만족하지 않습니다: " + " · ".join(problems),
            code="invalid_password",
        )


def hash_password(password: str) -> str:
    """bcrypt 해시(backend/README.md §9). 해시만 저장하고 평문은 남기지 않는다."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def burn_password_verification() -> None:
    """계정이 없을 때 쓰는 **빈 검증**.

    아이디가 틀렸을 때만 즉시 돌아오면 응답 시간으로 계정 존재가 샌다
    (SPEC-001 §4 — 두 실패가 구분되면 안 된다).
    """
    bcrypt.checkpw(b"dummy-password-for-timing", _DUMMY_PASSWORD_HASH.encode("utf-8"))


def create_access_token(
    account_id: int, *, secret: str, ttl_minutes: int, now: datetime | None = None
) -> tuple[str, int]:
    """access JWT 와 남은 수명(초)을 돌려준다. `expiresIn` 이 그 초 값이다."""
    issued_at = now or datetime.now(UTC)
    expires_at = issued_at + timedelta(minutes=ttl_minutes)
    token = jwt.encode(
        {
            "sub": str(account_id),
            "type": _ACCESS_TOKEN_TYPE,
            "iat": int(issued_at.timestamp()),
            "exp": int(expires_at.timestamp()),
        },
        secret,
        algorithm=_JWT_ALGORITHM,
    )
    return token, ttl_minutes * 60


def decode_access_token(token: str, *, secret: str) -> int:
    """검증에 성공하면 `account_id` 를 돌려준다.

    만료·서명 위조·형식 오류는 **모두 같은 `401 token_expired`** 다
    (SPEC-001 §4 Case Matrix — 인증 실패에 쓸 코드는 이것뿐이고,
    프론트는 갱신 1회 → 실패 시 로그인 화면으로 끝난다. 무한 루프가 없다).
    **왜 거부됐는지 응답에 싣지 않는다.**
    """
    try:
        payload = jwt.decode(token, secret, algorithms=[_JWT_ALGORITHM])
    except jwt.InvalidTokenError as exc:  # 만료·서명 불일치·형식 오류가 모두 이 하위다
        raise UnauthorizedError("세션이 만료되었습니다", code="token_expired") from exc

    if payload.get("type") != _ACCESS_TOKEN_TYPE:
        raise UnauthorizedError("세션이 만료되었습니다", code="token_expired")

    subject = payload.get("sub")
    if not isinstance(subject, str) or not subject.isdigit():
        raise UnauthorizedError("세션이 만료되었습니다", code="token_expired")

    return int(subject)


def generate_refresh_token() -> str:
    """opaque refresh 원문. **서버에 원문을 남기지 않는다** — 응답으로만 나간다."""
    return secrets.token_urlsafe(_REFRESH_TOKEN_BYTES)


def hash_refresh_token(token: str) -> str:
    """대조용 해시. 저장·조회 모두 이 값만 쓴다(A-7)."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
