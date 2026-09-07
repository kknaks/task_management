"""WORK-008 Phase 2 — 종료 후 편집 표면. 트랙 규칙 · 상태 잠금 · **삭제 경계 셋(M-20)의 DB 전후 비교**.

정본: SPEC-008 §4(`PATCH`·`DELETE …/lines/{id}` · `POST …/lines` 확장 · `PATCH …/agendas/{id}` `ended` 갈래 · Validation · Case Matrix) ·
DEC-003 §1 표 L44 · ERD M-5-d · M-5-e · M-20.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from dto.enums import PAYLOAD_STATUSES
from models.meeting import Meeting, MeetingLine, MeetingTranscript
from models.task import Task, TaskLog, TaskMemo
from schemas.meeting import TaskLinePayload, TaskUpdateBody
from tests.fakes.agent import FakeAgentGateway
from tests.meeting_close_fixtures import (  # noqa: F401
    close_scope,
    fake_async_stt,
    end_meeting,
    notes_output,
    finalize_successfully,
    finalize_with_failure,
    prepare_recording,
    rows_by_track,
    run_job,
)
from tests.meeting_fixtures import BASE, MeetingOwner, owner, stranger  # noqa: F401
from tests.meeting_live_fixtures import add_task, start_meeting

pytestmark = pytest.mark.usefixtures("close_scope", "fake_async_stt")


def _lines(body: dict, track: str) -> list[dict]:
    return [line for agenda in body["agendas"][track] for line in agenda["lines"]]


async def _count(session: AsyncSession, model, *where) -> int:  # type: ignore[no-untyped-def]
    return await session.scalar(select(func.count()).select_from(model).where(*where)) or 0


# --- 트랙 규칙 · 상태 잠금 ------------------------------------------------------------------


async def test_in_succeeded_only_merged_lines_are_editable(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    body, _ = await finalize_successfully(client, owner, db_session, fake_agent)
    merged, human, ai = _lines(body, "merged")[0], _lines(body, "human")[0], _lines(body, "ai")[0]

    ok = await client.patch(f"{BASE}/{body['id']}/lines/{merged['id']}", json={"content": "고친 본문"}, headers=owner.headers)
    assert ok.status_code == 200, ok.text
    assert set(ok.json()) == set(body)  # 응답은 MeetingDetail 전체 — 같은 빌더
    assert _lines(ok.json(), "merged")[0]["content"] == "고친 본문"
    assert _lines(ok.json(), "human")[0]["content"] == human["content"]  # 원본은 그대로

    for line in (human, ai):
        response = await client.patch(f"{BASE}/{body['id']}/lines/{line['id']}", json={"content": "x"}, headers=owner.headers)
        assert (response.status_code, response.json()["code"]) == (422, "validation_error"), line["track"]


async def test_in_failed_only_human_lines_are_editable(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    body, _ = await finalize_with_failure(client, owner, db_session, fake_agent)
    human, ai = _lines(body, "human")[0], _lines(body, "ai")[0]
    ok = await client.patch(f"{BASE}/{body['id']}/lines/{human['id']}", json={"content": "실패 상태에서 고친 원본"}, headers=owner.headers)
    assert ok.status_code == 200, ok.text
    assert _lines(ok.json(), "human")[0]["content"] == "실패 상태에서 고친 원본"
    assert (await client.patch(f"{BASE}/{body['id']}/lines/{ai['id']}", json={"content": "x"}, headers=owner.headers)).status_code == 422
    assert (await client.delete(f"{BASE}/{body['id']}/lines/{ai['id']}", headers=owner.headers)).status_code == 422


async def test_any_line_write_during_generating_is_409(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession
) -> None:
    detail = await prepare_recording(client, owner, db_session)
    human = _lines(detail, "human")[0]
    agenda_id = detail["agendas"]["human"][0]["id"]
    await end_meeting(client, owner, detail["id"])  # generating — job 은 돌리지 않는다

    for call in (
        client.patch(f"{BASE}/{detail['id']}/lines/{human['id']}", json={"content": "x"}, headers=owner.headers),
        client.delete(f"{BASE}/{detail['id']}/lines/{human['id']}", headers=owner.headers),
        client.post(f"{BASE}/{detail['id']}/lines", json={"agendaId": agenda_id, "kind": "discussion", "content": "x"}, headers=owner.headers),
        client.patch(f"{BASE}/{detail['id']}/agendas/{agenda_id}", json={"title": "x"}, headers=owner.headers),
    ):
        response = await call
        assert (response.status_code, response.json()["code"]) == (409, "invalid_meeting_status")


async def test_line_write_during_recording_keeps_spec_007_rules(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession
) -> None:
    """회의 중에는 확장 필드(`detail`·`taskId`·`payload`)를 **거부**하고, 편집(PATCH·DELETE)은 409 다.

    `payload`·`taskId` 는 줄 종류가 맞아야 스키마를 지나므로(액션·업무) **그 종류로 보내** service 판정까지 닿게 한다 —
    논의 줄에 실어 보내면 회의 중인지와 무관하게 스키마가 먼저 거른다.
    """
    detail = await start_meeting(client, owner)
    agenda_id = detail["agendas"]["human"][0]["id"]
    for body, field in (
        ({"kind": "discussion", "detail": "x"}, "detail"),
        ({"kind": "task", "taskId": 1}, "taskId"),
        ({"kind": "action", "payload": {"title": "t"}}, "payload"),
    ):
        response = await client.post(f"{BASE}/{detail['id']}/lines", json={"agendaId": agenda_id, "content": "x", **body}, headers=owner.headers)
        assert (response.status_code, response.json()["code"], response.json()["field"]) == (422, "validation_error", field), body
    created = await client.post(f"{BASE}/{detail['id']}/lines", json={"agendaId": agenda_id, "kind": "discussion", "content": "회의 중 줄"}, headers=owner.headers)
    assert created.status_code == 201 and created.json()["track"] == "human"  # LineItem
    assert (await client.patch(f"{BASE}/{detail['id']}/lines/{created.json()['id']}", json={"content": "x"}, headers=owner.headers)).status_code == 409
    assert (await client.delete(f"{BASE}/{detail['id']}/lines/{created.json()['id']}", headers=owner.headers)).status_code == 409


# --- 드로어 「저장」 — `payload` 두 모양 · 업무는 안 바뀐다 (MF-59 · MF-60 · M-14-a) -------------------


async def test_saving_a_payload_changes_nothing_in_my_tasks_and_the_kind_cannot_be_switched(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """편집 모드 「저장」은 **줄에 값을 붙이는 것**이다 — 업무 행 · 로그 · 메모가 하나도 늘지 않는다(M-14-a).

    함께 보는 것 — `payload` 의 모양은 **그 줄의 종류**를 따르고(어긋나면 422), `kind` 는 아예 받지 않는다(MF-60).
    """
    task_id = await add_task(db_session, owner, title="연결된 업무", project_id=owner.project_id)
    detail = await prepare_recording(client, owner, db_session, projectId=owner.project_id)
    fake_agent.will_return(notes_output(detail, task_id=task_id))
    await run_job(await end_meeting(client, owner, detail["id"]))
    body = (await client.get(f"{BASE}/{detail['id']}", headers=owner.headers)).json()
    task_line = next(l for l in _lines(body, "merged") if l["kind"] == "task")
    action_line = next(l for l in _lines(body, "merged") if l["kind"] == "action")
    discussion_line = next(l for l in _lines(body, "merged") if l["kind"] == "discussion")

    before = {
        "tasks": await _count(db_session, Task, Task.account_id == owner.id),
        "logs": await _count(db_session, TaskLog, TaskLog.task_id == task_id),
        "memos": await _count(db_session, TaskMemo, TaskMemo.task_id == task_id),
        "task": await db_session.scalar(select(Task.status, Task.due_date).where(Task.id == task_id)),
    }

    # 업무 줄 — 변경분 일곱 중 여섯 + 헤더 셀렉터의 업무. **`status` 는 `todo`·`in_progress` 만**(MF-59)
    changes = {"dueDate": "2026-09-02", "status": "in_progress", "note": "검수 일정 변경",
               "todos": ["초안 검토"], "relatedTaskIds": [], "completionResult": "검수 통과분 정리"}
    saved = await client.patch(f"{BASE}/{body['id']}/lines/{task_line['id']}", json={"taskId": task_id, "payload": changes}, headers=owner.headers)
    assert saved.status_code == 200, saved.text
    shown = next(l for l in _lines(saved.json(), "merged") if l["id"] == task_line["id"])
    assert (shown["payload"], shown["taskId"], shown["kind"]) == (changes, task_id, "task")

    # 액션 줄 — 생성분. **`workTypeId` 는 `null` 이어도 저장된다**(넣기 때 고른다 — WP OQ-12)
    draft = {"title": "요금제 표 다시 정리", "workTypeId": None, "projectId": None,
             "startDate": None, "dueDate": "2026-09-12", "description": None, "todos": ["표 초안"]}
    saved = await client.patch(f"{BASE}/{body['id']}/lines/{action_line['id']}", json={"payload": draft}, headers=owner.headers)
    assert saved.status_code == 200, saved.text
    shown = next(l for l in _lines(saved.json(), "merged") if l["id"] == action_line["id"])
    assert (shown["payload"], shown["kind"], shown["taskId"]) == (draft, "action", None)

    # **업무 쪽은 하나도 안 움직였다**
    after = {
        "tasks": await _count(db_session, Task, Task.account_id == owner.id),
        "logs": await _count(db_session, TaskLog, TaskLog.task_id == task_id),
        "memos": await _count(db_session, TaskMemo, TaskMemo.task_id == task_id),
        "task": await db_session.scalar(select(Task.status, Task.due_date).where(Task.id == task_id)),
    }
    assert after == before

    # 모양이 줄 종류와 어긋나면 422 · 논의 줄에는 자리 자체가 없다 · `kind` 는 받지 않는다
    path = f"{BASE}/{body['id']}/lines"
    for line_id, bad, field in (
        (action_line["id"], {"payload": {"dueDate": "2026-09-02"}}, "payload"),
        (task_line["id"], {"payload": {"title": "생성분"}}, "payload"),
        (discussion_line["id"], {"payload": {"title": "생성분"}}, "payload"),
        (discussion_line["id"], {"taskId": task_id}, "taskId"),
        (action_line["id"], {"taskId": task_id}, "taskId"),
        (task_line["id"], {"kind": "decision"}, "kind"),
    ):
        response = await client.patch(f"{path}/{line_id}", json=bad, headers=owner.headers)
        assert (response.status_code, response.json()["code"], response.json()["field"]) == (422, "validation_error", field), (line_id, bad)

    # `null` 로 비운다 — 저장된 초안을 버리는 길
    emptied = await client.patch(f"{path}/{task_line['id']}", json={"payload": None, "taskId": None}, headers=owner.headers)
    assert emptied.status_code == 200, emptied.text
    shown = next(l for l in _lines(emptied.json(), "merged") if l["id"] == task_line["id"])
    assert (shown["payload"], shown["taskId"], shown["kind"]) == (None, None, "task")
    assert await _count(db_session, Task, Task.account_id == owner.id) == before["tasks"]


async def test_be_12_8c_done_and_cancelled_never_reach_the_task(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """**BE §12 8-c** — 업무 줄의 `status='done'`·`'cancelled'` 는 **스키마 층 422** 이고 `task.status` 가 안 바뀐다(MF-59).

    세 표면을 한 번에 본다 — 줄 추가(`POST …/lines`) · 드로어 「저장」(`PATCH …/lines/{id}`) · 「넣기」(`PATCH …/lines/{id}/task`).
    회의록에는 완료로 가는 문이 없다 — 그래서 완료 게이트(`task_completion_blocked`)가 이 경로에서 날 일 자체가 없다.
    """
    task_id = await add_task(db_session, owner, title="완료로 못 가는 업무", project_id=owner.project_id)
    body, _ = await finalize_successfully(client, owner, db_session, fake_agent)
    agenda_id = body["agendas"]["merged"][0]["id"]
    created = await client.post(f"{BASE}/{body['id']}/lines", json={"agendaId": agenda_id, "kind": "task", "content": "업무 줄", "taskId": task_id}, headers=owner.headers)
    assert created.status_code == 201, created.text
    line_id = created.json()["id"]

    for status in ("done", "cancelled"):
        calls = (
            client.post(f"{BASE}/{body['id']}/lines", json={"agendaId": agenda_id, "kind": "task", "content": "x", "taskId": task_id, "payload": {"status": status}}, headers=owner.headers),
            client.patch(f"{BASE}/{body['id']}/lines/{line_id}", json={"payload": {"status": status}}, headers=owner.headers),
            client.patch(f"{BASE}/{body['id']}/lines/{line_id}/task", json={"taskId": task_id, "status": status}, headers=owner.headers),
        )
        for call in calls:
            response = await call
            assert (response.status_code, response.json()["code"]) == (422, "validation_error"), status
            # 어느 표면이든 **그 필드**를 가리킨다 — 줄 표면은 `payload.status`, 「넣기」 본문은 `status`
            assert response.json()["field"] in ("payload.status", "status"), response.json()

    db_session.expire_all()
    assert await db_session.scalar(select(Task.status).where(Task.id == task_id)) == "todo"
    assert await _count(db_session, TaskLog, TaskLog.task_id == task_id, TaskLog.to_status.is_not(None)) == 0


async def test_line_update_body_validation(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    body, _ = await finalize_successfully(client, owner, db_session, fake_agent)
    line = _lines(body, "merged")[0]
    path = f"{BASE}/{body['id']}/lines/{line['id']}"
    for bad in ({}, {"content": None}, {"content": ""}, {"content": "a\nb"}, {"kind": "decision"}, {"orderIndex": 3}):
        response = await client.patch(path, json=bad, headers=owner.headers)
        assert (response.status_code, response.json()["code"]) == (422, "validation_error"), bad
    assert (await client.patch(f"{BASE}/{body['id']}/lines/999999", json={"content": "x"}, headers=owner.headers)).status_code == 404


def test_the_two_surfaces_share_one_status_set() -> None:
    """`payload.status` 와 「넣기」 본문의 `status` 가 **같은 값 집합**을 쓴다 — 문자열을 두 번 적지 않는다(WP §Internal Interface)."""
    assert set(PAYLOAD_STATUSES) == {"todo", "in_progress"}
    assert TaskLinePayload.model_fields["status"].annotation is TaskUpdateBody.model_fields["status"].annotation


# --- 삭제 경계 셋 (M-20) — DB 전후 비교 ------------------------------------------------------------


async def test_deleting_a_merged_line_leaves_sources_ai_transcript_recording_and_task_untouched(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    task_id = await add_task(db_session, owner, title="연결된 업무", project_id=owner.project_id)
    db_session.add_all([TaskMemo(task_id=task_id, content="메모"), TaskLog(task_id=task_id, content="업무 생성")])
    await db_session.flush()
    detail = await prepare_recording(client, owner, db_session, projectId=owner.project_id)
    await db_session.execute(update(Meeting).where(Meeting.id == detail["id"]).values(recording_path="/rec/meeting.pcm"))
    fake_agent.will_return(notes_output(detail, task_id=task_id))
    await run_job(await end_meeting(client, owner, detail["id"]))
    body = (await client.get(f"{BASE}/{detail['id']}", headers=owner.headers)).json()

    merged = _lines(body, "merged")
    # 계승(`source_*_line_id`)이 사라졌다(MF-56 · 57) — merged 줄은 ② 가 본문째 낸다
    inherited = next(l for l in merged if l["kind"] == "discussion")
    task_line = next(l for l in merged if l["kind"] == "task")
    same_agenda = [l for l in merged if l["agendaId"] == inherited["agendaId"]]
    assert [l["orderIndex"] for l in same_agenda] == list(range(len(same_agenda)))

    # --- 전 ---
    before = {
        "human": await _count(db_session, MeetingLine, MeetingLine.meeting_id == body["id"], MeetingLine.track == "human"),
        "ai": await _count(db_session, MeetingLine, MeetingLine.meeting_id == body["id"], MeetingLine.track == "ai"),
        "transcript": await _count(db_session, MeetingTranscript, MeetingTranscript.meeting_id == body["id"]),
        "recording_path": await db_session.scalar(select(Meeting.recording_path).where(Meeting.id == body["id"])),
        "task": await db_session.scalar(select(Task.status, Task.deleted_at).where(Task.id == task_id)),
        "task_log": await _count(db_session, TaskLog, TaskLog.task_id == task_id),
        "task_memo": await _count(db_session, TaskMemo, TaskMemo.task_id == task_id),
    }
    # 종료 시 배치가 없다(MF-56) — AI 트랙은 회의 중에 생긴 줄 하나뿐이고, 트랜스크립트는 재전사분 둘이다
    assert before["human"] == 3 and before["ai"] == 1 and before["transcript"] == 2
    assert before["task_log"] == 1 and before["task_memo"] == 1

    # --- 삭제 둘: 계승 줄 · 업무 줄 ---
    for line in (inherited, task_line):
        response = await client.delete(f"{BASE}/{body['id']}/lines/{line['id']}", headers=owner.headers)
        assert response.status_code == 204, response.text
        assert response.content == b""
    for line in (inherited, task_line):
        again = await client.delete(f"{BASE}/{body['id']}/lines/{line['id']}", headers=owner.headers)
        assert (again.status_code, again.json()["code"]) == (404, "not_found")  # 멱등이 아니다

    # --- 후 ---
    after = {
        "human": await _count(db_session, MeetingLine, MeetingLine.meeting_id == body["id"], MeetingLine.track == "human"),
        "ai": await _count(db_session, MeetingLine, MeetingLine.meeting_id == body["id"], MeetingLine.track == "ai"),
        "transcript": await _count(db_session, MeetingTranscript, MeetingTranscript.meeting_id == body["id"]),
        "recording_path": await db_session.scalar(select(Meeting.recording_path).where(Meeting.id == body["id"])),
        "task": await db_session.scalar(select(Task.status, Task.deleted_at).where(Task.id == task_id)),
        "task_log": await _count(db_session, TaskLog, TaskLog.task_id == task_id),
        "task_memo": await _count(db_session, TaskMemo, TaskMemo.task_id == task_id),
    }
    assert after == before, {k: (before[k], after[k]) for k in before if before[k] != after[k]}

    remaining = (await client.get(f"{BASE}/{body['id']}", headers=owner.headers)).json()
    merged_after = _lines(remaining, "merged")
    assert len(merged_after) == len(merged) - 2
    assert {l["id"] for l in merged_after}.isdisjoint({inherited["id"], task_line["id"]})
    kept = [l for l in merged_after if l["agendaId"] == inherited["agendaId"]]
    # **자리는 그대로다**(MF-36) — 지운 번호가 구멍으로 남고 뒤 줄은 제 번호를 지킨다
    assert [l["orderIndex"] for l in kept] == [
        l["orderIndex"] for l in same_agenda if l["id"] not in {inherited["id"], task_line["id"]}
    ]
    # 지운 둘 중 하나가 업무 줄이다 — 카운트가 다섯으로 갈려 `taskCount` 가 줄어든다(WORK-012)
    assert remaining["mergedSummary"]["taskCount"] == body["mergedSummary"]["taskCount"] - 1
    # AI 탭 · 근거 칩 원천은 그대로다
    assert _lines(remaining, "ai") == _lines(body, "ai")
    assert _lines(remaining, "human") == _lines(body, "human")


async def test_deleting_a_human_line_in_failed_state_leaves_ai_untouched(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    body, _ = await finalize_with_failure(client, owner, db_session, fake_agent)
    first_agenda_lines = body["agendas"]["human"][0]["lines"]
    a, b = first_agenda_lines
    assert (await client.delete(f"{BASE}/{body['id']}/lines/{a['id']}", headers=owner.headers)).status_code == 204
    after = (await client.get(f"{BASE}/{body['id']}", headers=owner.headers)).json()
    # 0 번을 지웠어도 **1 번은 1 번으로 남는다**(MF-36)
    assert [(l["id"], l["orderIndex"]) for l in after["agendas"]["human"][0]["lines"]] == [(b["id"], b["orderIndex"])]
    assert _lines(after, "ai") == _lines(body, "ai")


async def test_strangers_lines_are_404(
    client: AsyncClient, owner: MeetingOwner, stranger: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    body, _ = await finalize_successfully(client, owner, db_session, fake_agent)
    line = _lines(body, "merged")[0]
    assert (await client.delete(f"{BASE}/{body['id']}/lines/{line['id']}", headers=stranger.headers)).status_code == 404
    assert (await client.patch(f"{BASE}/{body['id']}/lines/{line['id']}", json={"content": "x"}, headers=stranger.headers)).status_code == 404


# --- 줄 추가 (`POST …/lines` 확장 갈래) --------------------------------------------------------------


async def test_adding_lines_after_the_meeting_ended(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """네 종류 모두 **`content` 필수**이고, 액션·업무 칩은 **줄과 `payload` 를 한 요청**으로 만든다(MF-64 정정).

    **업무는 생기지 않는다** — 칩으로 들어와도 이 표면은 `task_service` 를 부르지 않는다.
    """
    task_id = await add_task(db_session, owner, title="연관 업무 제목", project_id=None)
    body, _ = await finalize_successfully(client, owner, db_session, fake_agent)
    merged_agenda = body["agendas"]["merged"][1]
    human_agenda = body["agendas"]["human"][1]
    path = f"{BASE}/{body['id']}/lines"
    tasks_before = await _count(db_session, Task, Task.account_id == owner.id)

    # U-8 — 논의 · 결정 + detail
    added = await client.post(path, json={"agendaId": merged_agenda["id"], "kind": "decision", "content": "종료 후 결정", "detail": "상세"}, headers=owner.headers)
    assert added.status_code == 201, added.text
    item = added.json()
    assert (item["track"], item["kind"], item["content"], item["detail"], item["orderIndex"]) == ("merged", "decision", "종료 후 결정", "상세", len(merged_agenda["lines"]))
    assert (item["evidence"], item["payload"], item["taskId"]) == ([], None, None)

    # U-9 칩 진입 — 줄 + `taskId` + `payload` 한 요청. **본문은 사람이 적은 것**이라 업무 제목으로 덮이지 않는다
    linked = await client.post(path, json={"agendaId": merged_agenda["id"], "kind": "task", "content": "소개서 v2 문구 정리 — 기한 미루기",
                                            "taskId": task_id, "payload": {"dueDate": "2026-09-02", "note": "검수 일정 변경"}}, headers=owner.headers)
    assert linked.status_code == 201, linked.text
    assert (linked.json()["content"], linked.json()["taskId"], linked.json()["task"]["title"]) == ("소개서 v2 문구 정리 — 기한 미루기", task_id, "연관 업무 제목")
    assert linked.json()["payload"] == {"dueDate": "2026-09-02", "note": "검수 일정 변경"}

    # U-10 칩 진입 — 액션 줄 + 생성분(`workTypeId` 는 `null` 이어도 저장된다)
    drafted = await client.post(path, json={"agendaId": merged_agenda["id"], "kind": "action", "content": "요금제 표 다시 정리",
                                             "payload": {"title": "요금제 표 다시 정리", "workTypeId": None, "todos": ["표 초안"]}}, headers=owner.headers)
    assert drafted.status_code == 201, drafted.text
    assert drafted.json()["payload"] == {"title": "요금제 표 다시 정리", "workTypeId": None, "projectId": None,
                                          "startDate": None, "dueDate": None, "description": None, "todos": ["표 초안"]}
    assert (drafted.json()["kind"], drafted.json()["taskId"]) == ("action", None)

    # **줄 셋을 만드는 동안 내 업무는 한 건도 늘지 않았다**
    assert await _count(db_session, Task, Task.account_id == owner.id) == tasks_before

    # 검증 — 편집 대상 트랙 밖 안건 · `content` 없음 · 논의·결정의 업무 필드 · 종류에 안 맞는 payload 모양 ·
    #        업무 줄 아닌 곳의 `taskId` · 줄과 업무를 함께 만드는 옛 필드 · 삭제된/남의 업무
    cases = [
        ({"agendaId": human_agenda["id"], "kind": "discussion", "content": "x"}, 422, "agendaId"),
        ({"agendaId": merged_agenda["id"], "kind": "discussion"}, 422, "content"),
        ({"agendaId": merged_agenda["id"], "kind": "discussion", "content": "x", "payload": {"title": "t"}}, 422, "payload"),
        ({"agendaId": merged_agenda["id"], "kind": "decision", "content": "x", "taskId": task_id}, 422, "taskId"),
        ({"agendaId": merged_agenda["id"], "kind": "action", "content": "x", "taskId": task_id}, 422, "taskId"),
        ({"agendaId": merged_agenda["id"], "kind": "action", "content": "x", "payload": {"dueDate": "2026-09-02"}}, 422, "payload.title"),
        ({"agendaId": merged_agenda["id"], "kind": "task", "content": "x", "taskId": task_id, "payload": {"title": "t"}}, 422, "payload.title"),
        ({"agendaId": merged_agenda["id"], "kind": "task", "content": "x", "taskId": task_id, "payload": {"priority": 1}}, 422, "payload.priority"),
        ({"agendaId": merged_agenda["id"], "kind": "task", "content": "x", "newTask": {"title": "t", "workTypeId": owner.task_type_id}}, 422, "newTask"),
        ({"agendaId": merged_agenda["id"], "kind": "task", "content": "x", "taskId": 999999}, 404, None),
    ]
    for payload, status, field in cases:
        response = await client.post(path, json=payload, headers=owner.headers)
        assert response.status_code == status, (payload, response.text)
        if status == 422:
            assert response.json()["field"] == field, (payload, response.json())
    assert await _count(db_session, Task, Task.account_id == owner.id) == tasks_before


async def test_be_12_8b_a_deleted_place_stays_empty_and_new_lines_go_to_the_last_plus_one(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """**BE §12 8-b** — `orderIndex` 3 을 지우면 4 가 3 으로 **당겨지지 않고**, 새 줄은 **마지막 + 1** 이다(MF-36).

    구멍이 있어도 번호가 겹치지 않는다는 것까지 본다 — 화면은 번호순으로 그린다.
    """
    body, _ = await finalize_successfully(client, owner, db_session, fake_agent)
    agenda = body["agendas"]["merged"][1]
    path = f"{BASE}/{body['id']}/lines"

    for index in range(5 - len(agenda["lines"])):
        response = await client.post(path, json={"agendaId": agenda["id"], "kind": "discussion", "content": f"채우는 줄 {index}"}, headers=owner.headers)
        assert response.status_code == 201, response.text
    lines = [l for l in _lines((await client.get(f"{BASE}/{body['id']}", headers=owner.headers)).json(), "merged") if l["agendaId"] == agenda["id"]]
    assert [l["orderIndex"] for l in lines] == [0, 1, 2, 3, 4]

    assert (await client.delete(f"{path}/{lines[3]['id']}", headers=owner.headers)).status_code == 204
    after = [l for l in _lines((await client.get(f"{BASE}/{body['id']}", headers=owner.headers)).json(), "merged") if l["agendaId"] == agenda["id"]]
    assert [l["orderIndex"] for l in after] == [0, 1, 2, 4]  # 4 는 4 로 남는다

    appended = await client.post(path, json={"agendaId": agenda["id"], "kind": "discussion", "content": "구멍 뒤에 붙는 줄"}, headers=owner.headers)
    assert (appended.status_code, appended.json()["orderIndex"]) == (201, 5)  # 마지막 + 1 — 구멍(3)을 메우지 않는다


# --- 안건 이름 (`PATCH …/agendas/{id}` ended 갈래) ----------------------------------------------------------


async def test_agenda_title_after_the_meeting_ended(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    body, _ = await finalize_successfully(client, owner, db_session, fake_agent)
    merged_agenda = body["agendas"]["merged"][2]  # AI 신설 안건도 merged 안건이라 이름을 고칠 수 있다
    human_agenda, ai_agenda = body["agendas"]["human"][0], body["agendas"]["ai"][0]
    base = f"{BASE}/{body['id']}/agendas"

    renamed = await client.patch(f"{base}/{merged_agenda['id']}", json={"title": "디자인 반영 일정"}, headers=owner.headers)
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["agendas"]["merged"][2]["title"] == "디자인 반영 일정"
    assert renamed.json()["agendas"]["ai"][0]["title"] == ai_agenda["title"]  # AI 원본 안건 제목은 그대로

    with_state = await client.patch(f"{base}/{merged_agenda['id']}", json={"title": "x", "state": "done"}, headers=owner.headers)
    assert (with_state.status_code, with_state.json()["code"], with_state.json()["field"]) == (422, "validation_error", "state")
    assert (await client.patch(f"{base}/{merged_agenda['id']}", json={"state": "done"}, headers=owner.headers)).status_code == 422
    for other in (human_agenda, ai_agenda):
        assert (await client.patch(f"{base}/{other['id']}", json={"title": "x"}, headers=owner.headers)).status_code == 422
    assert (await client.patch(f"{base}/999999", json={"title": "x"}, headers=owner.headers)).status_code == 404

    # 종료 후 안건 추가 · 삭제는 없다
    assert (await client.post(base, json={"title": "새 안건"}, headers=owner.headers)).status_code == 409
    assert (await client.delete(f"{base}/{merged_agenda['id']}", headers=owner.headers)).status_code == 409
    assert (await client.delete(f"{base}/{human_agenda['id']}", headers=owner.headers)).status_code == 409


async def test_agenda_title_in_failed_state_targets_the_human_track(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    body, _ = await finalize_with_failure(client, owner, db_session, fake_agent)
    human_agenda, ai_agenda = body["agendas"]["human"][0], body["agendas"]["ai"][0]
    ok = await client.patch(f"{BASE}/{body['id']}/agendas/{human_agenda['id']}", json={"title": "원본 안건 이름"}, headers=owner.headers)
    assert ok.status_code == 200 and ok.json()["agendas"]["human"][0]["title"] == "원본 안건 이름"
    assert (await client.patch(f"{BASE}/{body['id']}/agendas/{ai_agenda['id']}", json={"title": "x"}, headers=owner.headers)).status_code == 422


async def test_agenda_title_during_recording_is_still_rejected(
    client: AsyncClient, owner: MeetingOwner
) -> None:
    detail = await start_meeting(client, owner)
    response = await client.patch(f"{BASE}/{detail['id']}/agendas/{detail['agendas']['human'][0]['id']}", json={"title": "x"}, headers=owner.headers)
    assert (response.status_code, response.json()["code"]) == (409, "invalid_meeting_status")


# --- 정적 검사 (WP Phase 2) --------------------------------------------------------------------

BACK = Path(__file__).resolve().parents[1]


def _code_only(text: str) -> str:
    """docstring·주석은 코드가 아니다 — 정적 검사는 코드 줄만 본다."""
    without_docstrings = re.sub(r'"""[\s\S]*?"""', "", text)
    return "\n".join(line for line in without_docstrings.splitlines() if not line.strip().startswith("#"))


def test_static_track_rule_lives_in_one_function_and_delete_path_touches_nothing_else() -> None:
    edit = _code_only((BACK / "service" / "meeting_edit_service.py").read_text(encoding="utf-8"))
    assert edit.count("def editable_track(") == 1
    # 트랙을 판정하는 코드(`succeeded` → `merged`)가 서비스 층에서 이 함수 밖에 없다
    deciders = []
    for path in sorted((BACK / "service").glob("*.py")) + sorted((BACK / "api").glob("*.py")):
        text = path.read_text(encoding="utf-8")
        if re.search(r"IntegrationState\.SUCCEEDED\.value.*\n\s+return MeetingTrack\.MERGED\.value", text):
            deciders.append(path.name)
    assert deciders == ["meeting_edit_service.py"], deciders
    # 삭제 경로 — task_service · 트랜스크립트 · storage 를 import/호출하는 코드 0건
    for banned in ("task_service", "meeting_transcript_repository", "storage", "integrations", "recording_path", "TaskLog", "TaskMemo"):
        assert banned not in edit, banned
    line_repo = _code_only((BACK / "repository" / "meeting_line_repository.py").read_text(encoding="utf-8"))
    for banned in ("Task)", "MeetingTranscript", "recording_path", "Meeting."):
        assert banned not in line_repo.replace("MeetingLine.", ""), banned
    assert "except Exception" not in edit
    # 삭제는 **DELETE 한 문장**이다 — 뒤 줄 `order_index` 를 고치는 UPDATE 가 없다(MF-36 · BE §12 8-b)
    delete_body = re.search(r"async def delete_line\([\s\S]*?(?=\nasync def |\Z)", line_repo)
    assert delete_body is not None
    assert "order_index" not in delete_body.group(0) and "update(" not in delete_body.group(0)


def test_static_the_retired_words_are_gone_from_the_backend() -> None:
    """WP Phase 1 정적 검사 — 줄과 업무를 함께 만들던 필드와 옛 `payload` 이름이 **실행 코드에 없다**.

    남아 있으면 프론트가 옛 계약을 계속 부를 수 있다(스키마가 `extra="forbid"` 라 422 로 떨어질 뿐, 이유가 안 보인다).
    제외 규칙은 `test_meeting_finalize.py` 의 같은 성격 검사와 맞춘다 — `tests/` 와 옛 리비전은 그 시점의 이름을 적는다.
    """
    needles = ("new" + "Task", "new" + "_task", "pending" + "Change", "Pending" + "Change")
    offenders = [
        f"{path.relative_to(BACK)}:{number}"
        for path in sorted(BACK.rglob("*.py"))
        if not ({".venv", "tests"} & set(path.parts)) and not path.name.startswith("000")
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1)
        if any(needle in line for needle in needles)
    ]
    assert offenders == [], offenders
