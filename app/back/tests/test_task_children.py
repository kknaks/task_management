"""SPEC-003 §4 — 자식 컬렉션 계약 (Phase 3).

**로그가 남는 자리와 안 남는 자리**를 여기서 못박는다(DEC-002 §6 · T-8) —
대상은 생성·할일 완료·첨부·연관 연결뿐이고, 메모와 인라인 편집은 대상이 아니다.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.task import Task, TaskLog, TaskRelation
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


# --- 연관업무 후보 (U-8 · §4 2026-09-06 개정) ----------------------------
#
# **업무에 매달리지 않는 컬렉션 표면**이다. U-1 이 생성 드로어에도 「업무 연결」을 두는데
# 그 시점에는 자기 id 가 없기 때문이다.

CANDIDATES = f"{BASE}/relations/candidates"


async def test_the_candidates_route_is_matched_before_the_task_id_route(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """**선언 순서가 계약이다.**

    `GET /{task_id}` 의 `task_id` 는 `int` 라, 이 라우트가 뒤에 선언되면
    `relations` 를 id 로 파싱하려다 422 가 난다. 200 이어야 순서가 맞은 것이다.
    """
    response = await client.get(CANDIDATES, headers=owner.headers)

    assert response.status_code == 200, response.text
    assert "items" in response.json()


async def test_candidates_work_without_an_exclude_id(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """생성 드로어 경로 — 자기 id 가 없어도 **200 이고 후보가 온다.**"""
    first = await _create(client, owner, title="후보 A")
    second = await _create(client, owner, title="후보 B")

    response = await client.get(CANDIDATES, headers=owner.headers)

    assert response.status_code == 200
    ids = [item["id"] for item in response.json()["items"]]
    assert first["id"] in ids
    assert second["id"] in ids


async def test_exclude_id_drops_itself_and_already_linked(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """상세 드로어 경로 — 자기 자신과 **이미 연결된 업무가 함께 빠진다.**"""
    base = await _create(client, owner, title="기준")
    linked = await _create(client, owner, title="이미 연결")
    free = await _create(client, owner, title="후보")
    await client.post(
        f"{BASE}/{base['id']}/relations",
        json={"taskIds": [linked["id"]]},
        headers=owner.headers,
    )

    response = await client.get(
        CANDIDATES, params={"excludeId": base["id"]}, headers=owner.headers
    )

    assert response.status_code == 200
    ids = [item["id"] for item in response.json()["items"]]
    assert base["id"] not in ids
    assert linked["id"] not in ids
    assert free["id"] in ids

    # `excludeId` 를 빼면 둘 다 다시 후보다 — 제외는 그 파라미터의 몫이다
    without = await client.get(CANDIDATES, headers=owner.headers)
    assert {base["id"], linked["id"]} <= {
        item["id"] for item in without.json()["items"]
    }


async def test_exclude_id_of_another_account_is_404(
    client: AsyncClient, owner: TaskOwner, stranger: TaskOwner
) -> None:
    """남의 업무를 `excludeId` 로 줘도 **404** 다 — 존재를 흘리지 않는다."""
    theirs = await _create(client, stranger, title="남의 업무")

    response = await client.get(
        CANDIDATES, params={"excludeId": theirs["id"]}, headers=owner.headers
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "업무를 찾을 수 없습니다", "code": "not_found"}


async def test_exclude_id_that_does_not_exist_is_404(
    client: AsyncClient, owner: TaskOwner
) -> None:
    response = await client.get(
        CANDIDATES, params={"excludeId": 987654321}, headers=owner.headers
    )

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


async def test_query_project_id_moves_the_same_project_to_the_front(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """생성 드로어는 **폼에 입력 중인** 값을 보낸다 — 그것으로 정렬이 바뀐다.

    같은 프로젝트 업무를 **먼저** 만든다 — 정렬 근거가 없을 때의 기본이 「최근 수정 순」이라,
    나중에 만들면 힌트 없이도 맨 앞이라 아무것도 증명하지 못한다.
    """
    same_project = await _create(
        client, owner, title="같은 프로젝트", projectId=owner.project_id
    )
    await _create(client, owner, title="무소속")

    without = await client.get(CANDIDATES, headers=owner.headers)
    with_project = await client.get(
        CANDIDATES, params={"projectId": owner.project_id}, headers=owner.headers
    )

    # 정렬 근거가 없으면 최근 수정 순이라 「같은 프로젝트」가 맨 앞이 아니다
    assert without.json()["items"][0]["id"] != same_project["id"]
    assert with_project.json()["items"][0]["id"] == same_project["id"]


async def test_query_due_date_moves_nearby_deadlines_up(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """기한 ±7일이 그 다음 순위다(U-8)."""
    far = await _create(client, owner, title="먼 기한", dueDate="2026-12-01")
    near = await _create(client, owner, title="가까운 기한", dueDate="2026-09-12")

    response = await client.get(
        CANDIDATES, params={"dueDate": "2026-09-10"}, headers=owner.headers
    )

    ids = [item["id"] for item in response.json()["items"]]
    assert ids.index(near["id"]) < ids.index(far["id"])


async def test_exclude_id_wins_over_the_query_sort_hints(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """§4 — **`excludeId` 가 있으면 서버가 그 업무의 값을 쓴다**(쿼리 값보다 우선).

    상세 드로어가 정렬 근거를 따로 보내지 않아도 되게 하는 규칙이다.
    """
    await _create(client, owner, title="무소속")
    same_project = await _create(
        client, owner, title="같은 프로젝트", projectId=owner.project_id
    )
    base = await _create(client, owner, title="기준", projectId=owner.project_id)

    response = await client.get(
        CANDIDATES,
        # 쿼리로는 「프로젝트 없음」을 주장해도 기준 업무의 프로젝트가 이긴다
        params={"excludeId": base["id"], "projectId": 987654321},
        headers=owner.headers,
    )

    assert response.json()["items"][0]["id"] == same_project["id"]


async def test_candidates_can_be_searched_by_keyword(
    client: AsyncClient, owner: TaskOwner
) -> None:
    await _create(client, owner, title="소개서 리뷰")
    await _create(client, owner, title="관계 없는 것")

    response = await client.get(
        CANDIDATES, params={"keyword": "소개서"}, headers=owner.headers
    )

    assert [item["title"] for item in response.json()["items"]] == ["소개서 리뷰"]


async def test_candidates_never_include_another_account_or_deleted_tasks(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner, stranger: TaskOwner
) -> None:
    mine = await _create(client, owner, title="내 업무")
    theirs = await _create(client, stranger, title="남의 업무")
    removed = await _create(client, owner, title="지운 업무")
    row = (await db_session.scalars(select(Task).where(Task.id == removed["id"]))).one()
    row.deleted_at = datetime.now(UTC)
    await db_session.flush()

    response = await client.get(CANDIDATES, headers=owner.headers)

    ids = [item["id"] for item in response.json()["items"]]
    assert mine["id"] in ids
    assert theirs["id"] not in ids
    assert removed["id"] not in ids


async def test_candidates_require_a_session(client: AsyncClient) -> None:
    response = await client.get(CANDIDATES)

    assert response.status_code == 401
    assert response.json()["code"] == "token_expired"


async def test_the_old_per_task_candidates_route_is_gone(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """표면을 둘로 두지 않는다 — 옛 경로에 **GET 이 없다**(§4 개정).

    404 가 아니라 **405** 다: 그 경로는 아직 `DELETE /{task_id}/relations/{otherTaskId}` 의
    패턴과 겹쳐서(`candidates` 가 그 자리에 들어간다) Starlette 이 「경로는 있고 메서드가 없다」로
    답한다. 어느 쪽이든 **후보 검색이 여기 없다**는 사실은 같다.
    """
    task = await _create(client, owner)

    response = await client.get(
        f"{BASE}/{task['id']}/relations/candidates", headers=owner.headers
    )

    assert response.status_code == 405
    assert "items" not in response.text


# --- 후보 `scope` 필터 · `total` (SPEC-003 §4 2026-09-06) -----------------
#
# `scope` 는 **자르는 필터**이고 `projectId`·`dueDate` 는 **정렬 근거**다 — 역할이 다르다.
# U-8 의 필터 칩 3(「이 프로젝트」/「최근 30일」/「전체」)이 `scope` 세 값과 1:1 이다.


async def test_scope_project_keeps_only_the_same_project(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """기본값 `project` — 기준 업무와 **같은 프로젝트만** 남는다."""
    same = await _create(client, owner, title="같은 프로젝트", projectId=owner.project_id)
    other = await _create(client, owner, title="무소속 후보")
    base = await _create(client, owner, title="기준", projectId=owner.project_id)

    scoped = await client.get(
        CANDIDATES, params={"excludeId": base["id"], "scope": "project"}, headers=owner.headers
    )

    ids = [item["id"] for item in scoped.json()["items"]]
    assert ids == [same["id"]]
    assert other["id"] not in ids
    assert scoped.json()["total"] == 1


async def test_scope_all_returns_more_than_scope_project(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """같은 `excludeId` 라도 `all` 은 자르지 않는다 — 건수가 달라야 필터가 실제로 먹은 것이다."""
    await _create(client, owner, title="같은 프로젝트", projectId=owner.project_id)
    await _create(client, owner, title="무소속 후보")
    base = await _create(client, owner, title="기준", projectId=owner.project_id)

    scoped = await client.get(
        CANDIDATES, params={"excludeId": base["id"], "scope": "project"}, headers=owner.headers
    )
    everything = await client.get(
        CANDIDATES, params={"excludeId": base["id"], "scope": "all"}, headers=owner.headers
    )

    assert scoped.json()["total"] == 1
    assert everything.json()["total"] == 2
    assert len(everything.json()["items"]) > len(scoped.json()["items"])


async def test_scope_project_without_a_reference_behaves_like_all(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """**빈 목록을 주지 않는다**(SPEC-003 §4).

    무소속 업무이거나 생성 드로어에서 프로젝트를 아직 안 고른 **정상 경로**다 —
    고를 게 없는 팝오버가 뜨는 것이 더 나쁘다. 이건 명시된 동작이지 조용한 폴백이 아니다.
    """
    await _create(client, owner, title="같은 프로젝트", projectId=owner.project_id)
    await _create(client, owner, title="무소속 후보")
    unassigned_base = await _create(client, owner, title="무소속 기준")

    scoped = await client.get(
        CANDIDATES,
        params={"excludeId": unassigned_base["id"], "scope": "project"},
        headers=owner.headers,
    )
    everything = await client.get(
        CANDIDATES,
        params={"excludeId": unassigned_base["id"], "scope": "all"},
        headers=owner.headers,
    )

    assert scoped.json()["items"] != []
    assert scoped.json() == everything.json()


async def test_scope_project_without_any_hint_behaves_like_all(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """생성 드로어가 프로젝트를 안 골랐을 때 — `scope` 를 안 보내도(기본 `project`) 전부 나온다."""
    await _create(client, owner, title="같은 프로젝트", projectId=owner.project_id)
    await _create(client, owner, title="무소속 후보")

    default = await client.get(CANDIDATES, headers=owner.headers)
    everything = await client.get(
        CANDIDATES, params={"scope": "all"}, headers=owner.headers
    )

    assert default.json() == everything.json()
    assert default.json()["total"] == 2


async def test_scope_recent30_drops_tasks_untouched_for_over_a_month(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    """`recent30` — **최근 수정 30일 이내**만 남긴다."""
    fresh = await _create(client, owner, title="최근 수정")
    stale = await _create(client, owner, title="오래된 것")
    row = (await db_session.scalars(select(Task).where(Task.id == stale["id"]))).one()
    row.updated_at = datetime.now(UTC) - timedelta(days=40)
    await db_session.flush()

    recent = await client.get(
        CANDIDATES, params={"scope": "recent30"}, headers=owner.headers
    )
    everything = await client.get(
        CANDIDATES, params={"scope": "all"}, headers=owner.headers
    )

    recent_ids = [item["id"] for item in recent.json()["items"]]
    assert fresh["id"] in recent_ids
    assert stale["id"] not in recent_ids
    assert recent.json()["total"] == 1
    assert stale["id"] in [item["id"] for item in everything.json()["items"]]


@pytest.mark.parametrize("scope", ["bogus", "PROJECT", "recent_30", ""])
async def test_an_unknown_scope_is_422(
    client: AsyncClient, owner: TaskOwner, scope: str
) -> None:
    """세 값 밖은 **FastAPI 의 enum 검증**이 거른다 — 손으로 잡지 않는다."""
    response = await client.get(
        CANDIDATES, params={"scope": scope}, headers=owner.headers
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


async def test_total_is_not_the_page_size_when_there_are_more_than_twenty(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """**`total` 은 `len(items)` 가 아니다** — 상위 20건만 내려주므로 21건부터 갈린다."""
    for index in range(23):
        await _create(client, owner, title=f"후보 {index:02d}")

    response = await client.get(
        CANDIDATES, params={"scope": "all"}, headers=owner.headers
    )

    body = response.json()
    assert len(body["items"]) == 20
    assert body["total"] == 23


async def test_total_follows_the_scope_not_the_whole_table(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """`total` 은 **`scope` 를 적용한 뒤의** 총계다(U-8 「n건 중 m」의 `n`)."""
    for index in range(3):
        await _create(client, owner, title=f"프로젝트 {index}", projectId=owner.project_id)
    for index in range(4):
        await _create(client, owner, title=f"무소속 {index}")
    base = await _create(client, owner, title="기준", projectId=owner.project_id)

    scoped = await client.get(
        CANDIDATES, params={"excludeId": base["id"], "scope": "project"}, headers=owner.headers
    )
    everything = await client.get(
        CANDIDATES, params={"excludeId": base["id"], "scope": "all"}, headers=owner.headers
    )

    assert scoped.json()["total"] == 3
    assert everything.json()["total"] == 7


async def test_total_respects_keyword_and_exclusions(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """검색어·제외와도 어긋나지 않는다 — 총계와 목록이 **같은 조건**을 본다."""
    linked = await _create(client, owner, title="소개서 리뷰")
    await _create(client, owner, title="소개서 초안")
    await _create(client, owner, title="관계 없는 것")
    base = await _create(client, owner, title="기준")
    await client.post(
        f"{BASE}/{base['id']}/relations",
        json={"taskIds": [linked["id"]]},
        headers=owner.headers,
    )

    response = await client.get(
        CANDIDATES,
        params={"excludeId": base["id"], "scope": "all", "keyword": "소개서"},
        headers=owner.headers,
    )

    body = response.json()
    assert [item["title"] for item in body["items"]] == ["소개서 초안"]
    assert body["total"] == 1
