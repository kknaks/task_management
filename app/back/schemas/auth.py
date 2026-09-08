"""SPEC-001 §4 — 인증 4표면의 프론트 ↔ 백 계약.

키는 camelCase 다(backend/README.md §3 규칙 6). 검증 규칙은 SPEC-001 §4 Validation 표 그대로다.
"""

from __future__ import annotations

from typing import Annotated

from pydantic import StringConstraints

from dto.auth import AccountSummaryDTO, LoginCommandDTO, TokenBundleDTO
from schemas.base import CamelModel

# 앞뒤 공백 제거 후 1자 이상. **이메일 형식을 요구하지 않는다**(A-1 · §A-9).
LoginId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
# 1자 이상. **로그인 시점에는 강도 규칙을 검사하지 않는다**(DEC-001 §3).
# 공백도 비밀번호의 일부라 trim 하지 않는다.
Password = Annotated[str, StringConstraints(min_length=1)]
# 형식 검사를 하지 않는다 — 유효성은 대조로 판정한다.
RefreshToken = Annotated[str, StringConstraints(min_length=1)]


class LoginRequest(CamelModel):
    login_id: LoginId
    password: Password

    def to_dto(self) -> LoginCommandDTO:
        return LoginCommandDTO(login_id=self.login_id, password=self.password)


class RefreshRequest(CamelModel):
    refresh_token: RefreshToken


class LogoutRequest(CamelModel):
    refresh_token: RefreshToken


class TokenResponse(CamelModel):
    """`accessToken` · `expiresIn`(초) · `refreshToken`. **회전마다 셋 다 새로 나간다.**"""

    access_token: str
    expires_in: int
    refresh_token: str

    @classmethod
    def from_dto(cls, dto: TokenBundleDTO) -> "TokenResponse":
        return cls(
            access_token=dto.access_token,
            expires_in=dto.expires_in,
            refresh_token=dto.refresh_token,
        )


class AccountSummary(CamelModel):
    """`id` 는 number 다(§3 · FE §3-6). `department` 는 파생값이라 `null` 가능."""

    id: int
    login_id: str
    name: str
    email: str | None
    avatar_url: str | None
    department: str | None


class SessionResponse(CamelModel):
    account: AccountSummary

    @classmethod
    def from_dto(cls, dto: AccountSummaryDTO) -> "SessionResponse":
        return cls(
            account=AccountSummary(
                id=dto.id,
                login_id=dto.login_id,
                name=dto.name,
                email=dto.email,
                avatar_url=dto.avatar_url,
                department=dto.department,
            )
        )
