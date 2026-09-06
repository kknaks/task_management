"""SPEC-002 §4 — 유형 계약과 Case Matrix.

정본: SPEC-002 §4(API·Validation·Case Matrix) · §5(규칙) · `domains/account.md` A-4·A-5·A-6.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dto.enums import ColorToken
from models.account import WorkType
from repository import work_type_repository
from seed.seed import DEFAULT_WORK_TYPES

# 픽스처는 `conftest.py` 가 아니라 모듈에서 온다 — 이름을 여기 들여야 pytest 가 본다.
from tests.setting_fixtures import Owner, owner, stranger  # noqa: F401

BASE = "/api/work-types"


async def _seed_defaults(session: AsyncSession, account_id: int) -> list[WorkType]:
    """기본 유형 3종은 시드가 넣는다 — 테스트에서도 같은 값·같은 순서로 만든다(A-4)."""
    rows = [
        WorkType(
            account_id=account_id,
            kind=default.kind.value,
            name=default.name,
            color_token=default.color_token.value,
            is_default=True,
        )
        for default in DEFAULT_WORK_TYPES
    ]
    session.add_all(rows)
    await session.flush()
    return rows


async def _create(
    client: AsyncClient,
    owner: Owner,
    *,
    kind: str = "task",
    name: str = "외부 미팅",
    color_token: str = "mint",
) -> dict:
    response = await client.post(
        BASE,
        json={"kind": kind, "name": name, "colorToken": color_token},
        headers=owner.headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


# --- 생성 · 목록 ---------------------------------------------------------


async def test_create_returns_the_item_and_it_shows_up_in_the_list(
    client: AsyncClient, owner: Owner
) -> None:
    """SPEC-002 §4 — 종류 + 이름 + 색으로 만든다. 만든 것은 **커스텀**이다."""
    created = await _create(client, owner, kind="meeting", name="외부 미팅")

    assert created["kind"] == "meeting"
    assert created["name"] == "외부 미팅"
    assert created["colorToken"] == "mint"
    assert created["isDefault"] is False

    listed = await client.get(BASE, headers=owner.headers)
    assert listed.status_code == 200
    assert listed.json() == {"items": [created]}


async def test_list_puts_the_default_types_first_then_creation_order(
    client: AsyncClient, db_session: AsyncSession, owner: Owner
) -> None:
    """정렬 — **기본 3종이 먼저**(시드 순서), 그 뒤 생성 순(§4 Data Contract)."""
    await _seed_defaults(db_session, owner.id)
    await _create(client, owner, name="나중에 만든 것")
    await _create(client, owner, name="더 나중")

    items = (await client.get(BASE, headers=owner.headers)).json()["items"]

    assert [item["name"] for item in items] == [
        *[default.name for default in DEFAULT_WORK_TYPES],
        "나중에 만든 것",
        "더 나중",
    ]
    assert [item["isDefault"] for item in items] == [True, True, True, False, False]


async def test_list_never_mixes_in_another_account(
    client: AsyncClient, owner: Owner, stranger: Owner
) -> None:
    """Pre-deploy Check — 목록에 **다른 계정의 유형이 섞이지 않는다**."""
    await _create(client, owner, name="내 유형")
    await _create(client, stranger, name="남의 유형")

    items = (await client.get(BASE, headers=owner.headers)).json()["items"]

    assert [item["name"] for item in items] == ["내 유형"]


@pytest.mark.parametrize("color_token", [token.value for token in ColorToken])
async def test_every_palette_token_is_accepted(
    client: AsyncClient, owner: Owner, color_token: str
) -> None:
    """허용 팔레트 **8종 전부**가 통과한다(§4 Data Contract)."""
    created = await _create(client, owner, name=f"유형 {color_token}", color_token=color_token)

    assert created["colorToken"] == color_token


# --- 검증 실패 -----------------------------------------------------------


@pytest.mark.parametrize("color_token", ["#7181F8", "red", "INDIGO", "", "coral"])
async def test_color_outside_the_palette_is_rejected(
    client: AsyncClient, owner: Owner, color_token: str
) -> None:
    """팔레트 밖 값·임의 hex 는 `422 invalid_color_token`(A-5)."""
    response = await client.post(
        BASE,
        json={"kind": "task", "name": "이상한 색", "colorToken": color_token},
        headers=owner.headers,
    )

    assert response.status_code == 422
    assert response.json() == {
        "detail": "허용된 색이 아닙니다",
        "code": "invalid_color_token",
        "field": "colorToken",
    }


async def test_duplicate_name_is_rejected(client: AsyncClient, owner: Owner) -> None:
    await _create(client, owner, name="외부 미팅")

    response = await client.post(
        BASE,
        json={"kind": "task", "name": "외부 미팅", "colorToken": "sky"},
        headers=owner.headers,
    )

    assert response.status_code == 409
    assert response.json() == {
        "detail": "같은 이름이 이미 있습니다",
        "code": "duplicate_name",
    }


@pytest.mark.parametrize("duplicate", ["외부 미팅", "  외부 미팅  ", "외부  미팅", "ABC 미팅"])
async def test_duplicate_check_normalizes_case_and_whitespace(
    client: AsyncClient, owner: Owner, duplicate: str
) -> None:
    """「대소문자·공백을 정규화해 비교한다」(§4 Validation)."""
    await _create(client, owner, name="외부 미팅")
    await _create(client, owner, name="abc 미팅")

    response = await client.post(
        BASE,
        json={"kind": "task", "name": duplicate, "colorToken": "sky"},
        headers=owner.headers,
    )

    assert response.status_code == 409
    assert response.json()["code"] == "duplicate_name"


async def test_the_same_name_is_free_in_another_account(
    client: AsyncClient, owner: Owner, stranger: Owner
) -> None:
    """유일성은 **계정 안에서만** 본다(§4)."""
    await _create(client, owner, name="외부 미팅")

    response = await client.post(
        BASE,
        json={"kind": "task", "name": "외부 미팅", "colorToken": "sky"},
        headers=stranger.headers,
    )

    assert response.status_code == 201


async def test_a_deleted_name_can_be_used_again(
    client: AsyncClient, owner: Owner
) -> None:
    """유일성은 **삭제되지 않은 것끼리**다(§4) — 지운 이름은 다시 쓸 수 있다."""
    created = await _create(client, owner, name="외부 미팅")
    assert (
        await client.delete(f"{BASE}/{created['id']}", headers=owner.headers)
    ).status_code == 204

    response = await client.post(
        BASE,
        json={"kind": "task", "name": "외부 미팅", "colorToken": "sky"},
        headers=owner.headers,
    )

    assert response.status_code == 201


@pytest.mark.parametrize(
    "body",
    [
        {"kind": "task", "name": "", "colorToken": "mint"},
        {"kind": "task", "name": "   ", "colorToken": "mint"},
        {"kind": "task", "name": "가" * 31, "colorToken": "mint"},
        {"kind": "task", "name": "줄\n바꿈", "colorToken": "mint"},
        {"kind": "unknown", "name": "종류가 이상", "colorToken": "mint"},
        {"name": "종류 없음", "colorToken": "mint"},
        {"kind": "task", "name": "색 없음"},
    ],
)
async def test_invalid_create_body_is_422_validation_error(
    client: AsyncClient, owner: Owner, body: dict
) -> None:
    """Case Matrix — `422 validation_error`. 이름은 1~30자 · 줄바꿈 불가 · 종류는 둘 중 하나."""
    response = await client.post(BASE, json=body, headers=owner.headers)

    assert response.status_code == 422
    body_json = response.json()
    # WORK-007 이 `field` 를 더했다(어느 칸이 틀렸는지). 두 키는 그대로다
    assert (body_json["detail"], body_json["code"]) == ("입력값을 확인해 주세요", "validation_error")
    assert "field" in body_json


async def test_a_thirty_character_name_is_accepted(
    client: AsyncClient, owner: Owner
) -> None:
    """경계 — 30자는 통과한다(31자가 거부되는 위 테스트의 짝)."""
    created = await _create(client, owner, name="가" * 30)

    assert len(created["name"]) == 30


# --- 부분 수정 -----------------------------------------------------------


async def test_patch_changes_only_the_field_that_was_sent(
    client: AsyncClient, owner: Owner
) -> None:
    """「보낸 필드만 바뀐다」(§4) — 인라인 자동 저장이 필드 단위로 오기 때문이다."""
    created = await _create(client, owner, kind="meeting", name="외부 미팅")

    renamed = await client.patch(
        f"{BASE}/{created['id']}", json={"name": "외부 미팅(신규)"}, headers=owner.headers
    )

    assert renamed.status_code == 200
    assert renamed.json() == {**created, "name": "외부 미팅(신규)"}

    recolored = await client.patch(
        f"{BASE}/{created['id']}", json={"colorToken": "sky"}, headers=owner.headers
    )

    assert recolored.json() == {**created, "name": "외부 미팅(신규)", "colorToken": "sky"}


async def test_patch_cannot_change_the_kind(client: AsyncClient, owner: Owner) -> None:
    """**종류는 생성 시에만 정해진다**(§5) — `kind` 는 PATCH 계약에 없다.

    조용히 무시하지 않고 `422 validation_error` 로 **거부**한다.
    """
    created = await _create(client, owner, kind="meeting", name="외부 미팅")

    response = await client.patch(
        f"{BASE}/{created['id']}", json={"kind": "task"}, headers=owner.headers
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"

    unchanged = (await client.get(BASE, headers=owner.headers)).json()["items"][0]
    assert unchanged["kind"] == "meeting"


async def test_patch_rejects_an_explicit_null(client: AsyncClient, owner: Owner) -> None:
    """「보내지 않음」과 「null 로 지움」은 다르다 — 이름·색은 비울 수 없는 값이다."""
    created = await _create(client, owner)

    response = await client.patch(
        f"{BASE}/{created['id']}", json={"name": None}, headers=owner.headers
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


async def test_patch_to_a_duplicate_name_is_rejected(
    client: AsyncClient, owner: Owner
) -> None:
    await _create(client, owner, name="외부 미팅")
    other = await _create(client, owner, name="내부 미팅")

    response = await client.patch(
        f"{BASE}/{other['id']}", json={"name": "외부 미팅"}, headers=owner.headers
    )

    assert response.status_code == 409
    assert response.json()["code"] == "duplicate_name"


async def test_patch_can_keep_its_own_name(client: AsyncClient, owner: Owner) -> None:
    """자기 이름을 그대로 다시 보내는 것은 중복이 아니다(자기 자신을 제외하고 본다)."""
    created = await _create(client, owner, name="외부 미팅")

    response = await client.patch(
        f"{BASE}/{created['id']}",
        json={"name": "외부 미팅", "colorToken": "rose"},
        headers=owner.headers,
    )

    assert response.status_code == 200
    assert response.json()["colorToken"] == "rose"


async def test_patch_with_a_bad_color_is_rejected(
    client: AsyncClient, owner: Owner
) -> None:
    created = await _create(client, owner)

    response = await client.patch(
        f"{BASE}/{created['id']}", json={"colorToken": "#FFFFFF"}, headers=owner.headers
    )

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_color_token"


# --- 기본 유형 3종 잠금 (A-4) --------------------------------------------


async def test_default_type_cannot_be_renamed(
    client: AsyncClient, db_session: AsyncSession, owner: Owner
) -> None:
    """이름 변경은 `409 work_type_locked`. **화면이 감춰도 서버가 정본이다**(§5)."""
    defaults = await _seed_defaults(db_session, owner.id)

    response = await client.patch(
        f"{BASE}/{defaults[0].id}", json={"name": "이름 바꾸기"}, headers=owner.headers
    )

    assert response.status_code == 409
    assert response.json() == {
        "detail": "기본 유형은 이름과 종류를 바꾸거나 삭제할 수 없습니다",
        "code": "work_type_locked",
    }

    listed = (await client.get(BASE, headers=owner.headers)).json()["items"]
    assert listed[0]["name"] == DEFAULT_WORK_TYPES[0].name


async def test_default_type_cannot_be_deleted(
    client: AsyncClient, db_session: AsyncSession, owner: Owner
) -> None:
    defaults = await _seed_defaults(db_session, owner.id)

    response = await client.delete(
        f"{BASE}/{defaults[1].id}", headers=owner.headers
    )

    assert response.status_code == 409
    assert response.json()["code"] == "work_type_locked"

    listed = (await client.get(BASE, headers=owner.headers)).json()["items"]
    assert len(listed) == len(DEFAULT_WORK_TYPES)


async def test_default_type_color_can_be_changed(
    client: AsyncClient, db_session: AsyncSession, owner: Owner
) -> None:
    """**색만은 편집된다**(A-4 · DEC-001 §4) — 잠금이 색까지 막으면 안 된다."""
    defaults = await _seed_defaults(db_session, owner.id)

    response = await client.patch(
        f"{BASE}/{defaults[0].id}", json={"colorToken": "amber"}, headers=owner.headers
    )

    assert response.status_code == 200
    assert response.json()["colorToken"] == "amber"
    assert response.json()["isDefault"] is True
    assert response.json()["name"] == DEFAULT_WORK_TYPES[0].name


# --- 소프트 딜리트 (A-6 · DB §0-1) ---------------------------------------


async def test_delete_is_soft_and_the_row_survives(
    client: AsyncClient, db_session: AsyncSession, owner: Owner
) -> None:
    """삭제해도 **행은 남는다.** 하드 삭제 경로가 없다(Pre-deploy Check)."""
    created = await _create(client, owner, name="외부 미팅", color_token="mint")

    response = await client.delete(f"{BASE}/{created['id']}", headers=owner.headers)

    assert response.status_code == 204
    assert response.content == b""

    listed = (await client.get(BASE, headers=owner.headers)).json()["items"]
    assert listed == []

    row = (
        await db_session.scalars(select(WorkType).where(WorkType.id == created["id"]))
    ).one()
    assert row.deleted_at is not None


async def test_a_deleted_type_keeps_its_name_and_color_for_references(
    client: AsyncClient, db_session: AsyncSession, owner: Owner
) -> None:
    """A-6 — 목록·선택지에서만 빠지고, **참조 중인 기록에는 이름·색이 그대로**다.

    아직 업무·회의 테이블이 없으므로, 그들이 쓸 조회 경로
    (`find_including_deleted` — 이름이 삭제분 포함을 드러낸다)로 확인한다.
    """
    created = await _create(client, owner, name="외부 미팅", color_token="mint")
    await client.delete(f"{BASE}/{created['id']}", headers=owner.headers)

    referenced = await work_type_repository.find_including_deleted(
        db_session, account_id=owner.id, work_type_id=created["id"]
    )

    assert referenced is not None
    assert referenced.name == "외부 미팅"
    assert referenced.color_token == "mint"

    # 그런데 활성 조회에는 잡히지 않는다 — 선택 목록에서 빠진다
    assert (
        await work_type_repository.find_active(
            db_session, account_id=owner.id, work_type_id=created["id"]
        )
        is None
    )


async def test_deleting_twice_is_404(client: AsyncClient, owner: Owner) -> None:
    """`삭제됨` 에서 나오는 전이가 없다(§4 State) — 이미 지운 것은 없는 것과 같다."""
    created = await _create(client, owner)
    await client.delete(f"{BASE}/{created['id']}", headers=owner.headers)

    response = await client.delete(f"{BASE}/{created['id']}", headers=owner.headers)

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


async def test_there_is_no_restore_endpoint(client: AsyncClient, owner: Owner) -> None:
    """**복원 API 를 만들지 않는다**(DEC-004 §4 · §4 API Contract)."""
    created = await _create(client, owner)
    await client.delete(f"{BASE}/{created['id']}", headers=owner.headers)

    for path in (f"{BASE}/{created['id']}/restore", f"{BASE}/{created['id']}/undelete"):
        response = await client.post(path, json={}, headers=owner.headers)
        assert response.status_code == 404


# --- 소유 검사 · 인증 게이트 ---------------------------------------------


async def test_another_accounts_type_is_404_not_403(
    client: AsyncClient, owner: Owner, stranger: Owner
) -> None:
    """남의 항목은 **404** 다 — 403 이면 「있긴 있다」가 새어 나간다(§5 · §9)."""
    mine = await _create(client, owner, name="내 유형")

    patched = await client.patch(
        f"{BASE}/{mine['id']}", json={"name": "가로채기"}, headers=stranger.headers
    )
    deleted = await client.delete(f"{BASE}/{mine['id']}", headers=stranger.headers)

    assert patched.status_code == deleted.status_code == 404
    assert patched.json() == {"detail": "항목을 찾을 수 없습니다", "code": "not_found"}

    # 남의 시도로 내 것이 바뀌지 않았다
    listed = (await client.get(BASE, headers=owner.headers)).json()["items"]
    assert listed[0]["name"] == "내 유형"


async def test_a_missing_id_is_404(client: AsyncClient, owner: Owner) -> None:
    response = await client.patch(
        f"{BASE}/987654321", json={"name": "없음"}, headers=owner.headers
    )

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", BASE, None),
        ("POST", BASE, {"kind": "task", "name": "무단", "colorToken": "mint"}),
        ("PATCH", f"{BASE}/1", {"name": "무단"}),
        ("DELETE", f"{BASE}/1", None),
    ],
)
async def test_every_surface_requires_a_session(
    client: AsyncClient, method: str, path: str, body: dict | None
) -> None:
    """게이트 밖 표면이 **하나도 없다**(§4 권한 = 세션). 라우터 단위로 걸려 있다."""
    response = await client.request(method, path, json=body)

    assert response.status_code == 401
    assert response.json()["code"] == "token_expired"
