"""SPEC-003 §4 — 자식 컬렉션 계약 (Phase 3).

**로그가 남는 자리와 안 남는 자리**를 여기서 못박는다(DEC-002 §6 · T-8) —
대상은 생성·할일 완료·첨부·연관 연결뿐이고, 메모와 인라인 편집은 대상이 아니다.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.task import TaskLog, TaskRelation
from tests.task_fixtures import TaskOwner, owner, stranger  # noqa: F401

BASE = "/api/tasks"


async def _create(client: AsyncClient, owner: TaskOwner, **overrides: object) -> dict:
    body: dict = {"title": "업무", "workTypeId": owner.work_type_id}
    body.update(overrides)
    response = await client.post(BASE, json=body, headers=owner.headers)
    assert response.status_code == 201, response.text
    return response.json()


async def _detail(client: AsyncClient, owner: TaskOwner, task_id: int) -> dict:
    response = await client.get(f"{BASE}/{task_id}", headers=owner.headers)
    assert response.status_code == 200
    return response.json()


def _log_texts(detail: dict) -> list[str]:
    return [log["text"] for log in detail["logs"]]


# --- 할일 ---------------------------------------------------------------


async def test_a_todo_can_be_added_and_the_progress_follows(
    client: AsyncClient, owner: TaskOwner
) -> None:
    task = await _create(client, owner)

    response = await client.post(
        f"{BASE}/{task['id']}/todos", json={"text": "필요사항 체크"}, headers=owner.headers
    )

    assert response.status_code == 201
    assert response.json()["done"] is False

    detail = await _detail(client, owner, task["id"])
    assert detail["todoProgress"] == {"done": 0, "total": 1}
    # 할일 **추가**는 로그 대상이 아니다 — 완료만 남는다
    assert _log_texts(detail) == ["업무 생성"]


async def test_completing_a_todo_raises_progress_and_writes_one_log(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """T-8 — 완료로 바뀌면 **같은 트랜잭션에서 로그 한 줄**이 남는다."""
    task = await _create(client, owner, todos=[{"text": "A"}, {"text": "B"}])
    todo_id = task["todos"][0]["id"]

    response = await client.patch(
        f"{BASE}/{task['id']}/todos/{todo_id}", json={"done": True}, headers=owner.headers
    )

    assert response.status_code == 200
    assert response.json()["done"] is True

    detail = await _detail(client, owner, task["id"])
    assert detail["todoProgress"] == {"done": 1, "total": 2}
    assert _log_texts(detail) == ["할일 1건 완료", "업무 생성"]  # 최신순


async def test_unchecking_lowers_the_progress_but_keeps_the_log(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """되돌리면 진행률만 내려가고 **로그는 지워지지 않는다** — 로그는 사실의 기록이다."""
    task = await _create(client, owner, todos=[{"text": "A"}])
    todo_id = task["todos"][0]["id"]
    await client.patch(
        f"{BASE}/{task['id']}/todos/{todo_id}", json={"done": True}, headers=owner.headers
    )

    await client.patch(
        f"{BASE}/{task['id']}/todos/{todo_id}",
        json={"done": False},
        headers=owner.headers,
    )

    detail = await _detail(client, owner, task["id"])
    assert detail["todoProgress"] == {"done": 0, "total": 1}
    assert _log_texts(detail) == ["할일 1건 완료", "업무 생성"]


async def test_recompleting_the_same_todo_does_not_duplicate_the_log(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """이미 완료인 할일에 `done:true` 를 다시 보내도 로그가 늘지 않는다(전이일 때만 남는다)."""
    task = await _create(client, owner, todos=[{"text": "A"}])
    todo_id = task["todos"][0]["id"]
    for _ in range(3):
        await client.patch(
            f"{BASE}/{task['id']}/todos/{todo_id}",
            json={"done": True},
            headers=owner.headers,
        )

    detail = await _detail(client, owner, task["id"])
    assert _log_texts(detail).count("할일 1건 완료") == 1


async def test_a_todo_text_can_be_edited_without_a_log(
    client: AsyncClient, owner: TaskOwner
) -> None:
    task = await _create(client, owner, todos=[{"text": "A"}])
    todo_id = task["todos"][0]["id"]

    response = await client.patch(
        f"{BASE}/{task['id']}/todos/{todo_id}", json={"text": "고친 할일"}, headers=owner.headers
    )

    assert response.json()["text"] == "고친 할일"
    assert _log_texts(await _detail(client, owner, task["id"])) == ["업무 생성"]


async def test_a_todo_can_be_deleted(client: AsyncClient, owner: TaskOwner) -> None:
    task = await _create(client, owner, todos=[{"text": "A"}, {"text": "B"}])
    todo_id = task["todos"][0]["id"]

    response = await client.delete(
        f"{BASE}/{task['id']}/todos/{todo_id}", headers=owner.headers
    )

    assert response.status_code == 204
    detail = await _detail(client, owner, task["id"])
    assert [todo["text"] for todo in detail["todos"]] == ["B"]
    assert detail["todoProgress"] == {"done": 0, "total": 1}


async def test_another_accounts_todo_is_404(
    client: AsyncClient, owner: TaskOwner, stranger: TaskOwner
) -> None:
    task = await _create(client, owner, todos=[{"text": "A"}])
    todo_id = task["todos"][0]["id"]

    response = await client.patch(
        f"{BASE}/{task['id']}/todos/{todo_id}",
        json={"done": True},
        headers=stranger.headers,
    )

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


async def test_a_todo_of_another_task_is_404(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """다른 업무의 할일 id 를 섞어 보내도 404 다 — 부모로 좁혀 찾는다."""
    first = await _create(client, owner, title="A", todos=[{"text": "A-1"}])
    second = await _create(client, owner, title="B")

    response = await client.patch(
        f"{BASE}/{second['id']}/todos/{first['todos'][0]['id']}",
        json={"done": True},
        headers=owner.headers,
    )

    assert response.status_code == 404


# --- 메모 ---------------------------------------------------------------


async def test_a_memo_is_registered_without_a_log(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """U-9 · DEC-002 §6 — **메모는 로그가 아니다.**"""
    task = await _create(client, owner)

    response = await client.post(
        f"{BASE}/{task['id']}/memos", json={"text": "확인 필요"}, headers=owner.headers
    )

    assert response.status_code == 201
    body = response.json()
    assert [memo["text"] for memo in body["memos"]] == ["확인 필요"]
    assert _log_texts(body) == ["업무 생성"]


async def test_memos_come_back_newest_first(
    client: AsyncClient, owner: TaskOwner
) -> None:
    task = await _create(client, owner)
    for text in ("첫째", "둘째", "셋째"):
        await client.post(
            f"{BASE}/{task['id']}/memos", json={"text": text}, headers=owner.headers
        )

    detail = await _detail(client, owner, task["id"])

    assert [memo["text"] for memo in detail["memos"]] == ["셋째", "둘째", "첫째"]


async def test_there_is_no_memo_edit_or_delete_surface(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """S003-OQ-4 — **수정·삭제 표면을 만들지 않았다.**"""
    task = await _create(client, owner)
    created = await client.post(
        f"{BASE}/{task['id']}/memos", json={"text": "메모"}, headers=owner.headers
    )
    memo_id = created.json()["memos"][0]["id"]

    patched = await client.patch(
        f"{BASE}/{task['id']}/memos/{memo_id}", json={"text": "고침"}, headers=owner.headers
    )
    deleted = await client.delete(
        f"{BASE}/{task['id']}/memos/{memo_id}", headers=owner.headers
    )

    assert patched.status_code in (404, 405)
    assert deleted.status_code in (404, 405)


# --- 첨부 ---------------------------------------------------------------


async def test_a_link_attachment_is_added_with_a_role_specific_log(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """U-7 — 로그 문구가 `role` 로 갈린다."""
    task = await _create(client, owner)

    reference = await client.post(
        f"{BASE}/{task['id']}/attachments",
        json={"role": "reference", "kind": "link", "url": "https://example.test/a", "label": "참고"},
        headers=owner.headers,
    )
    deliverable = await client.post(
        f"{BASE}/{task['id']}/attachments",
        json={"role": "deliverable", "kind": "link", "url": "https://example.test/b"},
        headers=owner.headers,
    )

    assert reference.status_code == deliverable.status_code == 201
    body = deliverable.json()
    assert [attachment["role"] for attachment in body["attachments"]] == [
        "reference",
        "deliverable",
    ]
    # 표시 이름 — 비우면 URL 을 그대로 쓴다(U-7)
    assert body["attachments"][0]["name"] == "참고"
    assert body["attachments"][1]["name"] == "https://example.test/b"
    assert _log_texts(body) == ["결과자료 1건 첨부", "참고자료 1건 첨부", "업무 생성"]


async def test_a_doc_attachment_is_rejected_for_now(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """**임시 계약** — 대상 `document` 테이블이 아직 없다(WORK-004 §Open Issues).

    문서함 work 가 FK 리비전과 함께 이 갈래를 실체화한다.
    """
    task = await _create(client, owner)

    response = await client.post(
        f"{BASE}/{task['id']}/attachments",
        json={"role": "reference", "kind": "doc", "documentId": 12},
        headers=owner.headers,
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert (await _detail(client, owner, task["id"]))["attachments"] == []


@pytest.mark.parametrize(
    "url",
    ["ftp://example.test/a", "file:///etc/passwd", "javascript:alert(1)", "example.test"],
)
async def test_only_http_and_https_links_are_accepted(
    client: AsyncClient, owner: TaskOwner, url: str
) -> None:
    """§4 Validation — `kind='link'` 은 **`http`/`https` 만**이다."""
    task = await _create(client, owner)

    response = await client.post(
        f"{BASE}/{task['id']}/attachments",
        json={"role": "reference", "kind": "link", "url": url},
        headers=owner.headers,
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


async def test_an_attachment_can_be_removed(
    client: AsyncClient, owner: TaskOwner
) -> None:
    task = await _create(client, owner)
    created = await client.post(
        f"{BASE}/{task['id']}/attachments",
        json={"role": "reference", "kind": "link", "url": "https://example.test/a"},
        headers=owner.headers,
    )
    attachment_id = created.json()["attachments"][0]["id"]

    response = await client.delete(
        f"{BASE}/{task['id']}/attachments/{attachment_id}", headers=owner.headers
    )

    assert response.status_code == 204
    assert (await _detail(client, owner, task["id"]))["attachments"] == []


async def test_a_doc_attachment_in_creation_blocks_the_whole_task(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    """생성에서도 같은 판정이다 — 부분 저장이 없다(§5)."""
    response = await client.post(
        BASE,
        json={
            "title": "문서 첨부 포함",
            "workTypeId": owner.work_type_id,
            "attachments": [{"role": "reference", "kind": "doc", "documentId": 12}],
        },
        headers=owner.headers,
    )

    assert response.status_code == 422
    count = await db_session.scalar(
        select(func.count()).select_from(TaskLog).where(TaskLog.content == "업무 생성")
    )
    assert count == 0


# --- 연관업무 -----------------------------------------------------------


async def test_relations_are_bidirectional(client: AsyncClient, owner: TaskOwner) -> None:
    """T-10 · U-8 — A 에 B 를 걸면 **B 의 상세에도 A 가** 보인다(무방향 1행)."""
    first = await _create(client, owner, title="A")
    second = await _create(client, owner, title="B")

    response = await client.post(
        f"{BASE}/{first['id']}/relations",
        json={"taskIds": [second["id"]]},
        headers=owner.headers,
    )

    assert response.status_code == 200
    assert [relation["id"] for relation in response.json()["relations"]] == [second["id"]]
    assert _log_texts(response.json()) == ["연관업무 1건 연결", "업무 생성"]

    reverse = await _detail(client, owner, second["id"])
    assert [relation["id"] for relation in reverse["relations"]] == [first["id"]]
    assert reverse["relationTotal"] == 1


async def test_relinking_the_same_pair_does_not_grow(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    """중복 재전송이 **행을 늘리지 않는다**(T-10). 로그도 늘지 않는다."""
    first = await _create(client, owner, title="A")
    second = await _create(client, owner, title="B")
    await client.post(
        f"{BASE}/{first['id']}/relations",
        json={"taskIds": [second["id"]]},
        headers=owner.headers,
    )

    again = await client.post(
        f"{BASE}/{first['id']}/relations",
        json={"taskIds": [second["id"]]},
        headers=owner.headers,
    )

    assert again.json()["relationTotal"] == 1
    assert _log_texts(again.json()).count("연관업무 1건 연결") == 1

    rows = await db_session.scalar(select(func.count()).select_from(TaskRelation))
    assert rows == 1


async def test_the_reverse_direction_is_also_deduplicated(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    """B → A 로 다시 걸어도 같은 쌍이라 한 행이다."""
    first = await _create(client, owner, title="A")
    second = await _create(client, owner, title="B")
    await client.post(
        f"{BASE}/{first['id']}/relations",
        json={"taskIds": [second["id"]]},
        headers=owner.headers,
    )

    await client.post(
        f"{BASE}/{second['id']}/relations",
        json={"taskIds": [first["id"]]},
        headers=owner.headers,
    )

    assert await db_session.scalar(select(func.count()).select_from(TaskRelation)) == 1


async def test_linking_several_at_once_writes_one_log(
    client: AsyncClient, owner: TaskOwner
) -> None:
    first = await _create(client, owner, title="A")
    others = [(await _create(client, owner, title=f"B{i}"))["id"] for i in range(3)]

    response = await client.post(
        f"{BASE}/{first['id']}/relations", json={"taskIds": others}, headers=owner.headers
    )

    assert response.json()["relationTotal"] == 3
    assert _log_texts(response.json())[0] == "연관업무 3건 연결"


async def test_relating_to_itself_is_422(client: AsyncClient, owner: TaskOwner) -> None:
    task = await _create(client, owner)

    response = await client.post(
        f"{BASE}/{task['id']}/relations", json={"taskIds": [task["id"]]}, headers=owner.headers
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


async def test_relating_to_another_accounts_task_is_422(
    client: AsyncClient, owner: TaskOwner, stranger: TaskOwner
) -> None:
    mine = await _create(client, owner, title="내 것")
    theirs = await _create(client, stranger, title="남의 것")

    response = await client.post(
        f"{BASE}/{mine['id']}/relations",
        json={"taskIds": [theirs["id"]]},
        headers=owner.headers,
    )

    assert response.status_code == 422


async def test_a_relation_can_be_unlinked(client: AsyncClient, owner: TaskOwner) -> None:
    first = await _create(client, owner, title="A")
    second = await _create(client, owner, title="B")
    await client.post(
        f"{BASE}/{first['id']}/relations",
        json={"taskIds": [second["id"]]},
        headers=owner.headers,
    )

    response = await client.delete(
        f"{BASE}/{first['id']}/relations/{second['id']}", headers=owner.headers
    )

    assert response.status_code == 204
    assert (await _detail(client, owner, first["id"]))["relationTotal"] == 0
    assert (await _detail(client, owner, second["id"]))["relationTotal"] == 0


async def test_the_detail_shows_only_five_relations_but_the_full_count(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """06-related-tasks — 상세에는 **최근 5건 + 「전체 n 보기」**만 노출한다."""
    first = await _create(client, owner, title="A")
    others = [(await _create(client, owner, title=f"B{i}"))["id"] for i in range(7)]
    await client.post(
        f"{BASE}/{first['id']}/relations", json={"taskIds": others}, headers=owner.headers
    )

    detail = await _detail(client, owner, first["id"])

    assert len(detail["relations"]) == 5
    assert detail["relationTotal"] == 7


# --- 연관업무 후보 (U-8) -------------------------------------------------


async def test_candidates_exclude_self_and_already_linked(
    client: AsyncClient, owner: TaskOwner
) -> None:
    first = await _create(client, owner, title="기준")
    linked = await _create(client, owner, title="이미 연결")
    free = await _create(client, owner, title="후보")
    await client.post(
        f"{BASE}/{first['id']}/relations",
        json={"taskIds": [linked["id"]]},
        headers=owner.headers,
    )

    response = await client.get(
        f"{BASE}/{first['id']}/relations/candidates", headers=owner.headers
    )

    assert response.status_code == 200
    ids = [item["id"] for item in response.json()["items"]]
    assert first["id"] not in ids
    assert linked["id"] not in ids
    assert free["id"] in ids


async def test_candidates_prefer_the_same_project(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """검색어가 없으면 **같은 프로젝트 → 기한 ±7일 → 최근 수정** 순이다(U-8)."""
    await _create(client, owner, title="무소속")
    same_project = await _create(
        client, owner, title="같은 프로젝트", projectId=owner.project_id
    )
    base = await _create(client, owner, title="기준", projectId=owner.project_id)

    response = await client.get(
        f"{BASE}/{base['id']}/relations/candidates", headers=owner.headers
    )

    assert response.json()["items"][0]["id"] == same_project["id"]


async def test_candidates_can_be_searched_by_keyword(
    client: AsyncClient, owner: TaskOwner
) -> None:
    base = await _create(client, owner, title="기준")
    await _create(client, owner, title="소개서 리뷰")
    await _create(client, owner, title="관계 없는 것")

    response = await client.get(
        f"{BASE}/{base['id']}/relations/candidates",
        params={"keyword": "소개서"},
        headers=owner.headers,
    )

    assert [item["title"] for item in response.json()["items"]] == ["소개서 리뷰"]


async def test_candidates_never_include_another_account(
    client: AsyncClient, owner: TaskOwner, stranger: TaskOwner
) -> None:
    base = await _create(client, owner, title="기준")
    theirs = await _create(client, stranger, title="남의 업무")

    response = await client.get(
        f"{BASE}/{base['id']}/relations/candidates", headers=owner.headers
    )

    assert theirs["id"] not in [item["id"] for item in response.json()["items"]]
