"""내부 계층 이동용 dto — 프론트 계약이 아니다(backend/README.md §3).

입력도 dto 다(§3 규칙 3). router 가 `schema → dto` 로 바꿔 넘긴다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class LoginCommandDTO:
    login_id: str
    password: str


@dataclass(frozen=True)
class AccountCredentialDTO:
    """자격 증명 대조에 필요한 것만. **평문 비밀번호는 여기 없다.**"""

    id: int
    password_hash: str


@dataclass(frozen=True)
class AccountSummaryDTO:
    """SPEC-001 §4 `GET /api/auth/session` 의 계정 요약.

    `department` 는 「현재」 경력(`ended_on IS NULL`)에서 **파생**한다 — 없으면 `None`(A-3).
    """

    id: int
    login_id: str
    name: str
    email: str | None
    avatar_url: str | None
    department: str | None


@dataclass(frozen=True)
class AuthSessionDTO:
    """`auth_session` 한 행. **refresh 원문은 담지 않는다** — 해시만 있다(A-7)."""

    id: int
    account_id: int
    expires_at: datetime
    revoked_at: datetime | None


@dataclass(frozen=True)
class TokenBundleDTO:
    """SPEC-001 §4 Data Contract — 토큰 3종.

    `refresh_token` 은 이 응답으로 한 번 나가고 서버에는 해시만 남는다.
    """

    access_token: str
    expires_in: int
    refresh_token: str
