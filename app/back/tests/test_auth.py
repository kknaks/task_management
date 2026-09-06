"""SPEC-001 §4 — 인증 4표면의 계약과 Case Matrix.

정본: SPEC-001 §4(API·Validation·Case Matrix) · §5(토큰 취급) · `domains/account.md` A-7·A-8.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from core.security import create_access_token, hash_password, hash_refresh_token
from models.account import Account, AuthSession, Career

PASSWORD = "Auth!test1"


async def _create_account(
    session: AsyncSession, *, login_id: str, name: str = "테스트 계정"
) -> Account:
    account = Account(
        login_id=login_id,
        password_hash=hash_password(PASSWORD),
        name=name,
        email=f"{login_id}@example.test",
    )
    session.add(account)
    await session.flush()
    return account


@pytest.fixture
async def account(db_session: AsyncSession) -> Account:
    return await _create_account(db_session, login_id="auth_tester", name="인증 테스터")


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _login(client: AsyncClient, login_id: str) -> dict:
    response = await client.post(
        "/api/auth/login", json={"loginId": login_id, "password": PASSWORD}
    )
    assert response.status_code == 200
    return response.json()


# --- 로그인 -------------------------------------------------------------


async def test_login_returns_the_three_tokens(
    client: AsyncClient, account: Account
) -> None:
    """SPEC-001 §4 — `accessToken` · `expiresIn` · `refreshToken`."""
    body = await _login(client, account.login_id)

    assert set(body) == {"accessToken", "expiresIn", "refreshToken"}
    assert body["expiresIn"] == get_settings().access_token_ttl_min * 60
    assert body["accessToken"] and body["refreshToken"]


async def test_login_trims_the_login_id(client: AsyncClient, account: Account) -> None:
    """`loginId` 는 앞뒤 공백을 제거한 뒤 대조한다(§4 Validation)."""
    response = await client.post(
        "/api/auth/login",
        json={"loginId": f"  {account.login_id}  ", "password": PASSWORD},
    )

    assert response.status_code == 200


async def test_login_does_not_check_password_strength(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """로그인 시점에는 강도 규칙을 검사하지 않는다(§4 Validation · DEC-001 §3).

    규칙에 못 미치는 비밀번호를 가진 계정도 **자격 증명이 맞으면 들어온다** —
    강도는 계정을 만들거나 바꿀 때의 규칙이다.
    """
    weak = "abc"
    account = Account(
        login_id="weak_pw_account",
        password_hash=hash_password(weak),
        name="약한 비밀번호",
        email=None,
    )
    db_session.add(account)
    await db_session.flush()

    response = await client.post(
        "/api/auth/login", json={"loginId": account.login_id, "password": weak}
    )

    assert response.status_code == 200


async def test_wrong_password_and_unknown_login_id_are_indistinguishable(
    client: AsyncClient, account: Account
) -> None:
    """**어느 쪽이 틀렸는지 알려주지 않는다** — 계정 존재가 새면 실패다(Pre-deploy Check)."""
    wrong_password = await client.post(
        "/api/auth/login",
        json={"loginId": account.login_id, "password": "Wrong!pass9"},
    )
    unknown_id = await client.post(
        "/api/auth/login",
        json={"loginId": "no_such_account", "password": PASSWORD},
    )

    assert wrong_password.status_code == unknown_id.status_code == 401
    assert wrong_password.json() == unknown_id.json()
    assert wrong_password.json() == {
        "detail": "아이디 또는 비밀번호가 올바르지 않습니다",
        "code": "invalid_credentials",
    }


async def test_repeated_failures_do_not_lock_the_account(
    client: AsyncClient, account: Account
) -> None:
    """실패 횟수를 세지 않는다(A-8 · DEC-001 §4) — 다섯 번 틀려도 응답이 같고 그 뒤 로그인된다."""
    responses = [
        await client.post(
            "/api/auth/login",
            json={"loginId": account.login_id, "password": "Wrong!pass9"},
        )
        for _ in range(5)
    ]

    assert {r.status_code for r in responses} == {401}
    assert len({r.text for r in responses}) == 1

    await _login(client, account.login_id)


@pytest.mark.parametrize(
    "body",
    [
        {"loginId": "", "password": PASSWORD},
        {"loginId": "   ", "password": PASSWORD},
        {"loginId": "auth_tester", "password": ""},
        {"password": PASSWORD},
        {"loginId": "auth_tester"},
    ],
)
async def test_invalid_login_body_is_422_validation_error(
    client: AsyncClient, body: dict
) -> None:
    """Case Matrix — `422 validation_error`. 어느 필드가 틀렸는지 싣지 않는다."""
    response = await client.post("/api/auth/login", json=body)

    assert response.status_code == 422
    body_json = response.json()
    # WORK-007 이 `field` 를 더했다(어느 칸이 틀렸는지). 두 키는 그대로다
    assert (body_json["detail"], body_json["code"]) == ("입력값을 확인해 주세요", "validation_error")
    assert "field" in body_json


# --- 세션 조회 · 인증 게이트 ---------------------------------------------


async def test_session_without_a_token_is_401(client: AsyncClient) -> None:
    response = await client.get("/api/auth/session")

    assert response.status_code == 401
    assert response.json() == {"detail": "세션이 만료되었습니다", "code": "token_expired"}


async def test_session_returns_the_account_summary(
    client: AsyncClient, account: Account
) -> None:
    tokens = await _login(client, account.login_id)

    response = await client.get(
        "/api/auth/session", headers=_auth(tokens["accessToken"])
    )

    assert response.status_code == 200
    assert response.json() == {
        "account": {
            "id": account.id,
            "loginId": account.login_id,
            "name": account.name,
            "email": account.email,
            "avatarUrl": None,
            # 재직 중 경력이 없으면 `null` 이다(A-3)
            "department": None,
        }
    }


async def test_session_department_comes_from_the_current_career(
    client: AsyncClient, db_session: AsyncSession, account: Account
) -> None:
    """`department` 는 「현재」 경력(`ended_on IS NULL`)에서 파생한다 — 끝난 경력은 쓰지 않는다."""
    db_session.add_all(
        [
            Career(
                account_id=account.id,
                company_name="옛 회사",
                department="옛 부서",
                started_on=date(2020, 1, 1),
                ended_on=date(2023, 1, 1),
            ),
            Career(
                account_id=account.id,
                company_name="현재 회사",
                department="제품기획팀",
                started_on=date(2023, 2, 1),
                ended_on=None,
            ),
        ]
    )
    await db_session.flush()
    tokens = await _login(client, account.login_id)

    response = await client.get(
        "/api/auth/session", headers=_auth(tokens["accessToken"])
    )

    assert response.json()["account"]["department"] == "제품기획팀"


async def test_expired_access_token_is_rejected(
    client: AsyncClient, account: Account
) -> None:
    settings = get_settings()
    expired, _ = create_access_token(
        account.id,
        secret=settings.jwt_secret,
        ttl_minutes=settings.access_token_ttl_min,
        # 발급 시각을 수명보다 더 과거로 밀어 이미 만료된 토큰을 만든다.
        now=datetime.now(UTC) - timedelta(minutes=settings.access_token_ttl_min + 1),
    )

    response = await client.get("/api/auth/session", headers=_auth(expired))

    assert response.status_code == 401
    assert response.json()["code"] == "token_expired"


async def test_tampered_access_token_is_rejected(
    client: AsyncClient, account: Account
) -> None:
    """다른 키로 서명한 토큰은 거부된다 — **왜 거부됐는지는 응답이 구분하지 않는다.**"""
    forged, _ = create_access_token(
        account.id, secret="not-the-real-secret-but-long-enough-for-hs256", ttl_minutes=60
    )

    response = await client.get("/api/auth/session", headers=_auth(forged))

    assert response.status_code == 401
    assert response.json()["code"] == "token_expired"


# --- 갱신 · 회전 · 재사용 감지 -------------------------------------------


async def test_refresh_rotates_and_the_old_token_is_rejected(
    client: AsyncClient, account: Account
) -> None:
    """A-7 — 쓴 refresh 는 **즉시 무효**고 새 토큰이 온다."""
    first = await _login(client, account.login_id)

    rotated = await client.post(
        "/api/auth/refresh", json={"refreshToken": first["refreshToken"]}
    )

    assert rotated.status_code == 200
    second = rotated.json()
    assert second["refreshToken"] != first["refreshToken"]

    # 새 access 로 보호된 경로가 열린다
    ok = await client.get("/api/auth/session", headers=_auth(second["accessToken"]))
    assert ok.status_code == 200


async def test_reused_refresh_token_revokes_every_session_of_that_account(
    client: AsyncClient, db_session: AsyncSession, account: Account
) -> None:
    """A-7 재사용 감지 — 무효화된 refresh 가 다시 오면 **그 계정의 다른 세션도 끊긴다.**"""
    first = await _login(client, account.login_id)
    other_device = await _login(client, account.login_id)
    rotated = (
        await client.post(
            "/api/auth/refresh", json={"refreshToken": first["refreshToken"]}
        )
    ).json()

    reuse = await client.post(
        "/api/auth/refresh", json={"refreshToken": first["refreshToken"]}
    )

    assert reuse.status_code == 401
    assert reuse.json() == {"detail": "다시 로그인해 주세요", "code": "invalid_refresh_token"}

    # 회전으로 받은 것도, 다른 기기의 것도 더는 먹지 않는다
    for token in (rotated["refreshToken"], other_device["refreshToken"]):
        blocked = await client.post("/api/auth/refresh", json={"refreshToken": token})
        assert blocked.status_code == 401
        assert blocked.json()["code"] == "invalid_refresh_token"

    live = (
        await db_session.scalars(
            select(AuthSession).where(
                AuthSession.account_id == account.id,
                AuthSession.revoked_at.is_(None),
            )
        )
    ).all()
    assert live == []


async def test_reuse_detection_does_not_touch_another_account(
    client: AsyncClient, db_session: AsyncSession, account: Account
) -> None:
    """무효화는 **그 계정 안에서만** 일어난다."""
    other = await _create_account(db_session, login_id="other_account")
    other_tokens = await _login(client, other.login_id)
    victim = await _login(client, account.login_id)
    await client.post("/api/auth/refresh", json={"refreshToken": victim["refreshToken"]})

    await client.post("/api/auth/refresh", json={"refreshToken": victim["refreshToken"]})

    still_valid = await client.post(
        "/api/auth/refresh", json={"refreshToken": other_tokens["refreshToken"]}
    )
    assert still_valid.status_code == 200


async def test_unknown_refresh_token_is_rejected(client: AsyncClient) -> None:
    response = await client.post(
        "/api/auth/refresh", json={"refreshToken": "not-a-real-token"}
    )

    assert response.status_code == 401
    assert response.json()["code"] == "invalid_refresh_token"


async def test_expired_refresh_token_is_rejected(
    client: AsyncClient, db_session: AsyncSession, account: Account
) -> None:
    tokens = await _login(client, account.login_id)
    stored = (
        await db_session.scalars(
            select(AuthSession).where(
                AuthSession.refresh_token_hash
                == hash_refresh_token(tokens["refreshToken"])
            )
        )
    ).one()
    stored.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db_session.flush()

    response = await client.post(
        "/api/auth/refresh", json={"refreshToken": tokens["refreshToken"]}
    )

    assert response.status_code == 401
    assert response.json()["code"] == "invalid_refresh_token"


# --- 로그아웃 -----------------------------------------------------------


async def test_logout_invalidates_only_that_session(
    client: AsyncClient, account: Account
) -> None:
    """로그아웃은 **이 세션의 refresh 만** 끊는다 — 「다른 기기 모두 로그아웃」은 v2 다."""
    tokens = await _login(client, account.login_id)
    other_device = await _login(client, account.login_id)

    response = await client.post(
        "/api/auth/logout",
        json={"refreshToken": tokens["refreshToken"]},
        headers=_auth(tokens["accessToken"]),
    )

    assert response.status_code == 204
    assert response.content == b""

    # 다른 기기의 세션은 그대로다
    alive = await client.post(
        "/api/auth/refresh", json={"refreshToken": other_device["refreshToken"]}
    )
    assert alive.status_code == 200

    # 로그아웃한 refresh 는 더는 먹지 않는다.
    # 무효 토큰이 돌아온 것이므로 **A-7 재사용 감지도 함께 걸린다** — 로그아웃 뒤의
    # 재생은 탈취와 구분되지 않는다. 그래서 이 호출은 검사 순서상 맨 뒤에 둔다.
    dead = await client.post(
        "/api/auth/refresh", json={"refreshToken": tokens["refreshToken"]}
    )
    assert dead.status_code == 401
    assert dead.json()["code"] == "invalid_refresh_token"


async def test_logout_requires_a_session(client: AsyncClient, account: Account) -> None:
    tokens = await _login(client, account.login_id)

    response = await client.post(
        "/api/auth/logout", json={"refreshToken": tokens["refreshToken"]}
    )

    assert response.status_code == 401
    assert response.json()["code"] == "token_expired"


async def test_logout_cannot_kill_another_accounts_session(
    client: AsyncClient, db_session: AsyncSession, account: Account
) -> None:
    """남의 refresh 를 실어 보내도 그 세션은 살아 있다 — 소유 검사는 service 가 한다(§9)."""
    other = await _create_account(db_session, login_id="logout_victim")
    victim_tokens = await _login(client, other.login_id)
    attacker = await _login(client, account.login_id)

    response = await client.post(
        "/api/auth/logout",
        json={"refreshToken": victim_tokens["refreshToken"]},
        headers=_auth(attacker["accessToken"]),
    )

    assert response.status_code == 204
    survived = await client.post(
        "/api/auth/refresh", json={"refreshToken": victim_tokens["refreshToken"]}
    )
    assert survived.status_code == 200


# --- 트랜잭션 경계 -------------------------------------------------------
#
# `client` 픽스처는 `get_db` 를 덮어써서 하나의 테스트 트랜잭션을 공유한다.
# 그래서 위의 재사용 감지 테스트만으로는 **실제 요청 경계**를 확인할 수 없다 —
# 실서버에서는 401 로 끝난 요청이 롤백되므로, 무효화가 남는지를 여기서 따로 잡는다.


class _SpySession:
    """commit 횟수만 세는 대역. `get_db` 의 경계 규칙만 보면 되므로 DB 는 필요 없다."""

    def __init__(self) -> None:
        self.commits = 0

    async def commit(self) -> None:
        self.commits += 1

    async def __aenter__(self) -> "_SpySession":
        return self

    async def __aexit__(self, *exc_info: object) -> bool:
        return False


@pytest.fixture
def spy_session(monkeypatch: pytest.MonkeyPatch) -> _SpySession:
    import api.deps

    spy = _SpySession()
    monkeypatch.setattr(api.deps, "SessionLocal", lambda: spy)
    return spy


async def test_get_db_commits_when_the_request_succeeds(
    spy_session: _SpySession,
) -> None:
    from api.deps import get_db

    generator = get_db()
    await generator.asend(None)
    with pytest.raises(StopAsyncIteration):
        await generator.asend(None)

    assert spy_session.commits == 1


async def test_get_db_rolls_back_when_a_domain_error_ends_the_request(
    spy_session: _SpySession,
) -> None:
    """설계된 실패라도 **기본은 롤백**이다 — 실패한 요청의 쓰기를 남기지 않는다."""
    from api.deps import get_db
    from core.exceptions import UnauthorizedError

    generator = get_db()
    await generator.asend(None)
    with pytest.raises(UnauthorizedError):
        await generator.athrow(UnauthorizedError("거부", code="invalid_credentials"))

    assert spy_session.commits == 0


async def test_get_db_keeps_the_writes_of_a_reuse_detection(
    spy_session: _SpySession,
) -> None:
    """A-7 — 401 을 주면서도 **세션 무효화는 남는다.** 롤백되면 탈취 토큰이 계속 산다."""
    from api.deps import get_db
    from core.exceptions import RefreshTokenReuseError

    generator = get_db()
    await generator.asend(None)
    with pytest.raises(RefreshTokenReuseError):
        await generator.athrow(RefreshTokenReuseError("다시 로그인해 주세요"))

    assert spy_session.commits == 1


# --- 누설 검사 -----------------------------------------------------------


async def test_no_response_leaks_the_password_hash_or_the_stored_refresh(
    client: AsyncClient, db_session: AsyncSession, account: Account
) -> None:
    """응답 어디에도 비밀번호 해시·저장된 refresh 해시가 실리지 않는다(Pre-deploy Check)."""
    tokens = await _login(client, account.login_id)
    session_body = (
        await client.get("/api/auth/session", headers=_auth(tokens["accessToken"]))
    ).text
    stored_hash = hash_refresh_token(tokens["refreshToken"])

    for body in (str(tokens), session_body):
        assert account.password_hash not in body
        assert PASSWORD not in body
        assert stored_hash not in body

    # 서버는 refresh 를 **해시로만** 갖는다 — 원문이 저장돼 있지 않다
    rows = (
        await db_session.scalars(
            select(AuthSession).where(AuthSession.account_id == account.id)
        )
    ).all()
    assert [row.refresh_token_hash for row in rows] == [stored_hash]
