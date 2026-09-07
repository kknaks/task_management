"""WORK-013 Phase 2 — 「넣기」 두 표면. **완료 게이트의 네 번째 진입점**이 우회하지 않는지 실측한다(WORK-005 L137 · L147 · L294).

정본: SPEC-008 §4(`POST`·`PATCH …/lines/{id}/task` · Validation · Case Matrix) · U-6 · U-9 · U-10 ·
SPEC-004 §4(게이트 · 전이 그래프 · 같은 상태 409) · SPEC-003 §4(업무 생성 규칙) · DEC-003 §4(변경분 일곱).

- **요청은 본문이다** — 줄에 저장된 `payload` 를 서버가 쓰지 않는다(사람이 드로어에서 고쳤을 수 있다 · MF-59)
- ①~⑧ 한 트랜잭션 — 같은 상태는 건너뛰고(로그 0), 뒤 단계가 거부되면 앞 단계도 되돌아가며 `payload` 가 남는다
- ④ 메모 · ⑤ 할일 · ⑥ 연관은 **추가**, ⑦ 완료 결과는 **덮어쓴다**. 변경분 0개면 ⑧ 만
- `task_completion_blocked` 는 **이 경로에서 나지 않는다**(`done` 이 스키마 층 422 — `test_meeting_edit.py` 8-c).
  대신 ⑦ 로 **게이트를 열어 두는 것**까지 본다 — 완료는 업무 화면에서 사람이 누른다
- 액션 줄 → 201 · 「시작전」 · 로그 「업무 생성」 · 할일 행 · **줄 본문 유지** · 삭제된 유형이면 `invalid_work_type` 이고 줄이 안 바뀐다
- 정적 검사 4종 — `task.status` 대입 · 게이트 예외 포착 · 전이/게이트 판정 · **`task_service` 를 부르는 함수가 둘뿐**
"""

from __future__ import annotations

import ast
import re
from datetime import UTC, date, datetime
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.exceptions import ValidationError
from dto.meeting import LineTaskUpdateDTO
from models.account import WorkType
from models.meeting import MeetingLine
from models.task import Task, TaskLog, TaskMemo, TaskTodo
from service import meeting_task_link_service
from tests.fakes.agent import FakeAgentGateway
from tests.meeting_close_fixtures import (  # noqa: F401
    close_scope,
    fake_async_stt,
    end_meeting,
    finalize_successfully,
    prepare_recording,
)
from tests.meeting_fixtures import BASE, MeetingOwner, owner, stranger  # noqa: F401
from tests.meeting_live_fixtures import add_task

pytestmark = pytest.mark.usefixtures("close_scope", "fake_async_stt")

TASKS = "/api/tasks"
# 드로어가 저장해 둔 초안 — **요청이 아니다.** 「넣기」는 본문을 따로 보낸다
SAVED_DRAFT = {"dueDate": "2026-09-30", "note": "저장만 해 둔 메모"}


# --- 도우미 ---------------------------------------------------------------------------------


def _lines(body: dict, track: str = "merged") -> list[dict]:
    return [line for agenda in body["agendas"][track] for line in agenda["lines"]]


def _line(body: dict, line_id: int) -> dict:
    return next(line for line in _lines(body) if line["id"] == line_id)


def _action_line(body: dict) -> dict:
    return next(line for line in _lines(body) if line["kind"] == "action")


async def _count(session: AsyncSession, model, *where) -> int:  # type: ignore[no-untyped-def]
    return await session.scalar(select(func.count()).select_from(model).where(*where)) or 0


async def _task_state(session: AsyncSession, task_id: int) -> dict:
    """전후 비교의 대상 — 상태 · 기한 · 완료 결과 · 자식 수 · 전이 로그 수."""
    session.expire_all()
    row = (await session.scalars(select(Task).where(Task.id == task_id))).one()
    return {
        "status": row.status,
        "due_date": row.due_date,
        "project_id": row.project_id,
        "completion_result": row.completion_result,
        "completed_at": row.completed_at,
        "memos": await _count(session, TaskMemo, TaskMemo.task_id == task_id),
        "todos": await _count(session, TaskTodo, TaskTodo.task_id == task_id),
        "logs": await _count(session, TaskLog, TaskLog.task_id == task_id),
        "transitions": await _count(session, TaskLog, TaskLog.task_id == task_id, TaskLog.to_status.is_not(None)),
    }


async def _payload_of(session: AsyncSession, line_id: int) -> dict | None:
    session.expire_all()
    return await session.scalar(select(MeetingLine.payload).where(MeetingLine.id == line_id))


async def _task_line(
    client: AsyncClient, owner: MeetingOwner, meeting_id: int, agenda_id: int, *, task_id: int | None = None, payload: dict | None = None
) -> dict:
    """U-9 칩 진입 — `POST …/lines { kind:'task', content, taskId?, payload? }`. **업무는 안 생긴다.**"""
    body: dict = {"agendaId": agenda_id, "kind": "task", "content": "소개서 v2 문구 정리 — 기한 미루기"}
    if task_id is not None:
        body["taskId"] = task_id
    if payload is not None:
        body["payload"] = payload
    response = await client.post(f"{BASE}/{meeting_id}/lines", json=body, headers=owner.headers)
    assert response.status_code == 201, response.text
    return response.json()


async def _apply(client: AsyncClient, owner: MeetingOwner, meeting_id: int, line_id: int, body: dict):  # type: ignore[no-untyped-def]
    return await client.patch(f"{BASE}/{meeting_id}/lines/{line_id}/task", json=body, headers=owner.headers)


async def _add_deliverable(client: AsyncClient, owner: MeetingOwner, task_id: int) -> None:
    response = await client.post(
        f"{TASKS}/{task_id}/attachments",
        json={"role": "deliverable", "kind": "link", "url": "https://example.test/out"},
        headers=owner.headers,
    )
    assert response.status_code == 201, response.text


async def _complete_via_my_tasks(client: AsyncClient, owner: MeetingOwner, task_id: int) -> None:
    """내 업무 화면이 지나는 문 — `PATCH /api/tasks/{id}/status`. 회의록 경로와 **같은 판정**을 지난다."""
    await _add_deliverable(client, owner, task_id)
    response = await client.patch(f"{TASKS}/{task_id}/status", json={"status": "done"}, headers=owner.headers)
    assert response.status_code == 200, response.text


# --- 「업무 갱신」 — ①~⑧ ----------------------------------------------------------------------------


async def test_the_body_is_the_request_and_all_seven_changes_land_in_one_transaction(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """드로어에서 사람이 확인·수정한 **본문**이 요청이다 — 줄에 저장된 초안은 쓰이지 않는다(MF-59).

    ① 상태 ② 기한 ③ 프로젝트 ④ 메모(추가) ⑤ 할일(추가) ⑥ 연관(양방향) ⑦ 완료 결과(덮어씀) ⑧ 줄 확정.
    """
    task_id = await add_task(db_session, owner, title="갱신할 업무", project_id=None)
    related_id = await add_task(db_session, owner, title="연관될 업무", project_id=None)
    body, _ = await finalize_successfully(client, owner, db_session, fake_agent)
    agenda_id = body["agendas"]["merged"][0]["id"]
    line = await _task_line(client, owner, body["id"], agenda_id, task_id=task_id, payload=SAVED_DRAFT)
    before = await _task_state(db_session, task_id)
    assert (before["status"], before["memos"], before["todos"], before["transitions"]) == ("todo", 0, 0, 0)

    applied = await _apply(client, owner, body["id"], line["id"], {
        "taskId": task_id,
        "status": "in_progress",
        "dueDate": "2026-09-02",
        "projectId": owner.project_id,
        "note": "드로어에서 고친 메모",
        "todos": ["초안 작성", "내부 검토"],
        "relatedTaskIds": [related_id],
        "completionResult": "검수 통과분 정리",
    })
    assert applied.status_code == 200, applied.text

    after = await _task_state(db_session, task_id)
    assert (after["status"], after["due_date"], after["project_id"]) == ("in_progress", date(2026, 9, 2), owner.project_id)
    assert (after["memos"], after["todos"], after["transitions"]) == (1, 2, 1)
    assert after["completion_result"] == "검수 통과분 정리"

    # ⑧ — 줄은 그 업무로 확정되고 `payload` 는 비워진다. **저장돼 있던 초안(9/30)은 반영되지 않았다**
    shown = _line(applied.json(), line["id"])
    assert (shown["payload"], shown["taskId"], shown["task"]["dueDate"]) == (None, task_id, "2026-09-02")
    assert await _payload_of(db_session, line["id"]) is None

    task = (await client.get(f"{TASKS}/{task_id}", headers=owner.headers)).json()
    assert [memo["text"] for memo in task["memos"]] == ["드로어에서 고친 메모"]
    assert [todo["text"] for todo in task["todos"]] == ["초안 작성", "내부 검토"]
    assert [relation["id"] for relation in task["relations"]] == [related_id]
    # 내 업무 화면에서 여는 것과 **같은 로그**(같은 서비스) — 전이 한 줄 · 연관 한 줄(기한·메모·완료 결과는 로그가 없다)
    assert sorted(log["text"] for log in task["logs"]) == ["상태 시작전 → 진행중", "연관업무 1건 연결"]
    # ⑥ 은 양방향이다(SPEC-003 U-8)
    other = (await client.get(f"{TASKS}/{related_id}", headers=owner.headers)).json()
    assert [relation["id"] for relation in other["relations"]] == [task_id]


async def test_the_header_selector_wins_and_an_empty_change_set_only_settles_the_line(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """변경분 0개도 받는다 — **⑧ 만** 일어난다. 본문의 `taskId` 가 줄에 저장돼 있던 업무를 이긴다(M-14 ②)."""
    saved_task_id = await add_task(db_session, owner, title="AI 가 고른 업무", project_id=None)
    chosen_task_id = await add_task(db_session, owner, title="사람이 고른 업무", project_id=None)
    body, _ = await finalize_successfully(client, owner, db_session, fake_agent)
    line = await _task_line(client, owner, body["id"], body["agendas"]["merged"][0]["id"], task_id=saved_task_id, payload=SAVED_DRAFT)
    before = await _task_state(db_session, chosen_task_id)

    applied = await _apply(client, owner, body["id"], line["id"], {"taskId": chosen_task_id})
    assert applied.status_code == 200, applied.text
    shown = _line(applied.json(), line["id"])
    assert (shown["taskId"], shown["payload"], shown["task"]["title"]) == (chosen_task_id, None, "사람이 고른 업무")
    # 어느 업무도 바뀌지 않았다 — 줄만 확정됐다
    assert await _task_state(db_session, chosen_task_id) == before
    assert (await _task_state(db_session, saved_task_id))["logs"] == 0  # 손대지 않았다(대역 업무라 생성 로그도 없다)


async def test_the_same_status_is_skipped_without_409(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """① `status` 가 현재와 같으면 **전이를 부르지 않는다** — `task_log` 가 늘지 않는다(SPEC-004 L478 이 사용자에게 안 보이게)."""
    task_id = await add_task(db_session, owner, title="이미 진행중인 업무", project_id=None)
    assert (await client.patch(f"{TASKS}/{task_id}/status", json={"status": "in_progress"}, headers=owner.headers)).status_code == 200
    body, _ = await finalize_successfully(client, owner, db_session, fake_agent)
    line = await _task_line(client, owner, body["id"], body["agendas"]["merged"][0]["id"], task_id=task_id)
    before = await _task_state(db_session, task_id)
    assert (before["status"], before["transitions"]) == ("in_progress", 1)

    applied = await _apply(client, owner, body["id"], line["id"], {"taskId": task_id, "status": "in_progress", "dueDate": "2026-09-02"})
    assert applied.status_code == 200, applied.text
    after = await _task_state(db_session, task_id)
    assert (after["status"], after["due_date"]) == ("in_progress", date(2026, 9, 2))
    assert (after["transitions"], after["logs"]) == (before["transitions"], before["logs"])  # 로그가 하나도 안 늘었다


async def test_invalid_transition_is_409_and_keeps_the_payload(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """`done → todo` 는 그래프 밖 — 판정은 `task_service` 가 하고 회의록 코드는 그 답을 그대로 전파한다."""
    task_id = await add_task(db_session, owner, title="완료된 업무", project_id=None)
    await _complete_via_my_tasks(client, owner, task_id)
    body, _ = await finalize_successfully(client, owner, db_session, fake_agent)
    line = await _task_line(client, owner, body["id"], body["agendas"]["merged"][0]["id"], task_id=task_id, payload={"status": "todo", "note": "되돌림"})
    before = await _task_state(db_session, task_id)

    response = await _apply(client, owner, body["id"], line["id"], {"taskId": task_id, "status": "todo", "note": "되돌림"})
    assert (response.status_code, response.json()["code"]) == (409, "invalid_status_transition")
    assert await _task_state(db_session, task_id) == before
    assert await _payload_of(db_session, line["id"]) == {"status": "todo", "note": "되돌림"}


async def test_a_later_step_failure_rolls_back_the_earlier_transition(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """① 전이는 통과했는데 ② 기한이 거부되면(시작일보다 앞) **전이도 되돌아간다** — 한 트랜잭션.

    HTTP 층에서는 `get_db` 가 요청 트랜잭션을 통째로 되돌리므로 service 를 savepoint 안에서 직접 불러 실측한다.
    """
    task_id = await add_task(db_session, owner, title="시작일 있는 업무", project_id=None)
    row = (await db_session.scalars(select(Task).where(Task.id == task_id))).one()
    row.start_date = date(2026, 9, 10)
    await db_session.flush()
    body, _ = await finalize_successfully(client, owner, db_session, fake_agent)
    line = await _task_line(client, owner, body["id"], body["agendas"]["merged"][0]["id"], task_id=task_id, payload=SAVED_DRAFT)
    before = await _task_state(db_session, task_id)

    with pytest.raises(ValidationError):
        async with db_session.begin_nested():
            await meeting_task_link_service.apply_task_update(
                db_session,
                account_id=owner.id,
                meeting_id=body["id"],
                line_id=line["id"],
                command=LineTaskUpdateDTO(task_id=task_id, status="in_progress", due_date=date(2026, 9, 1), note="메모"),
            )

    assert await _task_state(db_session, task_id) == before
    assert await _payload_of(db_session, line["id"]) == SAVED_DRAFT  # 초안이 남는다 — 다시 열어 고칠 수 있다


async def test_the_completion_result_opens_the_gate_for_the_task_screen(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """⑦ 완료 결과는 **게이트를 열어 두는 값**이다 — 회의록은 완료를 누르지 않고, 사람이 업무 화면에서 누른다(MF-59).

    덮어쓰기다(추가가 아니다). 결과자료가 없어도 완료 결과 하나로 게이트가 열린다(T-5).
    """
    task_id = await add_task(db_session, owner, title="결과 없는 업무", project_id=None)
    body, _ = await finalize_successfully(client, owner, db_session, fake_agent)
    line = await _task_line(client, owner, body["id"], body["agendas"]["merged"][0]["id"], task_id=task_id)

    # 완료 결과가 없으면 업무 화면에서도 막힌다
    blocked = await client.patch(f"{TASKS}/{task_id}/status", json={"status": "done"}, headers=owner.headers)
    assert (blocked.status_code, blocked.json()["code"]) == (422, "task_completion_blocked")

    for text in ("첫 정리", "다시 정리한 결과"):
        applied = await _apply(client, owner, body["id"], line["id"], {"taskId": task_id, "completionResult": text})
        assert applied.status_code == 200, applied.text
    assert (await _task_state(db_session, task_id))["completion_result"] == "다시 정리한 결과"  # 덮어썼다

    opened = await client.patch(f"{TASKS}/{task_id}/status", json={"status": "done"}, headers=owner.headers)
    assert opened.status_code == 200, opened.text


# --- 검증 · 경계 ----------------------------------------------------------------------------------


async def test_update_body_validation_and_missing_targets(
    client: AsyncClient, owner: MeetingOwner, stranger: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    task_id = await add_task(db_session, owner, title="연결 업무", project_id=None)
    body, _ = await finalize_successfully(client, owner, db_session, fake_agent)
    agenda_id = body["agendas"]["merged"][0]["id"]
    line = await _task_line(client, owner, body["id"], agenda_id, task_id=task_id, payload=SAVED_DRAFT)
    path = f"{BASE}/{body['id']}/lines/{line['id']}/task"

    # `taskId` 필수 · 일곱 키 밖 · `done`·`cancelled` · 빈 값
    for bad, field in (
        ({}, "taskId"),
        ({"taskId": task_id, "cancelReason": "x"}, "cancelReason"),
        ({"taskId": task_id, "status": "done"}, "status"),
        ({"taskId": task_id, "note": None}, None),
        ({"taskId": task_id, "todos": [""]}, "todos[0]"),
    ):
        response = await client.patch(path, json=bad, headers=owner.headers)
        assert (response.status_code, response.json()["code"]) == (422, "validation_error"), bad
        if field is not None:
            assert response.json()["field"] == field, (bad, response.json())

    # 액션 줄에는 「업무 갱신」이 없다(그쪽은 `POST` 다)
    action = _action_line(body)
    response = await client.patch(f"{BASE}/{body['id']}/lines/{action['id']}/task", json={"taskId": task_id}, headers=owner.headers)
    assert (response.status_code, response.json()["code"], response.json()["field"]) == (422, "validation_error", "kind")

    # 없는 업무 · 삭제된 업무 — 404 이고 `payload` 가 남는다. 상세에는 `isDeleted:true` 로 실려 온다
    assert (await _apply(client, owner, body["id"], line["id"], {"taskId": 999999})).status_code == 404
    assert (await client.delete(f"{TASKS}/{task_id}", headers=owner.headers)).status_code == 204
    response = await _apply(client, owner, body["id"], line["id"], {"taskId": task_id})
    assert (response.status_code, response.json()["code"]) == (404, "not_found")
    assert await _payload_of(db_session, line["id"]) == SAVED_DRAFT
    shown = _line((await client.get(f"{BASE}/{body['id']}", headers=owner.headers)).json(), line["id"])
    assert (shown["task"]["isDeleted"], shown["task"]["title"]) == (True, "연결 업무")

    # 남의 회의 · 줄 — 404 (두 표면 모두)
    for call in (
        client.patch(path, json={"taskId": task_id}, headers=stranger.headers),
        client.post(f"{BASE}/{body['id']}/lines/{action['id']}/task", json={"title": "t", "workTypeId": stranger.task_type_id}, headers=stranger.headers),
    ):
        response = await call
        assert (response.status_code, response.json()["code"]) == (404, "not_found")


async def test_task_surfaces_are_locked_while_generating(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession
) -> None:
    detail = await prepare_recording(client, owner, db_session)
    human = [line for agenda in detail["agendas"]["human"] for line in agenda["lines"]][0]
    await end_meeting(client, owner, detail["id"])  # generating — job 은 돌리지 않는다
    for call in (
        client.post(f"{BASE}/{detail['id']}/lines/{human['id']}/task", json={"title": "t", "workTypeId": owner.task_type_id}, headers=owner.headers),
        client.patch(f"{BASE}/{detail['id']}/lines/{human['id']}/task", json={"taskId": 1}, headers=owner.headers),
    ):
        response = await call
        assert (response.status_code, response.json()["code"]) == (409, "invalid_meeting_status")


# --- 「업무 생성」 — 액션 줄 -----------------------------------------------------------------------------


async def test_create_task_from_an_action_line_keeps_the_line_text(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    body, _ = await finalize_successfully(client, owner, db_session, fake_agent)
    action = _action_line(body)
    tasks_before = await _count(db_session, Task, Task.account_id == owner.id)
    path = f"{BASE}/{body['id']}/lines/{action['id']}/task"

    # 유형이 없으면 422 — 줄도 업무도 그대로(`payload` 에서는 `null` 이어도 됐지만 여기서는 필수다)
    response = await client.post(path, json={"title": "후속 미팅 잡기"}, headers=owner.headers)
    assert (response.status_code, response.json()["code"]) == (422, "validation_error")
    assert await _count(db_session, Task, Task.account_id == owner.id) == tasks_before

    # 삭제된 유형 — `invalid_work_type`(SPEC-003 §4) 이고 **줄이 바뀌지 않는다**(한 트랜잭션)
    gone = WorkType(account_id=owner.id, kind="task", name="지워진 유형", color_token="steel", is_default=False, deleted_at=datetime.now(UTC))
    db_session.add(gone)
    await db_session.flush()
    response = await client.post(path, json={"title": "후속 미팅 잡기", "workTypeId": gone.id}, headers=owner.headers)
    assert (response.status_code, response.json()["code"]) == (422, "invalid_work_type")
    assert await _count(db_session, Task, Task.account_id == owner.id) == tasks_before
    db_session.expire_all()
    untouched = (await db_session.scalars(select(MeetingLine).where(MeetingLine.id == action["id"]))).one()
    assert (untouched.kind, untouched.task_id, untouched.content) == ("action", None, action["content"])

    # 성공 — 201 · 그 줄이 업무 줄 · 「시작전」 + 로그 「업무 생성」 · 할일 두 줄 · **줄 본문은 사람이 적은 그대로**
    response = await client.post(
        path,
        json={"title": "후속 미팅 잡기", "workTypeId": owner.task_type_id, "projectId": owner.project_id,
              "startDate": "2026-09-01", "dueDate": "2026-09-12", "description": "9/12 오전", "todos": ["초안 작성", "내부 검토"]},
        headers=owner.headers,
    )
    assert response.status_code == 201, response.text
    line = _line(response.json(), action["id"])
    assert (line["kind"], line["content"], line["payload"]) == ("task", action["content"], None)
    assert line["task"] == {
        "id": line["taskId"], "title": "후속 미팅 잡기", "status": "todo", "dueDate": "2026-09-12", "isDeleted": False,
        "workType": {"id": owner.task_type_id, "name": f"{owner.login_id} 업무 유형", "kind": "task", "colorToken": "steel", "isDeleted": False},
    }
    # 카운트가 다섯으로 갈렸다(WORK-012 · SPEC-008 §4 Data Contract) — 액션이 업무가 되면 자리가 옮겨간다
    assert response.json()["mergedSummary"]["actionCount"] == body["mergedSummary"]["actionCount"] - 1
    assert response.json()["mergedSummary"]["taskCount"] == body["mergedSummary"]["taskCount"] + 1
    task = (await client.get(f"{TASKS}/{line['taskId']}", headers=owner.headers)).json()
    assert (task["status"], task["startDate"], task["dueDate"], task["description"]) == ("todo", "2026-09-01", "2026-09-12", "9/12 오전")
    assert [todo["text"] for todo in task["todos"]] == ["초안 작성", "내부 검토"]
    assert [log["text"] for log in task["logs"]] == ["업무 생성"]
    assert await _count(db_session, Task, Task.account_id == owner.id) == tasks_before + 1

    # 이미 업무 줄이 된 줄에는 다시 만들 수 없다
    response = await client.post(path, json={"title": "또", "workTypeId": owner.task_type_id}, headers=owner.headers)
    assert (response.status_code, response.json()["code"]) == (422, "validation_error")


# --- 정적 검사 4종 — 완료 게이트 우회 0건 (WORK-005 L147 · L294 · WP Phase 2 검증) ---------------------------------


BACK = Path(__file__).resolve().parents[1]


def _code_only(source: str) -> str:
    without_docstrings = re.sub(r'"""[\s\S]*?"""', "", source)
    return "\n".join(line for line in without_docstrings.splitlines() if not line.strip().startswith("#"))


def _meeting_services() -> dict[str, str]:
    return {path.name: _code_only(path.read_text(encoding="utf-8")) for path in sorted((BACK / "service").glob("meeting_*.py"))}


def test_static_1_task_status_is_assigned_only_inside_the_status_transition_path() -> None:
    """① `task.status` 대입은 `task_repository.update_status()` 한 곳이고, 그것을 부르는 곳은 `task_service` 뿐이다."""
    assigners: list[str] = []
    callers: list[str] = []
    for path in sorted((BACK / "service").glob("*.py")) + sorted((BACK / "repository").glob("*.py")) + sorted((BACK / "api").glob("*.py")):
        code = _code_only(path.read_text(encoding="utf-8"))
        for line in code.splitlines():
            if re.search(r"\b(task|row|target)\.status\s*=(?!=)", line):
                assigners.append(f"{path.name}: {line.strip()}")
            if "update_status(" in line and "def update_status" not in line:
                callers.append(path.name)
    assert assigners == ["task_repository.py: row.status = status"], assigners
    assert set(callers) == {"task_service.py"}, callers
    # 그 안에서도 `change_status()` · `undo_last_status()`(WORK-005) 둘뿐 — 회의록 갈래는 없다
    task_service = _code_only((BACK / "service" / "task_service.py").read_text(encoding="utf-8"))
    owners = [m.group(1) for m in re.finditer(r"async def (\w+)\([\s\S]*?(?=\nasync def |\ndef |\Z)", task_service) if "update_status(" in m.group(0)]
    assert owners == ["change_status", "undo_last_status"], owners


def test_static_2_meeting_services_do_not_catch_or_handle_task_gate_errors() -> None:
    """② `meeting_*` 서비스에서 `TaskCompletionBlockedError`(· 전이 예외)를 잡아 다르게 처리하는 코드 0건.

    줄을 쓰는 두 서비스(`edit` · `task_link`)에는 `try/except` 자체가 없다 — 거부는 그대로 전파돼 요청이 통째로 되돌아간다.
    (`batch` · `finalize` 의 `except` 는 에이전트 실패를 job 에 적는 다른 경로다 — 업무 예외와 무관하다.)
    """
    services = _meeting_services()
    for name, code in services.items():
        for banned in ("TaskCompletionBlockedError", "InvalidStatusTransitionError", "task_completion_blocked", "invalid_status_transition"):
            assert banned not in code, (name, banned)
    for name in ("meeting_task_link_service.py", "meeting_edit_service.py"):
        assert not re.search(r"^\s*(try:|except\b)", services[name], re.MULTILINE), name


def test_static_3_no_transition_graph_or_completion_gate_in_meeting_services() -> None:
    """③ 전이 그래프 · 완료 조건 판정(결과자료 · 완료 게이트)이 `meeting_*` 에 0건.

    **`completion_result` 는 예외다** — 링크 서비스가 그 값을 `task_service.update_task()` 로 **넘기기만** 한다(⑦).
    게이트를 여는 것은 값이 채워졌다는 사실이고, 그 판정은 여전히 `task_service` 안이다(T-5). 그래서 그 파일만 통과시키고
    「결과자료를 센다」(`deliverable` · `count_deliverables`)는 어디에도 없어야 한다.
    """
    services = _meeting_services()
    for name, code in services.items():
        banned = ["_TRANSITIONS", "count_deliverables", "deliverable", "TaskStatus.DONE", '"done"', "\"in_progress\"", "sync_actuals"]
        if name != "meeting_task_link_service.py":
            banned.append("completion_result")
        for needle in banned:
            assert needle not in code, (name, needle)
        assert not re.search(r"\.status\s*=(?!=)", code.replace("meeting.status", "").replace("MeetingStatus", "")), name
    link = services["meeting_task_link_service.py"]
    # 판정 함수는 **그대로** 부른다 — 회의록 갈래 전용 인자 · 우회 플래그가 없다
    for call in ("change_status(", "create_task(", "update_task(", "add_memo(", "add_todo(", "link_relations("):
        assert f"task_service.{call}" in link, call
    for banned in ("task_repository.update", "task_child_repository", "update_fields", "create_log", "create_memo"):
        assert banned not in link, banned


def test_static_4_only_two_functions_touch_task_service() -> None:
    """④ **`task_service` 를 부르는 회의록 코드는 두 함수뿐**이다(WP §Internal Interface).

    파일 단위가 아니라 **함수 단위**로 센다 — 도우미 하나가 늘면 「업무를 바꾸는 자리」가 조용히 셋이 된다.
    """
    users = sorted(name for name, code in _meeting_services().items() if "task_service" in code)
    assert users == ["meeting_task_link_service.py"], users

    tree = ast.parse((BACK / "service" / "meeting_task_link_service.py").read_text(encoding="utf-8"))
    callers = sorted(
        node.name
        for node in ast.walk(tree)
        if isinstance(node, ast.AsyncFunctionDef | ast.FunctionDef)
        and any(
            isinstance(inner, ast.Attribute)
            and isinstance(inner.value, ast.Name)
            and inner.value.id == "task_service"
            for inner in ast.walk(node)
        )
    )
    assert callers == ["apply_task_update", "create_task_from_line"], callers
