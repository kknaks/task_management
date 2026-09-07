"""WORK-008 Phase 5 — 업무 연동. **완료 게이트의 네 번째 진입점**이 우회하지 않는지 실측한다(WORK-005 L137 · L147 · L294).

정본: SPEC-008 §4(`POST`·`PATCH …/lines/{id}/task` · `POST …/lines {newTask}` · Validation · Case Matrix) · U-6 · U-9 · U-10 ·
SPEC-004 §4(게이트 · 전이 그래프 · 같은 상태 409) · SPEC-003 §4(업무 생성 규칙) · DEC-003 §4 L102(`payload` 세 키).

- 게이트 거부 → 422 `task_completion_blocked` 이고 **`task.status` · `due_date` · 메모 수 · 로그 수 · `payload` 전부 그대로**(DB 전후 비교)
- 게이트 통과 → 200 · `done` · 전이 로그 **한 줄** · 기한 · 메모 반영 · `payload NULL`
- 이미 `done` 인데 `status:'done'` → **409 없이 200**, 기한 · 메모만 · 전이 로그 없음
- 뒤 단계(기한)가 거부되면 앞 단계(전이)도 **되돌아간다**(service 층 롤백 실측)
- `cancelled` · 넷째 키 → 422 · 삭제된 업무 → 404 · 액션 줄 / 변경 없는 줄 → 422 · 남의 것 → 404 · `generating` → 409
- 액션 줄 → 201 · 「시작전」 · 로그 「업무 생성」 · 줄 `kind='task'` · 유형 없음 422 · 삭제된 유형 `invalid_work_type` 이고 **줄이 안 바뀐다**
- 정적 검사 3종 — `task.status` 대입 · `TaskCompletionBlockedError` 포착 · 전이 그래프/완료 조건 판정이 `meeting_*` 에 **0건**
"""

from __future__ import annotations

import re
from datetime import UTC, date, datetime
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.exceptions import ValidationError
from models.account import WorkType
from models.meeting import MeetingLine
from models.task import Task, TaskLog, TaskMemo
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
PENDING = {"status": "done", "dueDate": "2026-09-02", "note": "검수 일정 변경"}


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
    """게이트 전후 비교의 대상 — 상태 · 기한 · 메모 수 · 로그 수 · 전이 로그 수."""
    session.expire_all()
    row = (await session.scalars(select(Task).where(Task.id == task_id))).one()
    return {
        "status": row.status,
        "due_date": row.due_date,
        "completed_at": row.completed_at,
        "memos": await _count(session, TaskMemo, TaskMemo.task_id == task_id),
        "logs": await _count(session, TaskLog, TaskLog.task_id == task_id),
        "transitions": await _count(session, TaskLog, TaskLog.task_id == task_id, TaskLog.to_status.is_not(None)),
    }


async def _pending_of(session: AsyncSession, line_id: int) -> dict | None:
    session.expire_all()
    return await session.scalar(select(MeetingLine.payload).where(MeetingLine.id == line_id))


async def _link(client: AsyncClient, owner: MeetingOwner, meeting_id: int, agenda_id: int, task_id: int, pending: dict | None) -> dict:
    """U-9 — `POST …/lines { taskId, payload }` 로 업무 줄을 만든다."""
    payload: dict = {"agendaId": agenda_id, "kind": "task", "taskId": task_id}
    if pending is not None:
        payload["payload"] = pending
    response = await client.post(f"{BASE}/{meeting_id}/lines", json=payload, headers=owner.headers)
    assert response.status_code == 201, response.text
    return response.json()


async def _apply(client: AsyncClient, owner: MeetingOwner, meeting_id: int, line_id: int):  # type: ignore[no-untyped-def]
    return await client.patch(f"{BASE}/{meeting_id}/lines/{line_id}/task", headers=owner.headers)


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


# --- 「업무 갱신」 — 완료 게이트 ----------------------------------------------------------------------------


async def test_gate_rejects_and_nothing_changes_then_passes_after_a_deliverable(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    task_id = await add_task(db_session, owner, title="결과 없는 업무", project_id=owner.project_id)
    body, _ = await finalize_successfully(client, owner, db_session, fake_agent)
    agenda_id = body["agendas"]["merged"][0]["id"]
    line = await _link(client, owner, body["id"], agenda_id, task_id, PENDING)
    before = await _task_state(db_session, task_id)
    assert before["status"] == "todo" and before["memos"] == 0 and before["transitions"] == 0

    # 거부 — 결과자료도 완료 결과도 없다. **아무것도 바뀌지 않는다**(기한 · 메모가 먼저 반영되지 않았음을 DB 로)
    rejected = await _apply(client, owner, body["id"], line["id"])
    assert rejected.status_code == 422, rejected.text
    assert rejected.json()["code"] == "task_completion_blocked"
    assert rejected.json()["detail"] == "완료하려면 결과자료 1건 또는 완료 결과가 필요합니다"
    assert await _task_state(db_session, task_id) == before
    assert await _pending_of(db_session, line["id"]) == PENDING
    detail = await client.get(f"{BASE}/{body['id']}", headers=owner.headers)
    shown = _line(detail.json(), line["id"])
    assert (shown["payload"], shown["task"]["status"], shown["task"]["dueDate"]) == (PENDING, "todo", "2026-09-30")

    # 통과 — 결과자료 1건을 붙인 뒤 **같은 요청**
    await _add_deliverable(client, owner, task_id)
    applied = await _apply(client, owner, body["id"], line["id"])
    assert applied.status_code == 200, applied.text
    shown = _line(applied.json(), line["id"])
    assert (shown["payload"], shown["kind"], shown["task"]["status"], shown["task"]["dueDate"]) == (None, "task", "done", "2026-09-02")

    after = await _task_state(db_session, task_id)
    assert (after["status"], after["due_date"], after["memos"], after["transitions"]) == ("done", date(2026, 9, 2), 1, 1)
    assert after["completed_at"] is not None  # 실적 재계산도 같은 판정 함수를 지났다
    assert await _pending_of(db_session, line["id"]) is None
    task = (await client.get(f"{TASKS}/{task_id}", headers=owner.headers)).json()
    assert task["memos"][0]["text"] == "검수 일정 변경"
    # 내 업무 화면에서 여는 것과 **같은 로그**(같은 서비스) — 전이 한 줄 · 결과자료 첨부 한 줄
    assert [log["text"] for log in task["logs"]][:1] == ["상태 시작전 → 완료"]
    # 회의록 쪽에는 업무를 가리키는 것이 남고, 업무 쪽에는 회의록을 가리키는 것이 없다 — 되돌릴 것도 없다
    assert task["description"] is None


async def test_the_same_status_is_skipped_without_409(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    task_id = await add_task(db_session, owner, title="이미 완료된 업무", project_id=owner.project_id)
    await _complete_via_my_tasks(client, owner, task_id)
    body, _ = await finalize_successfully(client, owner, db_session, fake_agent)
    agenda_id = body["agendas"]["merged"][0]["id"]
    before = await _task_state(db_session, task_id)
    assert (before["status"], before["transitions"]) == ("done", 1)

    # `status:'done'` 이 남은 줄 — 서버가 전이를 건너뛴다(SPEC-004 L478). 기한 · 메모만 반영되고 전이 로그가 늘지 않는다
    line = await _link(client, owner, body["id"], agenda_id, task_id, PENDING)
    applied = await _apply(client, owner, body["id"], line["id"])
    assert applied.status_code == 200, applied.text
    after = await _task_state(db_session, task_id)
    assert (after["status"], after["due_date"], after["memos"], after["transitions"]) == ("done", date(2026, 9, 2), 1, before["transitions"])
    assert after["logs"] == before["logs"]
    assert _line(applied.json(), line["id"])["payload"] is None

    # 상태만 같은 줄 — 아무것도 바뀌지 않고 `payload` 만 비워진다
    only_status = await _link(client, owner, body["id"], agenda_id, task_id, {"status": "done"})
    applied = await _apply(client, owner, body["id"], only_status["id"])
    assert applied.status_code == 200, applied.text
    assert await _task_state(db_session, task_id) == after
    assert await _pending_of(db_session, only_status["id"]) is None


async def test_invalid_transition_is_409_and_keeps_payload(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    task_id = await add_task(db_session, owner, title="완료된 업무", project_id=owner.project_id)
    await _complete_via_my_tasks(client, owner, task_id)
    body, _ = await finalize_successfully(client, owner, db_session, fake_agent)
    line = await _link(client, owner, body["id"], body["agendas"]["merged"][0]["id"], task_id, {"status": "todo", "note": "되돌림"})
    before = await _task_state(db_session, task_id)

    # `done → todo` 는 그래프 밖 — 판정은 `task_service` 가 한다. 회의록 쪽 코드는 그 답을 그대로 전파한다
    response = await _apply(client, owner, body["id"], line["id"])
    assert (response.status_code, response.json()["code"]) == (409, "invalid_status_transition")
    assert await _task_state(db_session, task_id) == before
    assert await _pending_of(db_session, line["id"]) == {"status": "todo", "note": "되돌림"}


async def test_a_later_step_failure_rolls_back_the_earlier_transition(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """① 전이는 통과했는데 ② 기한이 거부되면(시작일보다 앞) **전이도 되돌아간다** — 한 트랜잭션.

    HTTP 층에서는 `get_db` 가 요청 트랜잭션을 통째로 되돌리므로 service 를 savepoint 안에서 직접 불러 실측한다.
    """
    task_id = await add_task(db_session, owner, title="시작일 있는 업무", project_id=owner.project_id)
    row = (await db_session.scalars(select(Task).where(Task.id == task_id))).one()
    row.start_date = date(2026, 9, 10)
    await db_session.flush()
    body, _ = await finalize_successfully(client, owner, db_session, fake_agent)
    line = await _link(client, owner, body["id"], body["agendas"]["merged"][0]["id"], task_id, {"status": "in_progress", "dueDate": "2026-09-01", "note": "메모"})
    before = await _task_state(db_session, task_id)

    with pytest.raises(ValidationError):
        async with db_session.begin_nested():
            await meeting_task_link_service.apply_payload(db_session, account_id=owner.id, meeting_id=body["id"], line_id=line["id"])

    assert await _task_state(db_session, task_id) == before
    assert await _pending_of(db_session, line["id"]) == {"status": "in_progress", "dueDate": "2026-09-01", "note": "메모"}


# --- 검증 · 경계 ----------------------------------------------------------------------------------


async def test_payload_validation_and_missing_targets(
    client: AsyncClient, owner: MeetingOwner, stranger: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    task_id = await add_task(db_session, owner, title="연결 업무", project_id=owner.project_id)
    body, _ = await finalize_successfully(client, owner, db_session, fake_agent)
    agenda_id = body["agendas"]["merged"][0]["id"]
    path = f"{BASE}/{body['id']}/lines"

    # 허용 키 3개뿐 — `cancelled` · 넷째 키 · 빈 객체는 422(DEC-003 §4 L102)
    for pending, field in (
        ({"status": "cancelled"}, "payload.status"),
        ({"status": "done", "priority": 1}, "payload.priority"),
        ({"cancelReason": "x"}, "payload.cancelReason"),
        ({}, "payload"),
    ):
        response = await client.post(path, json={"agendaId": agenda_id, "kind": "task", "taskId": task_id, "payload": pending}, headers=owner.headers)
        assert (response.status_code, response.json()["code"], response.json()["field"]) == (422, "validation_error", field), pending

    # 액션 줄 · 변경 없는 업무 줄에는 반영할 것이 없다
    action = _action_line(body)
    response = await _apply(client, owner, body["id"], action["id"])
    assert (response.status_code, response.json()["code"]) == (422, "validation_error")
    linked_without_change = await _link(client, owner, body["id"], agenda_id, task_id, None)
    response = await _apply(client, owner, body["id"], linked_without_change["id"])
    assert (response.status_code, response.json()["code"]) == (422, "validation_error")

    # 삭제된 업무 — 404 이고 상세에는 `isDeleted:true` 로 실려 온다(「삭제된 업무」 표시)
    linked = await _link(client, owner, body["id"], agenda_id, task_id, PENDING)
    deleted = await client.delete(f"{TASKS}/{task_id}", headers=owner.headers)
    assert deleted.status_code == 204
    response = await _apply(client, owner, body["id"], linked["id"])
    assert (response.status_code, response.json()["code"]) == (404, "not_found")
    assert await _pending_of(db_session, linked["id"]) == PENDING
    shown = _line((await client.get(f"{BASE}/{body['id']}", headers=owner.headers)).json(), linked["id"])
    assert (shown["task"]["isDeleted"], shown["task"]["title"]) == (True, "연결 업무")

    # 남의 회의 · 줄 — 404 (두 표면 모두)
    for call in (
        client.patch(f"{BASE}/{body['id']}/lines/{linked['id']}/task", headers=stranger.headers),
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
        client.patch(f"{BASE}/{detail['id']}/lines/{human['id']}/task", headers=owner.headers),
    ):
        response = await call
        assert (response.status_code, response.json()["code"]) == (409, "invalid_meeting_status")


# --- 「업무 생성」 — 액션 줄 · 칩 -----------------------------------------------------------------------------


async def test_create_task_from_an_action_line(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    body, _ = await finalize_successfully(client, owner, db_session, fake_agent)
    action = _action_line(body)
    tasks_before = await _count(db_session, Task, Task.account_id == owner.id)
    path = f"{BASE}/{body['id']}/lines/{action['id']}/task"

    # 유형이 없으면 422 — 줄도 업무도 그대로
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

    # 성공 — 201 · `MeetingDetail` · 그 줄이 업무 줄 · 내 업무에 「시작전」 + 로그 「업무 생성」 · 메모 → `description`
    response = await client.post(
        path,
        json={"title": "후속 미팅 잡기", "workTypeId": owner.task_type_id, "projectId": owner.project_id, "dueDate": "2026-09-12", "description": "9/12 오전"},
        headers=owner.headers,
    )
    assert response.status_code == 201, response.text
    line = _line(response.json(), action["id"])
    assert (line["kind"], line["content"], line["payload"]) == ("task", "후속 미팅 잡기", None)
    assert line["task"] == {
        "id": line["taskId"], "title": "후속 미팅 잡기", "status": "todo", "dueDate": "2026-09-12", "isDeleted": False,
        "workType": {"id": owner.task_type_id, "name": f"{owner.login_id} 업무 유형", "kind": "task", "colorToken": "steel", "isDeleted": False},
    }
    # 카운트가 다섯으로 갈렸다(WORK-012 · SPEC-008 §4 Data Contract) — 액션이 업무가 되면 자리가 옮겨간다
    assert response.json()["mergedSummary"]["actionCount"] == body["mergedSummary"]["actionCount"] - 1
    assert response.json()["mergedSummary"]["taskCount"] == body["mergedSummary"]["taskCount"] + 1
    task = (await client.get(f"{TASKS}/{line['taskId']}", headers=owner.headers)).json()
    assert (task["status"], task["dueDate"], task["description"], task["project"]["id"]) == ("todo", "2026-09-12", "9/12 오전", owner.project_id)
    assert [log["text"] for log in task["logs"]] == ["업무 생성"]
    assert await _count(db_session, Task, Task.account_id == owner.id) == tasks_before + 1

    # 이미 업무 줄이 된 줄에는 다시 만들 수 없다
    response = await client.post(path, json={"title": "또", "workTypeId": owner.task_type_id}, headers=owner.headers)
    assert (response.status_code, response.json()["code"]) == (422, "validation_error")


async def test_new_task_line_from_the_agenda_chip(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    body, _ = await finalize_successfully(client, owner, db_session, fake_agent)
    agenda = body["agendas"]["merged"][1]
    path = f"{BASE}/{body['id']}/lines"
    tasks_before = await _count(db_session, Task, Task.account_id == owner.id)

    # `newTask` 에 `payload` 를 얹으면 422 — 새 업무에 반영할 「변경」은 없다
    response = await client.post(path, json={"agendaId": agenda["id"], "kind": "task", "newTask": {"title": "칩 업무", "workTypeId": owner.task_type_id}, "payload": {"note": "n"}}, headers=owner.headers)
    assert (response.status_code, response.json()["field"]) == (422, "payload")
    assert await _count(db_session, Task, Task.account_id == owner.id) == tasks_before

    response = await client.post(path, json={"agendaId": agenda["id"], "kind": "task", "newTask": {"title": "칩 업무", "workTypeId": owner.task_type_id, "dueDate": "2026-09-05"}}, headers=owner.headers)
    assert response.status_code == 201, response.text
    item = response.json()
    assert (item["track"], item["agendaId"], item["kind"], item["content"], item["orderIndex"], item["payload"]) == ("merged", agenda["id"], "task", "칩 업무", len(agenda["lines"]), None)
    assert (item["task"]["status"], item["task"]["dueDate"], item["task"]["isDeleted"]) == ("todo", "2026-09-05", False)
    task = (await client.get(f"{TASKS}/{item['taskId']}", headers=owner.headers)).json()
    assert [log["text"] for log in task["logs"]] == ["업무 생성"]
    assert await _count(db_session, Task, Task.account_id == owner.id) == tasks_before + 1


# --- 정적 검사 3종 — 완료 게이트 우회 0건 (WORK-005 L147 · L294 · WP Phase 5 검증) ---------------------------------


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
    """③ 전이 그래프 · 완료 조건 판정(결과자료 · 완료 결과)이 `meeting_*` 에 0건 — `task_service` 를 부르는 파일은 link 서비스 하나다."""
    services = _meeting_services()
    for name, code in services.items():
        for banned in ("_TRANSITIONS", "count_deliverables", "completion_result", "deliverable", "TaskStatus.DONE", '"done"', "\"in_progress\"", "sync_actuals"):
            assert banned not in code, (name, banned)
        assert not re.search(r"\.status\s*=(?!=)", code.replace("meeting.status", "").replace("MeetingStatus", "")), name
    users = sorted(name for name, code in services.items() if "task_service" in code)
    assert users == ["meeting_task_link_service.py"], users
    link = services["meeting_task_link_service.py"]
    # 판정 함수는 **그대로** 부른다 — 회의록 갈래 전용 인자 · 우회 플래그가 없다
    assert "task_service.change_status(" in link and "task_service.create_task(" in link
    assert "task_service.update_task(" in link and "task_service.add_memo(" in link
    for banned in ("task_repository", "task_child_repository", "update_fields", "create_log", "create_memo"):
        assert banned not in link, banned
