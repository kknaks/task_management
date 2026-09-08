"""WORK-009 Phase 1 — 회의별 단명 토큰(A-13 · MF-69 · WP §Internal Interface Contract).

여기서 고정하는 것 —

- 발급은 `/start` 한 번 · **회의당 하나** · 원문이 `auth_session.meeting_token` 에 산다
- 검증은 `require_context` 한 곳 — 회의 토큰으로 **조회만** · **그 회의만**
- 폐기는 **행 DELETE**(`revoked_at` 을 안 찍는다) · 두 번 불러도 예외가 없다
- 두 토큰은 **서로를 대신하지 못한다** — 응답은 언제나 하나(`401 token_expired`)
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.account import AuthSession
from repository import auth_session_repository
from service import auth_service
from tests.meeting_fixtures import BASE, END, START, MeetingOwner, create_meeting, iso  # noqa: F401
from tests.meeting_fixtures import owner, stranger  # noqa: F401
from tests.meeting_live_fixtures import live_scope, start_meeting  # noqa: F401


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _token_row(session: AsyncSession, meeting_id: int) -> AuthSession | None:
    return (
        await session.scalars(
            select(AuthSession).where(
                AuthSession.kind == "meeting", AuthSession.meeting_id == meeting_id
            )
        )
    ).one_or_none()


async def _create_task(
    client: AsyncClient, owner: MeetingOwner, title: str, project_id: int | None
) -> int:
    body: dict = {"title": title, "workTypeId": owner.task_type_id}
    if project_id is not None:
        body["projectId"] = project_id
    response = await client.post("/api/tasks", json=body, headers=owner.headers)
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _meeting_token(session: AsyncSession, meeting_id: int) -> str:
    token = await auth_service.get_meeting_token(session, meeting_id=meeting_id)
    assert token is not None
    return token


# --- 발급 ---------------------------------------------------------------


async def test_start_issues_exactly_one_meeting_token_row(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner, live_scope: None
) -> None:
    """`/start` 가 전이와 같은 트랜잭션에서 행 하나를 남긴다 — **회의당 하나**(A-13)."""
    meeting = await start_meeting(client, owner)

    rows = (
        await db_session.scalars(
            select(AuthSession).where(AuthSession.kind == "meeting")
        )
    ).all()

    assert len(rows) == 1
    row = rows[0]
    assert row.meeting_id == meeting["id"]
    assert row.account_id == owner.id
    # A-13 — 원문 컬럼. `refresh_token_hash` 는 NULL 이고 `revoked_at` 은 안 쓴다
    assert row.meeting_token
    assert row.refresh_token_hash is None
    assert row.revoked_at is None


async def test_issued_token_is_readable_again_for_later_submissions(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner, live_scope: None
) -> None:
    """제출부는 **같은 원문**을 다시 읽는다 — 제출마다 재발급하지 않는다(A-13)."""
    meeting = await start_meeting(client, owner)
    row = await _token_row(db_session, meeting["id"])
    assert row is not None

    first = await auth_service.get_meeting_token(db_session, meeting_id=meeting["id"])
    second = await auth_service.get_meeting_token(db_session, meeting_id=meeting["id"])

    assert first == second == row.meeting_token


async def test_meeting_token_does_not_appear_in_the_start_response(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner, live_scope: None
) -> None:
    """**원문은 응답에 나오지 않는다**(정적 검사의 런타임 짝) — `MeetingDetail` 어디에도 없다."""
    meeting = await start_meeting(client, owner)
    token = await _meeting_token(db_session, meeting["id"])

    detail = await client.get(f"{BASE}/{meeting['id']}", headers=owner.headers)

    assert token not in detail.text
    assert token not in str(meeting)


# --- 회의 범위 ------------------------------------------------------------


async def test_meeting_token_reads_its_own_meeting_through_current(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner, live_scope: None
) -> None:
    """`GET /api/meetings/current` — 도구가 회의 id 를 모르므로 **토큰이 회의를 안다**."""
    meeting = await start_meeting(client, owner)
    token = await _meeting_token(db_session, meeting["id"])

    response = await client.get(f"{BASE}/current", headers=_auth(token))

    assert response.status_code == 200, response.text
    assert response.json()["id"] == meeting["id"]


async def test_current_is_404_for_a_session_jwt(
    client: AsyncClient, owner: MeetingOwner, live_scope: None
) -> None:
    """`/current` 는 **회의 토큰 전용**이다 — 사용자 세션 JWT 로는 404."""
    await start_meeting(client, owner)

    response = await client.get(f"{BASE}/current", headers=owner.headers)

    assert response.status_code == 404


async def test_meeting_token_reads_its_own_meeting_by_id(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner, live_scope: None
) -> None:
    meeting = await start_meeting(client, owner)
    token = await _meeting_token(db_session, meeting["id"])

    response = await client.get(f"{BASE}/{meeting['id']}", headers=_auth(token))

    assert response.status_code == 200
    assert response.json()["id"] == meeting["id"]


async def test_meeting_token_is_404_on_another_meeting_of_the_same_account(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner, live_scope: None
) -> None:
    """**자기 계정의 다른 회의도 404** 다 — 계정 범위가 아니라 회의 범위다."""
    meeting = await start_meeting(client, owner)
    other = await create_meeting(
        client,
        owner,
        title="다른 회의",
        startAt=iso(START + timedelta(days=1)),
        endAt=iso(END + timedelta(days=1)),
    )
    token = await _meeting_token(db_session, meeting["id"])

    response = await client.get(f"{BASE}/{other['id']}", headers=_auth(token))

    assert response.status_code == 404


async def test_meeting_token_is_404_on_a_stranger_meeting(
    client: AsyncClient,
    db_session: AsyncSession,
    owner: MeetingOwner,
    stranger: MeetingOwner,
    live_scope: None,
) -> None:
    meeting = await start_meeting(client, owner)
    theirs = await create_meeting(
        client,
        stranger,
        title="남의 회의",
        startAt=iso(START + timedelta(days=2)),
        endAt=iso(END + timedelta(days=2)),
    )
    token = await _meeting_token(db_session, meeting["id"])

    response = await client.get(f"{BASE}/{theirs['id']}", headers=_auth(token))

    assert response.status_code == 404


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("post", "/lines", {"agendaId": 0, "kind": "discussion", "content": "쓰기"}),
        ("post", "/agendas", {"title": "쓰기 안건"}),
        ("post", "/end", None),
        ("patch", "", {"title": "제목 바꾸기"}),
        ("delete", "", None),
    ],
)
async def test_write_surfaces_are_404_for_a_meeting_token(
    client: AsyncClient,
    db_session: AsyncSession,
    owner: MeetingOwner,
    live_scope: None,
    method: str,
    path: str,
    body: dict | None,
) -> None:
    """**쓰기 표면은 회의 토큰으로 전부 404** — 자기 회의여도 그렇다(도구는 조회뿐)."""
    meeting = await start_meeting(client, owner)
    token = await _meeting_token(db_session, meeting["id"])

    call = getattr(client, method)
    url = f"{BASE}/{meeting['id']}{path}"
    response = await (call(url, json=body, headers=_auth(token)) if body is not None else call(url, headers=_auth(token)))

    assert response.status_code == 404


async def test_the_six_allowed_surfaces_stay_open_for_a_meeting_token(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner, live_scope: None
) -> None:
    """**allowlist 여섯**이 전부 열려 있다 — 도구 7개가 부르는 표면이 이것뿐이다."""
    task_id = await _create_task(client, owner, "허용 표면 확인용", None)
    meeting = await start_meeting(client, owner)
    token = await _meeting_token(db_session, meeting["id"])
    headers = _auth(token)

    allowed = [
        f"{BASE}/current",
        f"{BASE}/current/tasks",
        f"{BASE}/{meeting['id']}",
        f"/api/tasks/{task_id}",
        "/api/work-types",
        "/api/auth/session",
    ]
    for path in allowed:
        response = await client.get(path, headers=headers)
        assert response.status_code == 200, f"{path} → {response.status_code} {response.text}"


@pytest.mark.parametrize(
    "path",
    [
        # F-1 — 목록은 그 계정의 **모든 회의**를 낸다. `{meeting_id}` 가 없어 예전 규칙을 그냥 지나갔다
        f"{BASE}?from=2026-09-01T00:00:00Z&to=2026-10-01T00:00:00Z",
        # W-2 — 대응 도구가 없는 조회. allowlist 밖이라 닫힌다
        "/api/jobs/1",
        # 화면 계약이라 도구가 쓰지 않는다(도구는 `/current/tasks` 를 부른다)
        "/api/tasks",
        # 회의 하위 조회 — 도구는 `/current` 상세로 다 본다. 여는 이유가 없다
        "TRANSCRIPT",
    ],
)
async def test_reads_outside_the_allowlist_are_404_for_a_meeting_token(
    client: AsyncClient,
    db_session: AsyncSession,
    owner: MeetingOwner,
    live_scope: None,
    path: str,
) -> None:
    """**allowlist 밖은 메서드 불문 404** 다 — 「쓰기만 막는다」가 아니다(검수 F-1 · W-2)."""
    meeting = await start_meeting(client, owner)
    token = await _meeting_token(db_session, meeting["id"])
    url = f"{BASE}/{meeting['id']}/transcript" if path == "TRANSCRIPT" else path

    response = await client.get(url, headers=_auth(token))

    assert response.status_code == 404, response.text
    # **게이트에서 떨어졌다**는 것까지 본다 — service 까지 갔다가 없어서 404 인 것과 구별한다
    # (`/api/jobs/1` 은 service 가 「작업을 찾을 수 없습니다」를 낸다. 그 문구가 오면 게이트가 안 걸린 것이다)
    assert response.json() == {"detail": "찾을 수 없습니다", "code": "not_found"}


async def test_the_meeting_list_never_leaks_other_meetings_to_a_meeting_token(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner, live_scope: None
) -> None:
    """F-1 회귀 — `GET /{other}` 가 404 인데 목록으로 같은 회의가 다 보이면 안 된다.

    세션 JWT 로는 그대로 200 이다(화면이 쓰는 표면이라 닫히면 안 된다).
    """
    meeting = await start_meeting(client, owner)
    await create_meeting(
        client,
        owner,
        title="목록에 보이면 안 되는 회의",
        startAt=iso(START + timedelta(days=3)),
        endAt=iso(END + timedelta(days=3)),
    )
    token = await _meeting_token(db_session, meeting["id"])
    query = {"from": iso(START - timedelta(days=30)), "to": iso(END + timedelta(days=30))}

    with_token = await client.get(BASE, params=query, headers=_auth(token))
    with_jwt = await client.get(BASE, params=query, headers=owner.headers)

    assert with_token.status_code == 404
    assert with_jwt.status_code == 200
    assert len(with_jwt.json()["items"]) >= 2


async def test_task_write_is_404_for_a_meeting_token(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner, live_scope: None
) -> None:
    meeting = await start_meeting(client, owner)
    token = await _meeting_token(db_session, meeting["id"])

    response = await client.post(
        "/api/tasks",
        json={"title": "쓰기 업무", "workTypeId": owner.task_type_id},
        headers=_auth(token),
    )

    assert response.status_code == 404


async def test_the_not_found_body_names_no_resource(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner, live_scope: None
) -> None:
    """W-1 — 이 404 는 업무 · 유형 · job 어디서든 난다. **리소스를 말하지 않는다.**

    리소스별 문구(SPEC-006 §4 「회의록을 찾을 수 없습니다」 등)는 각 service 의 예외가 그대로 낸다.
    """
    meeting = await start_meeting(client, owner)
    token = await _meeting_token(db_session, meeting["id"])

    body = (
        await client.post(
            "/api/tasks",
            json={"title": "쓰기 업무", "workTypeId": owner.task_type_id},
            headers=_auth(token),
        )
    ).json()

    assert body == {"detail": "찾을 수 없습니다", "code": "not_found"}
    # 세션 JWT 의 회의 404 는 계약 문구 그대로다 — 건드리지 않았다
    missing = await client.get(f"{BASE}/999999", headers=owner.headers)
    assert missing.json()["detail"] == "회의록을 찾을 수 없습니다"


# --- 서로 대신하지 못한다 ---------------------------------------------------


async def test_the_two_tokens_cannot_stand_in_for_each_other(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner, live_scope: None
) -> None:
    """회의 토큰은 JWT 서명이 없고, 세션 JWT 는 `auth_session` 에 원문으로 있지 않다."""
    meeting = await start_meeting(client, owner)
    meeting_token = await _meeting_token(db_session, meeting["id"])
    session_jwt = owner.headers["Authorization"].removeprefix("Bearer ")

    assert meeting_token != session_jwt
    # 세션 JWT 로 `/current` → 404(회의 갈래가 아니다). 회의 토큰으로 목록 조회는 열려 있다
    assert (await client.get(f"{BASE}/current", headers=owner.headers)).status_code == 404
    # 세션 JWT 는 회의 토큰 테이블에 없다
    assert (
        await db_session.scalars(
            select(AuthSession).where(AuthSession.meeting_token == session_jwt)
        )
    ).one_or_none() is None


async def test_expired_meeting_token_is_401_token_expired(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner, live_scope: None
) -> None:
    """만료는 **응답 하나**다 — 거부 사유를 흘리지 않는다."""
    meeting = await start_meeting(client, owner)
    row = await _token_row(db_session, meeting["id"])
    assert row is not None
    token = row.meeting_token
    assert token is not None
    row.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    await db_session.flush()

    response = await client.get(f"{BASE}/current", headers=_auth(token))

    assert response.status_code == 401
    assert response.json()["code"] == "token_expired"


async def test_unknown_bearer_is_401_token_expired(client: AsyncClient) -> None:
    response = await client.get(f"{BASE}/current", headers=_auth("not-a-token-at-all"))

    assert response.status_code == 401
    assert response.json()["code"] == "token_expired"


# --- 폐기 ---------------------------------------------------------------


async def test_revoke_deletes_the_row_and_is_idempotent(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner, live_scope: None
) -> None:
    """**폐기 = 행 DELETE**(A-13). 두 번 불러도 예외가 없다(best-effort · MF-4)."""
    meeting = await start_meeting(client, owner)
    token = await _meeting_token(db_session, meeting["id"])

    deleted = await auth_service.revoke_meeting_token(db_session, meeting_id=meeting["id"])
    assert deleted == 1
    assert await _token_row(db_session, meeting["id"]) is None

    # 두 번째 — 0건이고 예외가 없다
    assert await auth_service.revoke_meeting_token(db_session, meeting_id=meeting["id"]) == 0

    response = await client.get(f"{BASE}/current", headers=_auth(token))
    assert response.status_code == 401
    assert response.json()["code"] == "token_expired"


async def test_refresh_reuse_detection_does_not_touch_meeting_tokens(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner, live_scope: None
) -> None:
    """A-7 재사용 감지는 **`refresh` 행의 규칙**이다 — 회의 토큰이 함께 끊기지 않는다(A-13)."""
    meeting = await start_meeting(client, owner)
    token = await _meeting_token(db_session, meeting["id"])

    await auth_session_repository.revoke_all_for_account(
        db_session, account_id=owner.id, revoked_at=datetime.now(UTC)
    )

    row = await _token_row(db_session, meeting["id"])
    assert row is not None
    assert row.revoked_at is None
    assert (await client.get(f"{BASE}/current", headers=_auth(token))).status_code == 200


# --- 회의 토큰 전용 업무 목록 (코디 지시 · MCP `list_tasks`) ----------------------


async def test_current_tasks_defaults_to_the_meeting_project(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner, live_scope: None
) -> None:
    """`projectId` 생략 = **그 회의의 프로젝트**(무소속 회의면 무소속 업무 · DEC-003 §4 L98)."""
    in_project = await _create_task(client, owner, "프로젝트 업무", owner.project_id)
    unassigned = await _create_task(client, owner, "무소속 업무", None)
    meeting = await start_meeting(client, owner, projectId=owner.project_id)
    token = await _meeting_token(db_session, meeting["id"])

    response = await client.get(f"{BASE}/current/tasks", headers=_auth(token))

    assert response.status_code == 200, response.text
    ids = [item["id"] for item in response.json()["items"]]
    assert in_project in ids
    assert unassigned not in ids


async def test_current_tasks_none_means_unassigned(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner, live_scope: None
) -> None:
    in_project = await _create_task(client, owner, "프로젝트 업무", owner.project_id)
    unassigned = await _create_task(client, owner, "무소속 업무", None)
    meeting = await start_meeting(client, owner, projectId=owner.project_id)
    token = await _meeting_token(db_session, meeting["id"])

    response = await client.get(
        f"{BASE}/current/tasks", params={"projectId": "none"}, headers=_auth(token)
    )

    ids = [item["id"] for item in response.json()["items"]]
    assert unassigned in ids
    assert in_project not in ids


async def test_current_tasks_gives_the_tool_table_fields(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner, live_scope: None
) -> None:
    """SPEC-007 §4 도구 표 — `id` · 제목 · 상태 · 기한 · 유형명 · 프로젝트. **기간으로 거르지 않는다.**"""
    await _create_task(client, owner, "프로젝트 업무", owner.project_id)
    meeting = await start_meeting(client, owner, projectId=owner.project_id)
    token = await _meeting_token(db_session, meeting["id"])

    item = (await client.get(f"{BASE}/current/tasks", headers=_auth(token))).json()["items"][0]

    assert set(item) == {"id", "title", "status", "dueDate", "workTypeName", "projectName"}
    assert item["projectName"] == f"{owner.login_id} 프로젝트"


async def test_current_tasks_is_404_for_a_session_jwt(
    client: AsyncClient, owner: MeetingOwner, live_scope: None
) -> None:
    await start_meeting(client, owner)

    response = await client.get(f"{BASE}/current/tasks", headers=owner.headers)

    assert response.status_code == 404
