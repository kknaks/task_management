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

from models.meeting import Meeting, MeetingLine, MeetingTranscript
from models.task import Task, TaskLog, TaskMemo
from tests.fakes.agent import FakeAgentGateway
from tests.meeting_close_fixtures import (  # noqa: F401
    answer,
    close_scope,
    end_meeting,
    final_output,
    finalize_successfully,
    finalize_with_failure,
    prepare_recording,
    rows_by_track,
    run_job,
)
from tests.meeting_fixtures import BASE, MeetingOwner, owner, stranger  # noqa: F401
from tests.meeting_live_fixtures import add_task, start_meeting

pytestmark = pytest.mark.usefixtures("close_scope")


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
    """회의 중에는 확장 필드(`detail`·`taskId`·`pendingChange`·`newTask`)를 **거부**하고, 편집(PATCH·DELETE)은 409 다."""
    detail = await start_meeting(client, owner)
    agenda_id = detail["agendas"]["human"][0]["id"]
    for extra, field in (({"detail": "x"}, "detail"), ({"taskId": 1}, "taskId"), ({"pendingChange": {"note": "n"}}, "pendingChange"),
                         ({"newTask": {"title": "t", "workTypeId": owner.task_type_id}}, "newTask")):
        response = await client.post(f"{BASE}/{detail['id']}/lines", json={"agendaId": agenda_id, "kind": "discussion", "content": "x", **extra}, headers=owner.headers)
        assert (response.status_code, response.json()["code"], response.json()["field"]) == (422, "validation_error", field), extra
    created = await client.post(f"{BASE}/{detail['id']}/lines", json={"agendaId": agenda_id, "kind": "discussion", "content": "회의 중 줄"}, headers=owner.headers)
    assert created.status_code == 201 and created.json()["track"] == "human"  # LineItem
    assert (await client.patch(f"{BASE}/{detail['id']}/lines/{created.json()['id']}", json={"content": "x"}, headers=owner.headers)).status_code == 409
    assert (await client.delete(f"{BASE}/{detail['id']}/lines/{created.json()['id']}", headers=owner.headers)).status_code == 409


# --- 종류 전환 ----------------------------------------------------------------------


async def test_leaving_task_kind_unlinks_the_task_but_keeps_it_and_entering_needs_a_task(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    task_id = await add_task(db_session, owner, title="연결된 업무", project_id=owner.project_id)
    detail = await prepare_recording(client, owner, db_session, projectId=owner.project_id)
    fake_agent.will_return(final_output(detail, task_id=task_id))
    fake_agent.will_answer(answer())
    await run_job(await end_meeting(client, owner, detail["id"]))
    body = (await client.get(f"{BASE}/{detail['id']}", headers=owner.headers)).json()
    task_line = next(l for l in _lines(body, "merged") if l["kind"] == "task")
    assert task_line["taskId"] == task_id and task_line["task"]["title"] == "연결된 업무"
    await db_session.execute(update(MeetingLine).where(MeetingLine.id == task_line["id"]).values(pending_change={"note": "메모"}))

    response = await client.patch(f"{BASE}/{body['id']}/lines/{task_line['id']}", json={"kind": "decision"}, headers=owner.headers)
    assert response.status_code == 200, response.text
    changed = next(l for l in _lines(response.json(), "merged") if l["id"] == task_line["id"])
    assert (changed["kind"], changed["taskId"], changed["pendingChange"], changed["task"]) == ("decision", None, None, None)
    assert await db_session.scalar(select(Task.deleted_at).where(Task.id == task_id)) is None  # 업무 행은 그대로
    assert response.json()["mergedSummary"]["decisionCount"] == body["mergedSummary"]["decisionCount"] + 1
    assert response.json()["mergedSummary"]["actionCount"] == body["mergedSummary"]["actionCount"] - 1

    back = await client.patch(f"{BASE}/{body['id']}/lines/{task_line['id']}", json={"kind": "task"}, headers=owner.headers)
    assert (back.status_code, back.json()["code"], back.json()["field"]) == (422, "validation_error", "kind")


async def test_line_update_body_validation(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    body, _ = await finalize_successfully(client, owner, db_session, fake_agent)
    line = _lines(body, "merged")[0]
    path = f"{BASE}/{body['id']}/lines/{line['id']}"
    for bad in ({}, {"content": None}, {"content": ""}, {"content": "a\nb"}, {"kind": "memo"}, {"orderIndex": 3}):
        response = await client.patch(path, json=bad, headers=owner.headers)
        assert (response.status_code, response.json()["code"]) == (422, "validation_error"), bad
    assert (await client.patch(f"{BASE}/{body['id']}/lines/999999", json={"content": "x"}, headers=owner.headers)).status_code == 404


# --- 삭제 경계 셋 (M-20) — DB 전후 비교 ------------------------------------------------------------


async def test_deleting_a_merged_line_leaves_sources_ai_transcript_recording_and_task_untouched(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    task_id = await add_task(db_session, owner, title="연결된 업무", project_id=owner.project_id)
    db_session.add_all([TaskMemo(task_id=task_id, content="메모"), TaskLog(task_id=task_id, content="업무 생성")])
    await db_session.flush()
    detail = await prepare_recording(client, owner, db_session, projectId=owner.project_id)
    await db_session.execute(update(Meeting).where(Meeting.id == detail["id"]).values(recording_path="/rec/meeting.pcm"))
    fake_agent.will_return(final_output(detail, task_id=task_id))
    fake_agent.will_answer(answer())
    await run_job(await end_meeting(client, owner, detail["id"]))
    body = (await client.get(f"{BASE}/{detail['id']}", headers=owner.headers)).json()

    merged = _lines(body, "merged")
    inherited = next(l for l in merged if l["sourceHumanLineId"] and l["sourceAiLineId"])
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
        "source_human": await db_session.scalar(select(MeetingLine.content).where(MeetingLine.id == inherited["sourceHumanLineId"])),
        "source_ai": await db_session.scalar(select(MeetingLine.evidence).where(MeetingLine.id == inherited["sourceAiLineId"])),
    }
    assert before["human"] == 3 and before["ai"] == 4 and before["transcript"] == 1
    assert before["task_log"] == 1 and before["task_memo"] == 1 and before["source_ai"]

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
        "source_human": await db_session.scalar(select(MeetingLine.content).where(MeetingLine.id == inherited["sourceHumanLineId"])),
        "source_ai": await db_session.scalar(select(MeetingLine.evidence).where(MeetingLine.id == inherited["sourceAiLineId"])),
    }
    assert after == before, {k: (before[k], after[k]) for k in before if before[k] != after[k]}

    remaining = (await client.get(f"{BASE}/{body['id']}", headers=owner.headers)).json()
    merged_after = _lines(remaining, "merged")
    assert len(merged_after) == len(merged) - 2
    assert {l["id"] for l in merged_after}.isdisjoint({inherited["id"], task_line["id"]})
    kept = [l for l in merged_after if l["agendaId"] == inherited["agendaId"]]
    assert [l["orderIndex"] for l in kept] == list(range(len(kept)))  # 뒤 줄이 당겨졌다
    assert remaining["mergedSummary"]["actionCount"] == body["mergedSummary"]["actionCount"] - 1
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
    assert [(l["id"], l["orderIndex"]) for l in after["agendas"]["human"][0]["lines"]] == [(b["id"], 0)]
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
    task_id = await add_task(db_session, owner, title="연관 업무 제목", project_id=None)
    body, _ = await finalize_successfully(client, owner, db_session, fake_agent)
    merged_agenda = body["agendas"]["merged"][1]
    human_agenda = body["agendas"]["human"][1]
    path = f"{BASE}/{body['id']}/lines"

    # U-8 — 논의 · 결정 + detail
    added = await client.post(path, json={"agendaId": merged_agenda["id"], "kind": "decision", "content": "종료 후 결정", "detail": "상세"}, headers=owner.headers)
    assert added.status_code == 201, added.text
    item = added.json()
    assert (item["track"], item["kind"], item["content"], item["detail"], item["orderIndex"]) == ("merged", "decision", "종료 후 결정", "상세", len(merged_agenda["lines"]))
    assert (item["sourceHumanLineId"], item["sourceAiLineId"], item["evidence"]) == (None, None, [])

    # U-9 — taskId + pendingChange · content 는 서버가 업무 제목으로
    linked = await client.post(path, json={"agendaId": merged_agenda["id"], "kind": "task", "taskId": task_id,
                                            "pendingChange": {"dueDate": "2026-09-02", "note": "검수 일정 변경"}}, headers=owner.headers)
    assert linked.status_code == 201, linked.text
    assert (linked.json()["content"], linked.json()["taskId"], linked.json()["task"]["title"]) == ("연관 업무 제목", task_id, "연관 업무 제목")
    assert linked.json()["pendingChange"] == {"dueDate": "2026-09-02", "note": "검수 일정 변경"}

    # U-10 — newTask 는 Phase 5 · 지금은 501 스텁(줄이 생기지 않는다)
    count_before = await _count(db_session, MeetingLine, MeetingLine.meeting_id == body["id"])
    stub = await client.post(path, json={"agendaId": merged_agenda["id"], "kind": "task", "newTask": {"title": "새 업무", "workTypeId": owner.task_type_id}}, headers=owner.headers)
    assert (stub.status_code, stub.json()["code"]) == (501, "not_implemented")
    assert await _count(db_session, MeetingLine, MeetingLine.meeting_id == body["id"]) == count_before

    # 검증 — 편집 대상 트랙 밖 안건 · task 인데 둘 다/둘 다 없음 · 비업무 줄의 업무 필드 · content 없음 · cancelled · 넷째 키 · 삭제된/남의 업무
    cases = [
        ({"agendaId": human_agenda["id"], "kind": "discussion", "content": "x"}, 422, "agendaId"),
        ({"agendaId": merged_agenda["id"], "kind": "task", "content": "x"}, 422, "taskId"),
        ({"agendaId": merged_agenda["id"], "kind": "task", "taskId": task_id, "newTask": {"title": "t", "workTypeId": owner.task_type_id}}, 422, "taskId"),
        ({"agendaId": merged_agenda["id"], "kind": "discussion", "content": "x", "taskId": task_id}, 422, "taskId"),
        ({"agendaId": merged_agenda["id"], "kind": "discussion"}, 422, "content"),
        ({"agendaId": merged_agenda["id"], "kind": "task", "taskId": task_id, "pendingChange": {"status": "cancelled"}}, 422, "pendingChange.status"),
        ({"agendaId": merged_agenda["id"], "kind": "task", "taskId": task_id, "pendingChange": {"priority": 1}}, 422, "pendingChange.priority"),
        ({"agendaId": merged_agenda["id"], "kind": "task", "taskId": task_id, "pendingChange": {}}, 422, "pendingChange"),
        ({"agendaId": merged_agenda["id"], "kind": "task", "taskId": 999999}, 404, None),
    ]
    for payload, status, field in cases:
        response = await client.post(path, json=payload, headers=owner.headers)
        assert response.status_code == status, (payload, response.text)
        if status == 422:
            assert response.json()["field"] == field, (payload, response.json())


# --- 안건 이름 (`PATCH …/agendas/{id}` ended 갈래) ----------------------------------------------------------


async def test_agenda_title_after_the_meeting_ended(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    body, _ = await finalize_successfully(client, owner, db_session, fake_agent)
    merged_agenda = body["agendas"]["merged"][2]  # AI 신설 안건도 merged 안건이라 이름을 고칠 수 있다
    human_agenda, ai_agenda = body["agendas"]["human"][0], body["agendas"]["ai"][1]
    base = f"{BASE}/{body['id']}/agendas"

    renamed = await client.patch(f"{base}/{merged_agenda['id']}", json={"title": "디자인 반영 일정"}, headers=owner.headers)
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["agendas"]["merged"][2]["title"] == "디자인 반영 일정"
    assert renamed.json()["agendas"]["ai"][1]["title"] == ai_agenda["title"]  # AI 원본 안건 제목은 그대로

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
