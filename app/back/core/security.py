"""비밀번호 해시·규칙 검증.

JWT 발급/검증은 WORK-002(SPEC-001)가 이 파일에 채운다 — 지금은 비밀번호만 다룬다.
"""

from __future__ import annotations

import re

import bcrypt

from core.exceptions import ValidationError

# DEC-001 §3 / A-2 — 8자 이상 + 문자·숫자·특수문자
_MIN_LENGTH = 8
_LETTER = re.compile(r"[A-Za-z]")
_DIGIT = re.compile(r"[0-9]")
_SPECIAL = re.compile(r"[^A-Za-z0-9]")


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
