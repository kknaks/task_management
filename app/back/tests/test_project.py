"""SPEC-002 §4 — 프로젝트 계약과 Case Matrix.

유형과 다른 점 둘 — **종류가 없고 기본 프로젝트가 없다**(전부 삭제 가능 — U-5).
그래서 `work_type_locked` 에 해당하는 케이스가 없다.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.account import Project
from repository import project_repository

# 픽스처는 `conftest.py` 가 아니라 모듈에서 온다 — 이름을 여기 들여야 pytest 가 본다.
from tests.setting_fixtures import Owner, owner, stranger  # noqa: F401

BASE = "/api/projects"


async def _create(
    client: AsyncClient,
    owner: Owner,
    *,
    name: str = "9월 요금제 개편",
    color_token: str = "violet",
) -> dict:
    response = await client.post(
        BASE, json={"name": name, "colorToken": color_token}, headers=owner.headers
    )
    assert response.status_code == 201, response.text
    return response.json()


# --- 생성 · 목록 ---------------------------------------------------------


async def test_create_returns_the_item_and_it_shows_up_in_the_list(
    client: AsyncClient, owner: Owner
) -> None:
    """프로젝트는 **이름 + 색**뿐이다(DEC-001 §3) — `kind` 도 `isDefault` 도 없다."""
    created = await _create(client, owner)

    assert created == {
        "id": created["id"],
        "name": "9월 요금제 개편",
        "colorToken": "violet",
    }

    listed = await client.get(BASE, headers=owner.headers)
    assert listed.status_code == 200
    assert listed.json() == {"items": [created]}


async def test_empty_list_is_an_empty_items_array(
    client: AsyncClient, owner: Owner
) -> None:
    """하나도 없으면 **빈 배열**이다 — 빈 상태 화면은 프론트가 이걸 보고 그린다(U-5)."""
    response = await client.get(BASE, headers=owner.headers)

    assert response.status_code == 200
    assert response.json() == {"items": []}


async def test_list_keeps_creation_order(client: AsyncClient, owner: Owner) -> None:
    """프로젝트는 **생성 순**이다(§4 Data Contract)."""
    for name in ("첫째", "둘째", "셋째"):
        await _create(client, owner, name=name)

    items = (await client.get(BASE, headers=owner.headers)).json()["items"]

    assert [item["name"] for item in items] == ["첫째", "둘째", "셋째"]


async def test_list_never_mixes_in_another_account(
    client: AsyncClient, owner: Owner, stranger: Owner
) -> None:
    await _create(client, owner, name="내 프로젝트")
    await _create(client, stranger, name="남의 프로젝트")

    items = (await client.get(BASE, headers=owner.headers)).json()["items"]

    assert [item["name"] for item in items] == ["내 프로젝트"]


# --- 검증 실패 -----------------------------------------------------------


async def test_color_outside_the_palette_is_rejected(
    client: AsyncClient, owner: Owner
) -> None:
    response = await client.post(
        BASE, json={"name": "임의 색", "colorToken": "#7181F8"}, headers=owner.headers
    )

    assert response.status_code == 422
    assert response.json() == {
        "detail": "허용된 색이 아닙니다",
        "code": "invalid_color_token",
        "field": "colorToken",
    }


async def test_duplicate_name_is_rejected(client: AsyncClient, owner: Owner) -> None:
    await _create(client, owner, name="9월 요금제 개편")

    response = await client.post(
        BASE,
        json={"name": "  9월  요금제 개편  ", "colorToken": "sky"},
        headers=owner.headers,
    )

    assert response.status_code == 409
    assert response.json() == {
        "detail": "같은 이름이 이미 있습니다",
        "code": "duplicate_name",
    }


async def test_a_project_may_share_a_name_with_a_work_type(
    client: AsyncClient, owner: Owner
) -> None:
    """유일성은 **프로젝트끼리**다(§4) — 유형 이름과 겹치는 것은 막지 않는다."""
    created = await client.post(
        "/api/work-types",
        json={"kind": "task", "name": "겹치는 이름", "colorToken": "mint"},
        headers=owner.headers,
    )
    assert created.status_code == 201

    response = await client.post(
        BASE, json={"name": "겹치는 이름", "colorToken": "sky"}, headers=owner.headers
    )

    assert response.status_code == 201


@pytest.mark.parametrize(
    "body",
    [
        {"name": "", "colorToken": "violet"},
        {"name": "   ", "colorToken": "violet"},
        {"name": "가" * 31, "colorToken": "violet"},
        {"name": "줄\n바꿈", "colorToken": "violet"},
        {"colorToken": "violet"},
        {"name": "색 없음"},
        {"name": "종류 있음", "colorToken": "violet", "kind": "task"},
    ],
)
async def test_invalid_create_body_is_422_validation_error(
    client: AsyncClient, owner: Owner, body: dict
) -> None:
    """마지막 항목 주의 — 프로젝트에 `kind` 는 **계약에 없다.** 조용히 무시하지 않는다."""
    response = await client.post(BASE, json=body, headers=owner.headers)

    assert response.status_code == 422
    body_json = response.json()
    # WORK-007 이 `field` 를 더했다(어느 칸이 틀렸는지). 두 키는 그대로다
    assert (body_json["detail"], body_json["code"]) == ("입력값을 확인해 주세요", "validation_error")
    assert "field" in body_json


# --- 부분 수정 -----------------------------------------------------------


async def test_patch_changes_only_the_field_that_was_sent(
    client: AsyncClient, owner: Owner
) -> None:
    created = await _create(client, owner)

    renamed = await client.patch(
        f"{BASE}/{created['id']}", json={"name": "10월 개편"}, headers=owner.headers
    )

    assert renamed.status_code == 200
    assert renamed.json() == {**created, "name": "10월 개편"}

    recolored = await client.patch(
        f"{BASE}/{created['id']}", json={"colorToken": "graphite"}, headers=owner.headers
    )

    assert recolored.json() == {**created, "name": "10월 개편", "colorToken": "graphite"}


async def test_patch_to_a_duplicate_name_is_rejected(
    client: AsyncClient, owner: Owner
) -> None:
    await _create(client, owner, name="첫째")
    second = await _create(client, owner, name="둘째")

    response = await client.patch(
        f"{BASE}/{second['id']}", json={"name": "첫째"}, headers=owner.headers
    )

    assert response.status_code == 409
    assert response.json()["code"] == "duplicate_name"


async def test_patch_rejects_an_explicit_null(client: AsyncClient, owner: Owner) -> None:
    created = await _create(client, owner)

    response = await client.patch(
        f"{BASE}/{created['id']}", json={"colorToken": None}, headers=owner.headers
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


# --- 소프트 딜리트 -------------------------------------------------------


async def test_delete_is_soft_and_keeps_name_and_color_for_references(
    client: AsyncClient, db_session: AsyncSession, owner: Owner
) -> None:
    """A-6 — 목록에서 빠지지만 **행과 표시 정보는 남는다.** 기본 프로젝트가 없어 전부 삭제 가능하다."""
    created = await _create(client, owner, name="9월 요금제 개편", color_token="violet")

    response = await client.delete(f"{BASE}/{created['id']}", headers=owner.headers)

    assert response.status_code == 204
    assert (await client.get(BASE, headers=owner.headers)).json() == {"items": []}

    row = (
        await db_session.scalars(select(Project).where(Project.id == created["id"]))
    ).one()
    assert row.deleted_at is not None

    referenced = await project_repository.find_including_deleted(
        db_session, account_id=owner.id, project_id=created["id"]
    )
    assert referenced is not None
    assert (referenced.name, referenced.color_token) == ("9월 요금제 개편", "violet")


async def test_there_is_no_restore_endpoint(client: AsyncClient, owner: Owner) -> None:
    created = await _create(client, owner)
    await client.delete(f"{BASE}/{created['id']}", headers=owner.headers)

    response = await client.post(
        f"{BASE}/{created['id']}/restore", json={}, headers=owner.headers
    )

    assert response.status_code == 404


# --- 소유 검사 · 인증 게이트 ---------------------------------------------


async def test_another_accounts_project_is_404_not_403(
    client: AsyncClient, owner: Owner, stranger: Owner
) -> None:
    mine = await _create(client, owner, name="내 프로젝트")

    patched = await client.patch(
        f"{BASE}/{mine['id']}", json={"name": "가로채기"}, headers=stranger.headers
    )
    deleted = await client.delete(f"{BASE}/{mine['id']}", headers=stranger.headers)

    assert patched.status_code == deleted.status_code == 404
    assert patched.json() == {"detail": "항목을 찾을 수 없습니다", "code": "not_found"}

    listed = (await client.get(BASE, headers=owner.headers)).json()["items"]
    assert listed[0]["name"] == "내 프로젝트"


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", BASE, None),
        ("POST", BASE, {"name": "무단", "colorToken": "violet"}),
        ("PATCH", f"{BASE}/1", {"name": "무단"}),
        ("DELETE", f"{BASE}/1", None),
    ],
)
async def test_every_surface_requires_a_session(
    client: AsyncClient, method: str, path: str, body: dict | None
) -> None:
    response = await client.request(method, path, json=body)

    assert response.status_code == 401
    assert response.json()["code"] == "token_expired"
