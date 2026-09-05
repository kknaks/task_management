"""2층 — 인증 도메인 규칙. `fastapi` 도 `schemas/` 도 import 하지 않는다.

정본: SPEC-001 §4 Case Matrix(에러) · §5(토큰 취급) · `domains/account.md` A-7·A-8.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from core.exceptions import NotFoundError, RefreshTokenReuseError, UnauthorizedError
from core.security import (
    burn_password_verification,
    create_access_token,
    generate_refresh_token,
    hash_refresh_token,
    verify_password,
)
from dto.auth import AccountSummaryDTO, LoginCommandDTO, TokenBundleDTO
from repository import account_repository, auth_session_repository

# SPEC-001 §4 Case Matrix — 문구까지 계약이다.
_INVALID_CREDENTIALS = "아이디 또는 비밀번호가 올바르지 않습니다"
_INVALID_REFRESH_TOKEN = "다시 로그인해 주세요"


def _invalid_credentials() -> UnauthorizedError:
    """**아이디가 없는 경우와 비밀번호가 틀린 경우가 같은 응답이다.**

    어느 쪽이 틀렸는지 알려주면 계정 존재가 샌다(SPEC-001 §4 · Pre-deploy Check).
    """
    return UnauthorizedError(_INVALID_CREDENTIALS, code="invalid_credentials")


def _invalid_refresh_token() -> UnauthorizedError:
    return UnauthorizedError(_INVALID_REFRESH_TOKEN, code="invalid_refresh_token")


async def _issue_tokens(
    session: AsyncSession, *, account_id: int, now: datetime
) -> TokenBundleDTO:
    """access JWT + 새 `auth_session` 행 하나. **회전도 로그인도 이 경로 하나를 쓴다.**"""
    settings = get_settings()

    access_token, expires_in = create_access_token(
        account_id,
        secret=settings.jwt_secret,
        ttl_minutes=settings.access_token_ttl_min,
        now=now,
    )
    refresh_token = generate_refresh_token()

    await auth_session_repository.create(
        session,
        account_id=account_id,
        refresh_token_hash=hash_refresh_token(refresh_token),
        expires_at=now + timedelta(days=settings.refresh_token_ttl_days),
    )

    return TokenBundleDTO(
        access_token=access_token,
        expires_in=expires_in,
        refresh_token=refresh_token,
    )


async def login(session: AsyncSession, command: LoginCommandDTO) -> TokenBundleDTO:
    """자격 증명 검증 → 세션 발급.

    **실패 횟수를 세지 않고 잠그지 않는다**(A-8 · DEC-001 §4) — 몇 번을 틀려도 같은 응답이다.
    """
    credential = await account_repository.find_credential_by_login_id(
        session, command.login_id
    )

    if credential is None:
        burn_password_verification()
        raise _invalid_credentials()

    if not verify_password(command.password, credential.password_hash):
        raise _invalid_credentials()

    return await _issue_tokens(session, account_id=credential.id, now=datetime.now(UTC))


async def refresh(session: AsyncSession, refresh_token: str) -> TokenBundleDTO:
    """refresh 회전(A-7).

    쓴 토큰은 **즉시 무효**가 되고 새 행이 생긴다. 이미 무효인 토큰이 다시 오면
    **탈취로 보고 그 계정의 유효 세션을 전부 끊는다.**
    """
    now = datetime.now(UTC)
    stored = await auth_session_repository.find_by_token_hash(
        session, hash_refresh_token(refresh_token)
    )

    if stored is None:
        raise _invalid_refresh_token()

    if stored.revoked_at is not None:
        # 재사용 감지 — 옛 토큰이 돌아왔다는 것은 사본이 있다는 뜻이다.
        # 이 무효화는 **401 과 함께 남아야 한다** → `RefreshTokenReuseError`(A-7).
        await auth_session_repository.revoke_all_for_account(
            session, account_id=stored.account_id, revoked_at=now
        )
        raise RefreshTokenReuseError(_INVALID_REFRESH_TOKEN)

    if stored.expires_at <= now:
        raise _invalid_refresh_token()

    await auth_session_repository.revoke(session, session_id=stored.id, revoked_at=now)
    return await _issue_tokens(session, account_id=stored.account_id, now=now)


async def logout(session: AsyncSession, *, account_id: int, refresh_token: str) -> None:
    """**이 세션의 refresh 만** 무효화한다. 「다른 기기 모두 로그아웃」은 v2 다.

    이미 무효거나 없는 토큰, 남의 계정 토큰이면 **아무것도 하지 않고 성공으로 끝낸다** —
    로그아웃의 사후 조건(그 토큰으로 더는 갱신되지 않는다)이 이미 성립하고,
    실패로 돌려주면 토큰의 존재 여부가 샌다. SPEC-001 §4 Case Matrix 에 로그아웃 에러는 없다.
    """
    stored = await auth_session_repository.find_by_token_hash(
        session, hash_refresh_token(refresh_token)
    )

    if stored is None or stored.account_id != account_id or stored.revoked_at is not None:
        return

    await auth_session_repository.revoke(
        session, session_id=stored.id, revoked_at=datetime.now(UTC)
    )


async def get_account_summary(
    session: AsyncSession, account_id: int
) -> AccountSummaryDTO:
    """세션 계정 요약. `department` 는 「현재」 경력에서 파생한다(A-3)."""
    summary = await account_repository.find_summary_by_id(session, account_id)
    if summary is None:
        raise NotFoundError("계정을 찾을 수 없습니다")
    return summary
