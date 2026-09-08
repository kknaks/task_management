"""WORK-007 Phase 1·2 — 스키마 대조 · env · `/start` 웜스타트 · REST 3표면 · `validation_error.field`.

정본: SPEC-007 §4(Request/Response · Validation · Case Matrix) · WP Phase 1·2 검증 항목.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from config import MissingEnvError, get_settings
from core.db import run_after_commit_hooks
from dto.enums import AgendaState, MeetingTrack
from models.account import WorkType
from models.meeting import Meeting, MeetingAgenda, MeetingLine
from service import meeting_batch_service, meeting_service
from tests.fakes.agent import WARM_SESSION_ID
from tests.meeting_fixtures import (  # noqa: F401
    BASE,
    MeetingOwner,
    create_meeting,
    get_detail,
    owner,
    stranger,
)
from tests.meeting_live_fixtures import (  # noqa: F401
    ScheduleRecorder,
    add_ai_agenda,
    add_block,
    add_task,
    live_scope,
    schedule_calls,
    start_meeting,
)

# --- Phase 1 — 스키마 · env ---------------------------------------------------------


async def test_two_active_human_agendas_are_rejected_by_partial_unique(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession
) -> None:
    """`uq_meeting_agenda_human_active` — 0005 리비전이 이미 만든 부분 UNIQUE 가 최종 방어선이다(M-5-c)."""
    created = await create_meeting(client, owner, agendas=[{"title": "A"}, {"title": "B"}])
    ids = [agenda["id"] for agenda in created["agendas"]["human"]]
    rows = (await db_session.scalars(select(MeetingAgenda).where(MeetingAgenda.id.in_(ids)))).all()
    for row in rows:
        row.state = AgendaState.ACTIVE.value
    with pytest.raises(IntegrityError):
        await db_session.flush()


def test_missing_soniox_key_fails_startup(monkeypatch: pytest.MonkeyPatch) -> None:
    """`SONIOX_API_KEY` 가 비면 기동 실패(BE §11 — 비밀값에 기본값을 두지 않는다)."""
    monkeypatch.setenv("SONIOX_API_KEY", "")
    get_settings.cache_clear()
    try:
        with pytest.raises(MissingEnvError, match="SONIOX_API_KEY"):
            get_settings()
    finally:
        get_settings.cache_clear()


def test_batch_numbers_match_dec_003(monkeypatch: pytest.MonkeyPatch) -> None:
    """수치 5종이 env 로 빠져 있고 기본값이 DEC-003 §STT L164(배치 글자 수는 MF-49 로 개정) 과 같다."""
    settings = get_settings()
    assert (
        settings.meeting_batch_chars,
        settings.meeting_batch_switch_min_chars,
        settings.meeting_batch_max_wait_sec,
        settings.meeting_batch_timeout_sec,
        settings.meeting_batch_sessions_per_meeting,
    ) == (1000, 80, 180, 120, 1)  # MF-49 — 2026-09-07 600 → 1000

    monkeypatch.setenv("MEETING_BATCH_CHARS", "700")
    get_settings.cache_clear()
    try:
        assert get_settings().meeting_batch_chars == 700
    finally:
        get_settings.cache_clear()


# --- Phase 2 — `/start` 웜스타트 ------------------------------------------------------


async def test_start_is_a_transition_only_and_does_not_wait_for_the_warm_start(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, live_scope: None
) -> None:
    """WORK-010(MF-1) — 전이는 **응답 시점에** 끝나 있고 웜스타트는 **커밋 뒤**에 돈다.

    `meeting_service.start()` 를 직접 불러 훅이 아직 안 돈 상태를 본다 — 그 시점에 `ai_session_id` 가
    비어 있고, 훅을 돌린 뒤에야 찬다. `live_scope` 로 태스크가 테스트 세션을 보게 묶었으므로
    이 단언은 **하네스 가시성이 아니라 순서**를 증명한다(WORK-010 검수 W-2).
    """
    created = await create_meeting(client, owner, projectId=owner.project_id)
    await meeting_service.start(db_session, account_id=owner.id, meeting_id=created["id"])

    row = (await db_session.scalars(select(Meeting).where(Meeting.id == created["id"]))).one()
    assert row.status == "recording" and row.recording_started_at is not None
    assert row.ai_session_id is None

    await run_after_commit_hooks(db_session)
    await meeting_batch_service.wait_for_tasks()

    await db_session.refresh(row)
    assert row.ai_session_id == WARM_SESSION_ID


# --- Phase 2 — `POST …/lines` ---------------------------------------------------------


async def test_line_write_outside_recording_is_409(
    client: AsyncClient, owner: MeetingOwner
) -> None:
    created = await create_meeting(client, owner, agendas=[{"title": "A"}])
    agenda_id = created["agendas"]["human"][0]["id"]
    response = await client.post(
        f"{BASE}/{created['id']}/lines",
        json={"agendaId": agenda_id, "kind": "discussion", "content": "아직 시작 전"},
        headers=owner.headers,
    )
    assert response.status_code == 409
    assert response.json()["code"] == "invalid_meeting_status"


async def test_line_is_appended_to_the_human_agenda(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession
) -> None:
    """201 `LineItem` — `track=human` · `detail:null · evidence:[] · taskId:null · payload:null` · `orderIndex` 끝 + 1 · `createdAt`."""
    detail = await start_meeting(client, owner)
    agenda_id = detail["agendas"]["human"][0]["id"]
    path = f"{BASE}/{detail['id']}/lines"

    first = await client.post(
        path, json={"agendaId": agenda_id, "kind": "discussion", "content": "  첫 줄  "}, headers=owner.headers
    )
    assert first.status_code == 201, first.text
    body = first.json()
    assert body["track"] == "human" and body["agendaId"] == agenda_id and body["kind"] == "discussion"
    assert body["content"] == "첫 줄"
    assert (body["detail"], body["evidence"], body["taskId"], body["payload"], body["task"]) == (
        None, [], None, None, None,
    )
    assert body["orderIndex"] == 0 and body["createdAt"]

    second = await client.post(
        path, json={"agendaId": agenda_id, "kind": "task", "content": "소개서 v2 문구 정리"}, headers=owner.headers
    )
    assert second.json()["orderIndex"] == 1 and second.json()["taskId"] is None

    lines = (await get_detail(client, owner, detail["id"]))["agendas"]["human"][0]["lines"]
    assert [line["content"] for line in lines] == ["첫 줄", "소개서 v2 문구 정리"]
    assert all(line["createdAt"] for line in lines)


async def test_line_rejects_ai_agenda_and_unknown_agenda_with_field(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession
) -> None:
    """AI 안건 id · 없는 안건 → **422 `validation_error` + `field: agendaId`**(SPEC-007 §4 Validation)."""
    detail = await start_meeting(client, owner)
    ai_agenda_id = await add_ai_agenda(db_session, detail["id"], title="AI 안건")
    for agenda_id in (ai_agenda_id, 999_999):
        response = await client.post(
            f"{BASE}/{detail['id']}/lines",
            json={"agendaId": agenda_id, "kind": "decision", "content": "x"},
            headers=owner.headers,
        )
        assert response.status_code == 422, agenda_id
        assert response.json() == {"detail": "입력값을 확인해 주세요", "code": "validation_error", "field": "agendaId"}


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"kind": "discussion", "content": "가" * 2001}, "content"),
        ({"kind": "discussion", "content": "   "}, "content"),
        ({"kind": "discussion", "content": "둘째\n줄"}, "content"),
        ({"kind": "note", "content": "종류 밖"}, "kind"),
        ({"kind": "discussion"}, "content"),
    ],
)
async def test_line_body_validation_names_the_field(
    client: AsyncClient, owner: MeetingOwner, body: dict, field: str
) -> None:
    """2000자 · 공백만 · 줄바꿈 · 4종 밖 kind → 422 + 첫 번째 틀린 필드."""
    detail = await start_meeting(client, owner)
    body = {"agendaId": detail["agendas"]["human"][0]["id"], **body}
    response = await client.post(f"{BASE}/{detail['id']}/lines", json=body, headers=owner.headers)
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "validation_error"
    assert response.json()["field"] == field


async def test_line_and_transcript_of_a_stranger_are_404(
    client: AsyncClient, owner: MeetingOwner, stranger: MeetingOwner
) -> None:
    detail = await start_meeting(client, owner)
    agenda_id = detail["agendas"]["human"][0]["id"]
    line = await client.post(
        f"{BASE}/{detail['id']}/lines",
        json={"agendaId": agenda_id, "kind": "discussion", "content": "x"},
        headers=stranger.headers,
    )
    transcript = await client.get(f"{BASE}/{detail['id']}/transcript", headers=stranger.headers)
    assert line.status_code == 404 and transcript.status_code == 404


# --- Phase 2 — `PATCH …/agendas/{id}` state ------------------------------------------


def _states(detail: dict) -> dict[str, str | None]:
    return {agenda["title"]: agenda["state"] for agenda in detail["agendas"]["human"]}


async def test_activating_moves_the_previous_active_to_next(
    client: AsyncClient, owner: MeetingOwner, schedule_calls: ScheduleRecorder
) -> None:
    """A active → B active 면 A 는 `next`. 응답은 `MeetingDetail` 전체이고 `active` 가 하나다. 전환마다 배치 트리거."""
    detail = await start_meeting(client, owner)
    a, b = (agenda["id"] for agenda in detail["agendas"]["human"])
    path = f"{BASE}/{detail['id']}/agendas"

    response = await client.patch(f"{path}/{a}", json={"state": "active"}, headers=owner.headers)
    assert response.status_code == 200, response.text
    assert set(response.json()) == set(detail)  # 상세와 같은 형태 — 같은 빌더
    assert _states(response.json()) == {"첫째 안건": "active", "둘째 안건": None}

    response = await client.patch(f"{path}/{b}", json={"state": "active"}, headers=owner.headers)
    assert _states(response.json()) == {"첫째 안건": "next", "둘째 안건": "active"}
    assert sum(1 for agenda in response.json()["agendas"]["human"] if agenda["state"] == "active") == 1

    assert schedule_calls.calls == [(detail["id"], "agenda_switch"), (detail["id"], "agenda_switch")]


async def test_done_on_the_active_agenda_activates_the_next_one(
    client: AsyncClient, owner: MeetingOwner, schedule_calls: ScheduleRecorder
) -> None:
    """활성 안건 완료 → 다음 순서 `next` 가 `active`. 마지막이면 활성 없음. `next` 로 되돌릴 수 있다."""
    detail = await start_meeting(
        client, owner, agendas=[{"title": "A"}, {"title": "B"}, {"title": "C"}]
    )
    a, b, c = (agenda["id"] for agenda in detail["agendas"]["human"])
    path = f"{BASE}/{detail['id']}/agendas"

    await client.patch(f"{path}/{a}", json={"state": "active"}, headers=owner.headers)
    await client.patch(f"{path}/{b}", json={"state": "next"}, headers=owner.headers)
    await client.patch(f"{path}/{c}", json={"state": "next"}, headers=owner.headers)

    response = await client.patch(f"{path}/{a}", json={"state": "done"}, headers=owner.headers)
    assert _states(response.json()) == {"A": "done", "B": "active", "C": "next"}

    response = await client.patch(f"{path}/{b}", json={"state": "done"}, headers=owner.headers)
    assert _states(response.json()) == {"A": "done", "B": "done", "C": "active"}

    response = await client.patch(f"{path}/{c}", json={"state": "done"}, headers=owner.headers)
    assert _states(response.json()) == {"A": "done", "B": "done", "C": "done"}

    response = await client.patch(f"{path}/{a}", json={"state": "next"}, headers=owner.headers)
    assert _states(response.json())["A"] == "next"

    # 전환(활성이 바뀐 때)마다 한 번 — A 활성 · A 완료→B · B 완료→C
    assert [cause for _, cause in schedule_calls.calls] == ["agenda_switch"] * 3


async def test_state_on_an_ai_agenda_is_validation_error(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession
) -> None:
    """AI 트랙 안건에는 이 표면이 없다 — 404 가 아니라 `validation_error`(SPEC-007 §4)."""
    detail = await start_meeting(client, owner)
    ai_agenda_id = await add_ai_agenda(db_session, detail["id"], title="AI 안건")
    response = await client.patch(
        f"{BASE}/{detail['id']}/agendas/{ai_agenda_id}", json={"state": "active"}, headers=owner.headers
    )
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error" and response.json()["field"] == "state"


async def test_title_patch_keeps_work_006_behaviour(
    client: AsyncClient, owner: MeetingOwner
) -> None:
    """같은 표면 — `scheduled` 에서 `{title}` 은 200, `recording` 에서는 409(허용 표)."""
    created = await create_meeting(client, owner, agendas=[{"title": "A"}])
    agenda_id = created["agendas"]["human"][0]["id"]
    path = f"{BASE}/{created['id']}/agendas/{agenda_id}"
    response = await client.patch(path, json={"title": "A'"}, headers=owner.headers)
    assert response.status_code == 200 and response.json()["agendas"]["human"][0]["title"] == "A'"

    assert (await client.post(f"{BASE}/{created['id']}/start", headers=owner.headers)).status_code == 200
    response = await client.patch(path, json={"title": "A''"}, headers=owner.headers)
    assert response.status_code == 409 and response.json()["code"] == "invalid_meeting_status"


# --- Phase 2 — `GET …/transcript` ------------------------------------------------------


async def test_transcript_is_ordered_by_at_ms_with_string_labels(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession
) -> None:
    detail = await start_meeting(client, owner)
    await add_block(db_session, detail["id"], content="둘째", speaker="2", at_ms=5000)
    await add_block(db_session, detail["id"], content="첫째", speaker="1", at_ms=1000)
    await add_block(db_session, detail["id"], content="셋째", speaker="1", at_ms=9000)

    response = await client.get(f"{BASE}/{detail['id']}/transcript", headers=owner.headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["recordingStartedAt"] == detail["recordingStartedAt"]
    assert body["speakerCount"] == 2
    assert [item["atMs"] for item in body["items"]] == [1000, 5000, 9000]
    assert [item["speakerLabel"] for item in body["items"]] == ["1", "2", "1"]
    assert set(body["items"][0]) == {"id", "speakerLabel", "atMs", "endMs", "content"}


async def test_detail_carries_ai_track_and_latest_batch_seq_from_the_same_builder(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession
) -> None:
    """`build_detail()` 하나가 `agendas.ai` · `latestBatchSeq` 를 채운다 — 표면별 조립이 없다."""
    detail = await start_meeting(client, owner)
    human_id = detail["agendas"]["human"][0]["id"]
    ai_id = await add_ai_agenda(db_session, detail["id"], title="미러", source_agenda_id=human_id)
    db_session.add(
        MeetingLine(
            meeting_id=detail["id"], agenda_id=ai_id, track=MeetingTrack.AI.value, kind="decision",
            content="AI 결정", detail="상세", evidence=[{"fromMs": 0, "toMs": 1000}], order_index=0,
        )
    )
    await db_session.flush()

    body = await get_detail(client, owner, detail["id"])
    assert body["latestBatchSeq"] == 0
    assert [agenda["sourceAgendaId"] for agenda in body["agendas"]["ai"]] == [human_id]
    assert body["agendas"]["ai"][0]["lines"][0]["evidence"] == [{"fromMs": 0, "toMs": 1000}]
    assert all(agenda["track"] == "human" for agenda in body["agendas"]["human"])


async def test_ai_task_line_carries_the_work_type_badge_source(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession
) -> None:
    """**검수 F-1** — `kind='task'` 줄의 `task` 요약에 `workType{id,name,kind,colorToken,isDeleted}` 가 실린다(SPEC-007 §4 L378 · U-4).

    화면의 유형 배지 원천이다. 업무의 유형과 같은 모양(`WorkTypeRef`)이라 삭제된 유형도 이름·색을 그대로 싣고 `isDeleted` 로 알린다.
    """
    detail = await start_meeting(client, owner, projectId=owner.project_id)
    human_id = detail["agendas"]["human"][0]["id"]
    task_id = await add_task(db_session, owner, title="소개서 v2 문구 정리", project_id=owner.project_id)
    ai_id = await add_ai_agenda(db_session, detail["id"], title="미러", source_agenda_id=human_id)
    db_session.add(
        MeetingLine(
            meeting_id=detail["id"], agenda_id=ai_id, track=MeetingTrack.AI.value, kind="task",
            content="문구 정리 기한을 당긴다", detail=None, evidence=[], order_index=0, task_id=task_id,
        )
    )
    await db_session.flush()

    line = (await get_detail(client, owner, detail["id"]))["agendas"]["ai"][0]["lines"][0]
    assert line["taskId"] == task_id and line["task"]["title"] == "소개서 v2 문구 정리"
    work_type = await db_session.get(WorkType, owner.task_type_id)
    assert work_type is not None
    assert line["task"]["workType"] == {
        "id": work_type.id,
        "name": work_type.name,
        "kind": "task",
        "colorToken": work_type.color_token,
        "isDeleted": False,
    }
    assert set(line["task"]) == {"id", "title", "status", "dueDate", "isDeleted", "workType"}


# --- 4-b — `validation_error.field` 규약(회의 · 업무 · 설정 공통) --------------------------------


async def test_validation_error_names_the_first_invalid_field(
    client: AsyncClient, owner: MeetingOwner
) -> None:
    """SPEC-006 §4 「해당 컨트롤 실패 테두리」 — 시간 규칙은 `endAt`, 스키마 오류는 pydantic 위치(`agendas[1].title`)."""
    from tests.meeting_fixtures import END, START, iso, meeting_body

    too_short = await client.post(
        BASE, json=meeting_body(owner, endAt=iso(START)), headers=owner.headers
    )
    assert too_short.status_code == 422 and too_short.json()["field"] == "endAt"

    nested = await client.post(
        BASE,
        json=meeting_body(owner, agendas=[{"title": "ok"}, {"title": ""}]),
        headers=owner.headers,
    )
    assert nested.status_code == 422 and nested.json()["field"] == "agendas[1].title"

    missing = await client.post(BASE, json={"title": "유형 없음", "startAt": iso(START), "endAt": iso(END)}, headers=owner.headers)
    assert missing.status_code == 422 and missing.json()["field"] == "workTypeId"

    bad_type = await client.post(BASE, json=meeting_body(owner, workTypeId=owner.task_type_id), headers=owner.headers)
    assert bad_type.status_code == 422
    assert (bad_type.json()["code"], bad_type.json()["field"]) == ("invalid_work_type", "workTypeId")

    query = await client.get(BASE, params={"from": "not-a-date", "to": iso(END)}, headers=owner.headers)
    assert query.status_code == 422 and query.json()["field"] == "from"


async def test_task_and_setting_validation_errors_share_the_field_shape(
    client: AsyncClient, owner: MeetingOwner
) -> None:
    """업무·설정도 같은 모양 — `{detail, code, field}`."""
    task = await client.post(
        "/api/tasks",
        json={"title": "기한 역전", "workTypeId": owner.task_type_id, "startDate": "2026-09-10", "dueDate": "2026-09-01"},
        headers=owner.headers,
    )
    assert task.status_code == 422 and task.json()["field"] == "dueDate"

    work_type = await client.post(
        "/api/work-types",
        json={"kind": "task", "name": "x", "colorToken": "coral"},
        headers=owner.headers,
    )
    assert work_type.status_code == 422
    assert (work_type.json()["code"], work_type.json()["field"]) == ("invalid_color_token", "colorToken")
