"""SPEC-004 §4 — 상태 전이 · 완료 게이트 · 실행취소 · 소프트 딜리트 (Phase 1).

**이 제품의 규칙이 여기 있다.** 세 진입점(리스트 셀·상세 드롭다운·칸반 DnD)과 이후 회의록이
전부 `PATCH /api/tasks/{id}/status` 하나로 들어와 `change_status()` 하나가 판정한다.

BE §12 필수 테스트 **1**(완료 게이트) · **2**(전이 그래프)가 여기 있다.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.task import Task, TaskLog, TaskMemo, TaskTodo
from tests.task_fixtures import TaskOwner, owner, stranger  # noqa: F401

BASE = "/api/tasks"


async def _create(client: AsyncClient, owner: TaskOwner, **overrides: object) -> dict:
    body: dict = {"title": "상태 대상", "workTypeId": owner.work_type_id}
    body.update(overrides)
    response = await client.post(BASE, json=body, headers=owner.headers)
    assert response.status_code == 201, response.text
    return response.json()


async def _set_status(
    client: AsyncClient, owner: TaskOwner, task_id: int, **body: object
) -> object:
    return await client.patch(
        f"{BASE}/{task_id}/status", json=body, headers=owner.headers
    )


async def _add_deliverable(client: AsyncClient, owner: TaskOwner, task_id: int) -> dict:
    response = await client.post(
        f"{BASE}/{task_id}/attachments",
        json={"role": "deliverable", "kind": "link", "url": "https://example.test/out"},
        headers=owner.headers,
    )
    assert response.status_code == 201
    return response.json()


async def _status_of(session: AsyncSession, task_id: int) -> str:
    row = (await session.scalars(select(Task).where(Task.id == task_id))).one()
    return row.status


async def _log_texts(client: AsyncClient, owner: TaskOwner, task_id: int) -> list[str]:
    detail = await client.get(f"{BASE}/{task_id}", headers=owner.headers)
    return [log["text"] for log in detail.json()["logs"]]


# --- BE §12-1 완료 게이트 ------------------------------------------------


async def test_completing_without_any_result_is_blocked_and_the_status_stays(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    """T-5 — 결과자료도 완료 결과도 없이 완료로 보내면 **422 이고 상태가 그대로**다."""
    task = await _create(client, owner)

    response = await _set_status(client, owner, task["id"], status="done")

    assert response.status_code == 422
    assert response.json() == {
        "detail": "완료하려면 결과자료 1건 또는 완료 결과가 필요합니다",
        "code": "task_completion_blocked",
        # 422 는 전부 `field` 를 싣는다(WORK-007 4-b) — 칸이 없는 판정은 null
        "field": None,
    }
    assert await _status_of(db_session, task["id"]) == "todo"
    # 거부는 로그를 남기지 않는다(SPEC-004 U-6)
    assert await _log_texts(client, owner, task["id"]) == ["업무 생성"]


async def test_a_deliverable_attachment_opens_the_gate(
    client: AsyncClient, owner: TaskOwner
) -> None:
    task = await _create(client, owner)
    await _add_deliverable(client, owner, task["id"])

    response = await _set_status(client, owner, task["id"], status="done")

    assert response.status_code == 200
    assert response.json()["status"] == "done"
    assert "상태 시작전 → 완료" in await _log_texts(client, owner, task["id"])


async def test_a_completion_result_alone_opens_the_gate(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """**둘 중 하나**다 — 결과자료를 지우고 완료 결과만 적어도 통과한다."""
    task = await _create(client, owner)
    attachment = await _add_deliverable(client, owner, task["id"])
    attachment_id = attachment["attachments"][0]["id"]
    await client.delete(
        f"{BASE}/{task['id']}/attachments/{attachment_id}", headers=owner.headers
    )

    blocked = await _set_status(client, owner, task["id"], status="done")
    assert blocked.status_code == 422

    await client.patch(
        f"{BASE}/{task['id']}",
        json={"completionResult": "소개서 v2 배포함"},
        headers=owner.headers,
    )
    response = await _set_status(client, owner, task["id"], status="done")

    assert response.status_code == 200


async def test_a_blank_completion_result_does_not_open_the_gate(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """「공백 제거 후 1자 이상」이다 — 공백만 적어 놓고 완료할 수 없다."""
    task = await _create(client, owner)
    await client.patch(
        f"{BASE}/{task['id']}", json={"completionResult": "   "}, headers=owner.headers
    )

    response = await _set_status(client, owner, task["id"], status="done")

    assert response.status_code == 422
    assert response.json()["code"] == "task_completion_blocked"


async def test_the_gate_is_judged_again_on_every_attempt(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """거부된 뒤 조건을 채우면 통과한다 — 판정이 요청마다 돈다(SPEC-004 U-6)."""
    task = await _create(client, owner)
    for _ in range(3):
        assert (await _set_status(client, owner, task["id"], status="done")).status_code == 422

    await _add_deliverable(client, owner, task["id"])

    assert (await _set_status(client, owner, task["id"], status="done")).status_code == 200


# --- BE §12-2 전이 그래프 ------------------------------------------------


async def test_done_cannot_go_to_cancelled(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    """T-6 — **완료 → 취소는 없다.** 먼저 진행중으로 되돌려야 한다(DEC-002 §4)."""
    task = await _create(client, owner)
    await _add_deliverable(client, owner, task["id"])
    await _set_status(client, owner, task["id"], status="done")

    response = await _set_status(
        client, owner, task["id"], status="cancelled", cancelReason="요건 변경"
    )

    assert response.status_code == 409
    assert response.json() == {
        "detail": "이 상태로는 바꿀 수 없습니다",
        "code": "invalid_status_transition",
    }
    assert await _status_of(db_session, task["id"]) == "done"


@pytest.mark.parametrize(
    ("path", "target"),
    [
        (["in_progress"], "todo"),
        (["in_progress"], "cancelled"),
        ([], "in_progress"),
        ([], "cancelled"),
    ],
)
async def test_allowed_transitions_pass(
    client: AsyncClient, owner: TaskOwner, path: list[str], target: str
) -> None:
    task = await _create(client, owner)
    for step in path:
        assert (await _set_status(client, owner, task["id"], status=step)).status_code == 200

    body: dict = {"status": target}
    if target == "cancelled":
        body["cancelReason"] = "요건 변경"
    response = await client.patch(
        f"{BASE}/{task['id']}/status", json=body, headers=owner.headers
    )

    assert response.status_code == 200
    assert response.json()["status"] == target


async def test_staying_on_the_same_status_is_rejected(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """그래프에 **자기 자신으로 가는 화살표가 없다** — 같은 상태를 다시 보내면 409 다.

    칸반에서 같은 컬럼에 다시 놓는 경우가 이 자리다.
    """
    task = await _create(client, owner)
    assert task["status"] == "todo"

    same = await _set_status(client, owner, task["id"], status="todo")

    assert same.status_code == 409
    assert same.json()["code"] == "invalid_status_transition"

    await _set_status(client, owner, task["id"], status="in_progress")
    again = await _set_status(client, owner, task["id"], status="in_progress")

    assert again.status_code == 409


async def test_cancelled_can_only_go_back_to_todo(
    client: AsyncClient, owner: TaskOwner
) -> None:
    task = await _create(client, owner)
    await _set_status(client, owner, task["id"], status="cancelled", cancelReason="중복 업무")

    blocked = await _set_status(client, owner, task["id"], status="in_progress")
    revived = await _set_status(client, owner, task["id"], status="todo")

    assert blocked.status_code == 409
    assert revived.status_code == 200
    # T-7 — 취소를 떠나면 사유가 비워진다
    assert revived.json()["cancelReason"] is None


async def test_an_unknown_status_value_is_422(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """**「지연」은 값이 아니다**(T-4). 4종 밖은 FastAPI 가 거른다."""
    task = await _create(client, owner)

    response = await _set_status(client, owner, task["id"], status="overdue")

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


# --- 취소 사유 (T-7) -----------------------------------------------------


async def test_cancelling_without_a_reason_is_422(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    task = await _create(client, owner)

    response = await _set_status(client, owner, task["id"], status="cancelled")

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert await _status_of(db_session, task["id"]) == "todo"


async def test_a_blank_reason_is_422(client: AsyncClient, owner: TaskOwner) -> None:
    task = await _create(client, owner)

    response = await _set_status(
        client, owner, task["id"], status="cancelled", cancelReason="   "
    )

    assert response.status_code == 422


async def test_a_reason_on_a_non_cancel_transition_is_rejected(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """T-7 — `cancelReason` 은 취소로 갈 때만 받는다. 완료에 얹어 보내면 거부한다."""
    task = await _create(client, owner)
    await _add_deliverable(client, owner, task["id"])

    response = await _set_status(
        client, owner, task["id"], status="done", cancelReason="이건 취소가 아니다"
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


async def test_cancelling_writes_the_reason_and_a_reason_log(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """DEC-002 §6 — `logCancelReason` 기본 참이라 사유 기록 줄이 함께 남는다."""
    task = await _create(client, owner)

    response = await _set_status(
        client, owner, task["id"], status="cancelled", cancelReason="일정 연기"
    )

    assert response.status_code == 200
    assert response.json()["cancelReason"] == "일정 연기"
    assert response.json()["cancelledAt"] is not None
    assert await _log_texts(client, owner, task["id"]) == [
        "취소 사유 기록",
        "상태 시작전 → 취소",
        "업무 생성",
    ]


async def test_the_reason_log_can_be_turned_off(
    client: AsyncClient, owner: TaskOwner
) -> None:
    task = await _create(client, owner)

    await _set_status(
        client,
        owner,
        task["id"],
        status="cancelled",
        cancelReason="중복 업무",
        logCancelReason=False,
    )

    assert await _log_texts(client, owner, task["id"]) == [
        "상태 시작전 → 취소",
        "업무 생성",
    ]


# --- 실행취소 -------------------------------------------------------------


async def test_undo_restores_the_previous_status_and_removes_that_log(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    """SPEC-004 §4 — 직전 상태 복원 + **그 전이 로그 삭제**(한 트랜잭션)."""
    task = await _create(client, owner)
    await _set_status(client, owner, task["id"], status="in_progress")
    await _add_deliverable(client, owner, task["id"])
    await _set_status(client, owner, task["id"], status="done")

    response = await client.post(
        f"{BASE}/{task['id']}/status/undo", headers=owner.headers
    )

    assert response.status_code == 200
    assert response.json()["status"] == "in_progress"
    assert await _status_of(db_session, task["id"]) == "in_progress"

    texts = await _log_texts(client, owner, task["id"])
    assert "상태 진행중 → 완료" not in texts
    # 그 전 전이 로그는 남는다 — 지우는 것은 **마지막 한 줄**뿐이다
    assert "상태 시작전 → 진행중" in texts


async def test_undo_is_unavailable_after_four_seconds(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    """조건 ③ — **4초 이내**. 완료 토스트 수명과 맞춘 값이다."""
    task = await _create(client, owner)
    await _add_deliverable(client, owner, task["id"])
    await _set_status(client, owner, task["id"], status="done")

    # 5초 전으로 밀어 창을 넘긴다(테스트가 5초를 실제로 기다리지 않는다)
    log = (
        await db_session.scalars(
            select(TaskLog)
            .where(TaskLog.task_id == task["id"], TaskLog.to_status == "done")
        )
    ).one()
    log.created_at = datetime.now(UTC) - timedelta(seconds=5)
    await db_session.flush()

    response = await client.post(
        f"{BASE}/{task['id']}/status/undo", headers=owner.headers
    )

    assert response.status_code == 409
    assert response.json() == {
        "detail": "되돌릴 수 있는 시간이 지났습니다",
        "code": "undo_not_available",
    }
    assert await _status_of(db_session, task["id"]) == "done"


async def test_undo_is_unavailable_when_something_else_happened_after(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """조건 ② — 전이 뒤에 (로그를 남기는) 다른 변경이 있으면 되돌릴 수 없다."""
    task = await _create(client, owner)
    await _add_deliverable(client, owner, task["id"])
    await _set_status(client, owner, task["id"], status="done")

    # 첨부는 로그를 남긴다 → 마지막 로그가 전이가 아니게 된다
    await client.post(
        f"{BASE}/{task['id']}/attachments",
        json={"role": "reference", "kind": "link", "url": "https://example.test/ref"},
        headers=owner.headers,
    )

    response = await client.post(
        f"{BASE}/{task['id']}/status/undo", headers=owner.headers
    )

    assert response.status_code == 409
    assert response.json()["code"] == "undo_not_available"


async def test_undo_is_unavailable_when_there_was_no_transition(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """조건 ① — 마지막 로그가 상태 전이가 아니다(생성 직후)."""
    task = await _create(client, owner)

    response = await client.post(
        f"{BASE}/{task['id']}/status/undo", headers=owner.headers
    )

    assert response.status_code == 409
    assert response.json()["code"] == "undo_not_available"


async def test_undo_twice_is_rejected(client: AsyncClient, owner: TaskOwner) -> None:
    """한 번 되돌리면 그 로그가 사라져 두 번째는 조건 ①에 걸린다."""
    task = await _create(client, owner)
    await _set_status(client, owner, task["id"], status="in_progress")

    first = await client.post(f"{BASE}/{task['id']}/status/undo", headers=owner.headers)
    second = await client.post(f"{BASE}/{task['id']}/status/undo", headers=owner.headers)

    assert first.status_code == 200
    assert first.json()["status"] == "todo"
    assert second.status_code == 409


# --- 소프트 딜리트 --------------------------------------------------------


async def test_delete_is_soft_and_keeps_the_row_and_children(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    """T-11 — 목록에서 빠지지만 **행과 자식이 DB 에 남는다.**"""
    task = await _create(client, owner, todos=[{"text": "할일"}])
    await client.post(
        f"{BASE}/{task['id']}/memos", json={"text": "메모"}, headers=owner.headers
    )

    response = await client.delete(f"{BASE}/{task['id']}", headers=owner.headers)

    assert response.status_code == 204
    assert response.content == b""

    listed = await client.get(BASE, headers=owner.headers)
    assert task["id"] not in [item["id"] for item in listed.json()["items"]]

    row = (await db_session.scalars(select(Task).where(Task.id == task["id"]))).one()
    assert row.deleted_at is not None
    assert (
        await db_session.scalar(
            select(func.count()).select_from(TaskTodo).where(TaskTodo.task_id == task["id"])
        )
        == 1
    )
    assert (
        await db_session.scalar(
            select(func.count()).select_from(TaskMemo).where(TaskMemo.task_id == task["id"])
        )
        == 1
    )


async def test_a_deleted_task_cannot_change_status(
    client: AsyncClient, owner: TaskOwner
) -> None:
    task = await _create(client, owner)
    await client.delete(f"{BASE}/{task['id']}", headers=owner.headers)

    response = await _set_status(client, owner, task["id"], status="in_progress")

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


async def test_deleting_twice_is_404(client: AsyncClient, owner: TaskOwner) -> None:
    task = await _create(client, owner)
    await client.delete(f"{BASE}/{task['id']}", headers=owner.headers)

    response = await client.delete(f"{BASE}/{task['id']}", headers=owner.headers)

    assert response.status_code == 404


async def test_there_is_no_restore_endpoint(client: AsyncClient, owner: TaskOwner) -> None:
    """**복원 경로를 만들지 않는다**(DEC-004 §4)."""
    task = await _create(client, owner)
    await client.delete(f"{BASE}/{task['id']}", headers=owner.headers)

    for path in (f"{BASE}/{task['id']}/restore", f"{BASE}/{task['id']}/undelete"):
        assert (
            await client.post(path, json={}, headers=owner.headers)
        ).status_code in (404, 405)


# --- 게이트 우회 차단 ------------------------------------------------------


@pytest.mark.parametrize("value", ["done", "in_progress", "cancelled", "todo"])
async def test_the_general_patch_refuses_status(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner, value: str
) -> None:
    """**게이트 우회 경로를 스키마 층에서 막는다**(BE §10).

    일반 `PATCH` 에 `status` 를 보내면 422 다 — `TaskUpdateDTO` 에 그 필드가 없다.
    """
    task = await _create(client, owner)

    response = await client.patch(
        f"{BASE}/{task['id']}", json={"status": value}, headers=owner.headers
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert await _status_of(db_session, task["id"]) == "todo"


async def test_status_transitions_require_a_session(client: AsyncClient) -> None:
    for method, path, body in (
        ("PATCH", f"{BASE}/1/status", {"status": "done"}),
        ("POST", f"{BASE}/1/status/undo", None),
        ("DELETE", f"{BASE}/1", None),
    ):
        response = await client.request(method, path, json=body)
        assert response.status_code == 401
        assert response.json()["code"] == "token_expired"


async def test_another_accounts_task_is_404(
    client: AsyncClient, owner: TaskOwner, stranger: TaskOwner
) -> None:
    """소유 검사가 먼저다 — 남의 업무는 404 다(§5)."""
    mine = await _create(client, owner)

    changed = await _set_status(client, stranger, mine["id"], status="in_progress")
    undone = await client.post(
        f"{BASE}/{mine['id']}/status/undo", headers=stranger.headers
    )
    deleted = await client.delete(f"{BASE}/{mine['id']}", headers=stranger.headers)

    assert changed.status_code == undone.status_code == deleted.status_code == 404
