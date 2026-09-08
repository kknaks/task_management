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
    decode_access_token,
    generate_meeting_token,
    generate_refresh_token,
    hash_refresh_token,
    verify_password,
)
from dto.auth import (
    AccountContextDTO,
    AccountSummaryDTO,
    LoginCommandDTO,
    TokenBundleDTO,
)
from repository import account_repository, auth_session_repository

# SPEC-001 §4 Case Matrix — 문구까지 계약이다.
_INVALID_CREDENTIALS = "아이디 또는 비밀번호가 올바르지 않습니다"
_INVALID_REFRESH_TOKEN = "다시 로그인해 주세요"
_TOKEN_EXPIRED = "세션이 만료되었습니다"


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


# --- 회의별 단명 토큰 (A-13 · MF-69 · WP §Internal Interface Contract) -------------
#
# refresh 와 **다른 규칙**으로 산다 — 원문 저장 · 회전 없음 · `revoked_at` 안 찍음 · 폐기 = 행 삭제.
# 그래서 위의 `_issue_tokens` / `refresh` / `logout` 경로를 재사용하지 않는다.


async def issue_meeting_token(
    session: AsyncSession, *, account_id: int, meeting_id: int
) -> str:
    """`/start` 가 전이와 **같은 트랜잭션**에서 부른다. 원문을 INSERT 하고 그 원문을 돌려준다.

    **회의 하나에 하나**다(A-13) — 재발급하지 않는다. 제출부는 `get_meeting_token()` 으로 같은 값을 다시 읽는다.
    """
    now = datetime.now(UTC)
    token = generate_meeting_token()
    await auth_session_repository.create_meeting_token(
        session,
        account_id=account_id,
        meeting_id=meeting_id,
        token=token,
        expires_at=now + timedelta(minutes=get_settings().meeting_token_ttl_min),
    )
    return token


async def get_meeting_token(session: AsyncSession, *, meeting_id: int) -> str | None:
    """제출부가 헤더에 실을 원문. **없거나 만료면 `None`** — 여기서 재발급하지 않는다.

    돌아온 값은 `build_codex_options(meeting_token=…)` 로만 간다. 로그·응답에 싣지 않는다(정적 검사).
    """
    return await auth_session_repository.get_meeting_token(
        session, meeting_id=meeting_id, now=datetime.now(UTC)
    )


async def revoke_meeting_token(session: AsyncSession, *, meeting_id: int) -> int:
    """**폐기 = 행 DELETE**(A-13). 0건이어도 예외가 없다 — best-effort 이고 실패는 만료가 흡수한다(MF-4).

    부르는 자리는 종료 파이프라인 ② 뒤다(WORK-012). 이 work 는 함수만 낸다.
    """
    return await auth_session_repository.delete_meeting_tokens(
        session, meeting_id=meeting_id
    )


async def resolve_bearer(session: AsyncSession, token: str) -> AccountContextDTO:
    """Bearer 하나를 계정(+회의) 범위로 푼다 — **인증 갈래가 둘인 유일한 자리**(WP §Internal Interface).

    ① 사용자 세션 JWT → `(account_id, meeting_id=None)`. **DB 를 보지 않는다**(지금 그대로).
    ② 실패하면 회의 토큰 원문 조회 → 있으면 `(account_id, meeting_id)`.
    ③ 둘 다 아니면 `401 token_expired` — **응답은 지금과 하나**다. 어느 갈래에서 떨어졌는지 흘리지 않는다.

    두 토큰은 **서로를 대신하지 못한다**: 회의 토큰은 JWT 서명이 없어 ①에서 떨어지고,
    세션 JWT 는 `auth_session` 에 원문으로 있지 않아 ②에서 떨어진다.
    """
    try:
        account_id = decode_access_token(token, secret=get_settings().jwt_secret)
    except UnauthorizedError:
        stored = await auth_session_repository.find_meeting_token(
            session, token, now=datetime.now(UTC)
        )
        if stored is None or stored.meeting_id is None:
            raise UnauthorizedError(_TOKEN_EXPIRED, code="token_expired") from None
        return AccountContextDTO(
            account_id=stored.account_id, meeting_id=stored.meeting_id
        )

    return AccountContextDTO(account_id=account_id, meeting_id=None)
