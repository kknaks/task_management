"""WORK-012 — 종료 파이프라인 **① async 재전사 → ② 최종 회의록 한 번**(SPEC-008 §4 · DEC-003 §4 · §7 · MF-37 · 52 · 56 · 57 · 58 · 59).

**BE §12 테스트 8 이 여기다** — ② 가 2회 재시도 후 실패하면 `ended`+`failed` 이고 사람 줄 · AI 줄 · 트랜스크립트가 그대로다.
**① 이 실패하면 ② 로 가지 않는다**(fallback 없음 · MF-58).

대역: `fake_async_stt`(Soniox `stt-async-v5`) · `fake_agent`(codex).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from dto.enums import JobPhase
from integrations.soniox import SttToken
from models.meeting import Meeting, MeetingLine, MeetingTranscript
from service import job_service, meeting_batch_service, meeting_finalize_service
from tests.fakes.agent import WARM_SESSION_ID, FakeAgentGateway
from tests.fakes.soniox import FakeAsyncSttConnector
from tests.meeting_close_fixtures import (  # noqa: F401
    HEADLINE,
    close_scope,
    drop_headline,
    drop_one_human_agenda,
    end_meeting,
    fake_async_stt,
    finalize_successfully,
    finalize_with_failure,
    load_job,
    load_meeting,
    notes_from,
    notes_output,
    overlong_headline,
    prepare_recording,
    rows_by_track,
    run_job,
    slot,
)
from tests.meeting_fixtures import BASE, MeetingOwner, owner  # noqa: F401
from tests.meeting_live_fixtures import add_task

pytestmark = pytest.mark.usefixtures("close_scope", "fake_async_stt")

BACK = Path(__file__).resolve().parents[1]


async def _count(session: AsyncSession, model, *where) -> int:
    return await session.scalar(select(func.count()).select_from(model).where(*where)) or 0


async def _transcript(session: AsyncSession, meeting_id: int) -> list[MeetingTranscript]:
    return list(
        (
            await session.scalars(
                select(MeetingTranscript)
                .where(MeetingTranscript.meeting_id == meeting_id)
                .order_by(MeetingTranscript.at_ms)
            )
        ).all()
    )


# --- ① async 재전사 ------------------------------------------------------------


async def test_retranscription_replaces_the_realtime_blocks_wholesale(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession,
    fake_agent: FakeAgentGateway, fake_async_stt: FakeAsyncSttConnector,
) -> None:
    """① 이 끝나면 실시간 블록이 **전부 사라지고** 재전사 블록만 있다(M-9-a · 한 트랜잭션).

    `at_ms` 기준이 같다 — 파일 시작이 곧 `recording_started_at` 이라 토큰 시각이 그대로 블록 시각이다.
    """
    detail = await prepare_recording(client, owner, db_session)
    before = await _transcript(db_session, detail["id"])
    assert [block.content for block in before] == ["실시간 블록 — 재전사가 이것을 갈아끼운다"]

    fake_agent.will_return(notes_output(detail))
    await run_job(await end_meeting(client, owner, detail["id"]))

    after = await _transcript(db_session, detail["id"])
    assert [block.content for block in after] == ["재전사된 발화입니다.", "캐스티 안건을 정리합시다."]
    assert [(block.speaker_label, block.at_ms, block.end_ms) for block in after] == [
        ("1", 1000, 5000),
        ("2", 6000, 12_000),
    ]
    assert {block.id for block in after}.isdisjoint({block.id for block in before})


async def test_the_transcribe_context_carries_three_generals_and_no_terms(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession,
    fake_agent: FakeAgentGateway, fake_async_stt: FakeAsyncSttConnector,
) -> None:
    """`context.general` 셋 · **`terms` 비움**(DEC-003 OQ-10) · 참석자 이름 없음(§2 익명)."""
    detail = await prepare_recording(client, owner, db_session, projectId=owner.project_id)
    fake_agent.will_return(notes_output(detail))
    await run_job(await end_meeting(client, owner, detail["id"]))

    call = fake_async_stt.calls[0]
    assert [row["key"] for row in call.context.general] == ["회의 제목", "프로젝트", "화자 수"]
    assert call.context.to_json().keys() == {"general"}  # `text` 없음(직전 회의 없음) · `terms` 없음
    assert call.poll_sec == 5 and call.timeout_sec == 1200
    assert call.path == Path("recordings/1.webm")


async def test_the_transcribe_context_text_is_the_previous_meeting_headline(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession,
    fake_agent: FakeAgentGateway, fake_async_stt: FakeAsyncSttConnector,
) -> None:
    """`context.text` = 같은 프로젝트의 직전 `ended`+`succeeded` 회의의 `ai_headline`(SPEC-008 §4)."""
    first, _ = await finalize_successfully(
        client, owner, db_session, fake_agent, projectId=owner.project_id
    )
    assert first["headline"] == HEADLINE

    fake_async_stt.calls.clear()
    second = await prepare_recording(
        client, owner, db_session, projectId=owner.project_id, **slot(3)
    )
    fake_agent.will_return(notes_output(second))
    await run_job(await end_meeting(client, owner, second["id"]))

    assert fake_async_stt.calls[0].context.text == HEADLINE


@pytest.mark.parametrize(
    ("failure", "error_code"),
    [("fail", "transcription_failed"), ("timeout", "transcription_timeout")],
)
async def test_transcription_failure_ends_the_pipeline_without_calling_codex(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession,
    fake_agent: FakeAgentGateway, fake_async_stt: FakeAsyncSttConnector,
    failure: str, error_code: str,
) -> None:
    """**fallback 이 없다**(MF-58) — ① 이 실패하면 `ended`+`failed` 이고 **② 가 불리지 않는다**.

    실시간 블록은 그대로 남는다(지우기 전에 실패했다).
    """
    detail = await prepare_recording(client, owner, db_session)
    fake_async_stt.will_fail() if failure == "fail" else fake_async_stt.will_timeout()
    fake_agent.calls.clear()

    job_id = await end_meeting(client, owner, detail["id"])
    await run_job(job_id)

    job = await load_job(db_session, job_id)
    assert (job.status, job.error_code) == ("failed", error_code)
    meeting = await load_meeting(db_session, detail["id"])
    assert (meeting.status, meeting.integration_state) == ("ended", "failed")
    assert meeting.ai_headline is None and meeting.term_corrections is None
    # ② 가 불리지 않았다 — codex 호출 0건
    assert fake_agent.calls == []
    agendas, lines = await rows_by_track(db_session, detail["id"], "merged")
    assert agendas == [] and lines == []
    # 실시간 블록 그대로
    assert [block.content for block in await _transcript(db_session, detail["id"])] == [
        "실시간 블록 — 재전사가 이것을 갈아끼운다"
    ]


# --- ② 최종 회의록 ------------------------------------------------------------


async def test_codex_is_called_exactly_once_after_the_meeting_ends(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """종료 후 codex 호출이 **한 번**이다(MF-56) — 종료 시 배치도 통합 호출도 없다."""
    detail = await prepare_recording(client, owner, db_session)
    fake_agent.calls.clear()
    fake_agent.will_return(notes_output(detail))
    await run_job(await end_meeting(client, owner, detail["id"]))

    assert len(fake_agent.calls) == 1
    call = fake_agent.calls[0]
    assert call.session_id == WARM_SESSION_ID  # 같은 세션을 resume
    assert call.output_schema == Path(meeting_batch_service.OUTPUT_SCHEMA)
    assert call.timeout_sec == 300


async def test_the_final_prompt_carries_the_retranscribed_script_only(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """② 입력은 **재전사 스크립트 전체 하나**다 — 안건 · 사람 줄 · 업무는 AI 가 도구로 조회한다(MF-50 · 51)."""
    detail = await prepare_recording(client, owner, db_session)
    fake_agent.will_return(notes_output(detail))
    await run_job(await end_meeting(client, owner, detail["id"]))

    prompt = fake_agent.calls[-1].prompt
    assert "재전사된 발화입니다." in prompt
    assert "사람 줄 A — 개정 범위는 4개 섹션이다" not in prompt
    assert "첫째 안건" not in prompt
    for needle in ("humanAgendas", "humanLines", "aiAgendas", "taskWhitelist"):
        assert needle not in prompt
    # 초안 §B 의 증분 문구는 최종에 오지 않는다(WP §Open Issues)
    assert "새로 드러난" not in prompt and "추가할 줄" not in prompt


async def test_merged_track_mirrors_every_human_agenda_and_copies_its_state(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """미러 안건은 사람 안건의 `state` 를 복사하고 제목도 사람 안건 것이다. AI 신설은 둘 다 `NULL`."""
    body, _ = await finalize_successfully(client, owner, db_session, fake_agent)
    human = body["agendas"]["human"]
    merged = body["agendas"]["merged"]

    assert [agenda["sourceAgendaId"] for agenda in merged] == [h["id"] for h in human] + [None]
    assert [agenda["title"] for agenda in merged[:-1]] == [h["title"] for h in human]
    assert [agenda["state"] for agenda in merged[:-1]] == [h["state"] for h in human]
    assert merged[-1]["state"] is None
    # `/end` 가 `active→done` 을 이미 했다 — `active` 가 없다
    assert "active" not in [agenda["state"] for agenda in merged]


async def test_missing_a_human_agenda_fails_that_attempt(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """사람 안건을 빠뜨린 출력은 **그 시도 실패**다(SPEC-008 §4 「안건 참조」). 다음 시도가 제대로 내면 성공한다."""
    detail = await prepare_recording(client, owner, db_session)
    fake_agent.calls.clear()  # 웜스타트 호출을 세지 않는다
    fake_agent.will_return(notes_from(detail, mutate=drop_one_human_agenda))
    fake_agent.will_return(notes_output(detail))
    await run_job(await end_meeting(client, owner, detail["id"]))

    meeting = await load_meeting(db_session, detail["id"])
    assert (meeting.status, meeting.integration_state) == ("ended", "succeeded")
    assert len(fake_agent.calls) == 2  # 첫 시도가 실패하고 둘째가 성공했다


@pytest.mark.parametrize("mutate", [drop_headline, overlong_headline])
async def test_a_bad_headline_fails_that_attempt(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession,
    fake_agent: FakeAgentGateway, mutate,
) -> None:
    """`headline` 은 1~200자 한 문장 **필수**다. 셋 다 실패하면 `final_failed`."""
    detail = await prepare_recording(client, owner, db_session)
    for _ in range(3):
        fake_agent.will_return(notes_from(detail, mutate=mutate))
    job_id = await end_meeting(client, owner, detail["id"])
    await run_job(job_id)

    job = await load_job(db_session, job_id)
    assert (job.status, job.error_code) == ("failed", "final_failed")


async def test_8_three_failures_end_the_meeting_leaving_everything_else_intact(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """**BE §12 테스트 8** — ② 가 3회 실패하면 `ended`+`failed` 이고 사람 줄 · AI 줄 · 트랜스크립트가 그대로다."""
    body, job_id = await finalize_with_failure(client, owner, db_session, fake_agent)

    job = await load_job(db_session, job_id)
    assert (job.status, job.error_code) == ("failed", "final_failed")
    assert job.attempt == 3
    meeting = await load_meeting(db_session, body["id"])
    assert meeting.ai_headline is None and meeting.term_corrections is None
    agendas, lines = await rows_by_track(db_session, body["id"], "merged")
    assert agendas == [] and lines == []
    assert body["mergedSummary"] is None
    # 사람 줄 셋 · AI 줄 0 · 재전사 블록 둘은 그대로 산다
    assert await _count(db_session, MeetingLine, MeetingLine.meeting_id == body["id"], MeetingLine.track == "human") == 3
    assert len(await _transcript(db_session, body["id"])) == 2


async def test_timeouts_on_every_attempt_report_final_timeout(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    detail = await prepare_recording(client, owner, db_session)
    for _ in range(3):
        fake_agent.will_timeout()
    job_id = await end_meeting(client, owner, detail["id"])
    await run_job(job_id)

    job = await load_job(db_session, job_id)
    assert (job.status, job.error_code) == ("failed", "final_timeout")


async def test_a_missing_ai_session_fails_the_attempt_without_rewarming(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """`ai_session_id` 가 `NULL` 이면 **그 시도 실패**다 — 재웜스타트 갈래가 없다(MF-70)."""
    detail = await prepare_recording(client, owner, db_session)
    await db_session.execute(
        Meeting.__table__.update().where(Meeting.id == detail["id"]).values(ai_session_id=None)
    )
    await db_session.flush()
    fake_agent.calls.clear()

    job_id = await end_meeting(client, owner, detail["id"])
    await run_job(job_id)

    job = await load_job(db_session, job_id)
    assert (job.status, job.error_code) == ("failed", "final_failed")
    assert fake_agent.calls == []  # 세션이 없으니 제출 자체가 없다


# --- AI 트랙 불변 · 용어 치환 ------------------------------------------------------


async def test_the_ai_track_is_untouched_by_the_close_pipeline(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """종료 전후로 `track='ai'` 행이 **하나도 안 바뀐다**(M-6 · MF-56) — 종료 시 배치가 없다."""
    detail = await prepare_recording(client, owner, db_session)
    fake_agent.will_return(
        {
            "headline": None,
            "termCorrections": None,
            "agendas": [
                {
                    "humanAgendaId": detail["agendas"]["human"][0]["id"],
                    "title": "회의 중 AI 안건",
                    "lines": [{"kind": "discussion", "content": "회의 중 AI 줄", "detail": None,
                               "evidence": [], "taskId": None, "payload": None}],
                }
            ],
        }
    )
    assert await meeting_batch_service.evaluate(detail["id"], "timer") is True
    before_agendas, before_lines = await rows_by_track(db_session, detail["id"], "ai")
    assert [line.content for line in before_lines] == ["회의 중 AI 줄"]

    fake_agent.will_return(notes_output(detail))
    await run_job(await end_meeting(client, owner, detail["id"]))

    after_agendas, after_lines = await rows_by_track(db_session, detail["id"], "ai")
    assert [(a.id, a.title) for a in after_agendas] == [(a.id, a.title) for a in before_agendas]
    assert [(line.id, line.content) for line in after_lines] == [
        (line.id, line.content) for line in before_lines
    ]


async def test_auto_terms_rewrite_the_script_and_guess_terms_do_not(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """`grade='auto'` 만 `content` 를 바꾸고 `guess` 는 표에만 남는다. **`speaker_label` 은 불변**(M-9-b)."""
    detail = await prepare_recording(client, owner, db_session)
    terms = [
        {"stt": "캐스티", "correct": "Casti", "grade": "auto"},
        {"stt": "재전사된", "correct": "다시 받아쓴", "grade": "guess"},
    ]
    fake_agent.will_return(notes_output(detail, term_corrections=terms))
    before = await _transcript(db_session, detail["id"])  # 아직 실시간 블록

    await run_job(await end_meeting(client, owner, detail["id"]))

    meeting = await load_meeting(db_session, detail["id"])
    assert meeting.term_corrections == terms
    after = await _transcript(db_session, detail["id"])
    assert [block.content for block in after] == ["재전사된 발화입니다.", "Casti 안건을 정리합시다."]
    assert [block.speaker_label for block in after] == ["1", "2"]
    assert before  # 실시간 블록이 있었다(재전사가 갈아끼웠다)


async def test_no_substitution_happens_outside_the_table(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """표가 비면 본문이 하나도 안 바뀐다 — 표에 없는 치환은 없다(M-9-b)."""
    detail = await prepare_recording(client, owner, db_session)
    fake_agent.will_return(notes_output(detail))
    await run_job(await end_meeting(client, owner, detail["id"]))

    assert [block.content for block in await _transcript(db_session, detail["id"])] == [
        "재전사된 발화입니다.",
        "캐스티 안건을 정리합시다.",
    ]
    assert (await load_meeting(db_session, detail["id"])).term_corrections == []


# --- 줄 단위 완화(강등 · 페이로드 키) -----------------------------------------------


async def test_a_task_outside_the_project_is_demoted_without_failing_the_attempt(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """회의 프로젝트 밖 `taskId` → **그 줄만 `action` 강등**. 시도는 산다(WORK-011 함수)."""
    outside = await add_task(db_session, owner, title="다른 프로젝트 업무", project_id=None)
    detail = await prepare_recording(client, owner, db_session, projectId=owner.project_id)
    fake_agent.will_return(notes_output(detail, task_id=outside))
    await run_job(await end_meeting(client, owner, detail["id"]))

    _, lines = await rows_by_track(db_session, detail["id"], "merged")
    demoted = next(line for line in lines if line.content == "업무 줄")
    assert (demoted.kind, demoted.task_id, demoted.payload) == ("action", None, None)
    assert (await load_meeting(db_session, detail["id"])).integration_state == "succeeded"


async def test_a_deleted_work_type_reference_is_nulled_keeping_the_line(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """`payload.workTypeId` 가 삭제된 유형이면 **그 키만 `null`** — 줄도 시도도 산다."""
    detail = await prepare_recording(client, owner, db_session)
    output = notes_output(detail)
    output["agendas"][0]["lines"][1]["payload"] = {
        "title": "새 업무", "workTypeId": 999_999, "projectId": 999_999, "todos": []
    }
    fake_agent.will_return(output)
    await run_job(await end_meeting(client, owner, detail["id"]))

    _, lines = await rows_by_track(db_session, detail["id"], "merged")
    action = next(line for line in lines if line.content == "AI 전용 — 후속 미팅은 9/12")
    assert action.payload["workTypeId"] is None and action.payload["projectId"] is None
    assert action.payload["title"] == "새 업무"
    assert (await load_meeting(db_session, detail["id"])).integration_state == "succeeded"


@pytest.mark.parametrize("status", ["done", "cancelled"])
async def test_a_finished_status_key_is_dropped_keeping_the_line(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession,
    fake_agent: FakeAgentGateway, status: str,
) -> None:
    """`payload.status` 가 `done`·`cancelled` 면 **그 키를 뗀다**(MF-59) — 완료는 사람이 업무 화면에서 누른다."""
    task_id = await add_task(db_session, owner, title="연결된 업무", project_id=owner.project_id)
    detail = await prepare_recording(client, owner, db_session, projectId=owner.project_id)
    output = notes_output(detail, task_id=task_id)
    output["agendas"][0]["lines"][-1]["payload"]["status"] = status
    fake_agent.will_return(output)
    await run_job(await end_meeting(client, owner, detail["id"]))

    _, lines = await rows_by_track(db_session, detail["id"], "merged")
    task_line = next(line for line in lines if line.kind == "task")
    assert "status" not in task_line.payload
    assert task_line.payload["note"] == "진행 메모"  # 나머지 키는 산다


async def test_payload_on_a_discussion_line_is_dropped(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """`payload` 자리는 `action`·`task` 줄뿐이다 — 논의 줄에 실려 오면 **버린다**(폐기 사유 아님)."""
    detail = await prepare_recording(client, owner, db_session)
    output = notes_output(detail)
    output["agendas"][0]["lines"][0]["payload"] = {"title": "여기 오면 안 된다"}
    fake_agent.will_return(output)
    await run_job(await end_meeting(client, owner, detail["id"]))

    _, lines = await rows_by_track(db_session, detail["id"], "merged")
    assert next(line for line in lines if line.kind == "discussion").payload is None


# --- 원자성 · 종결 ------------------------------------------------------------


def test_the_success_commit_is_one_transaction() -> None:
    """**원자성**(SPEC-008 §4 · M-19 ①) — 성공 종결의 여섯 쓰기가 `session_scope()` **하나** 안에 있다.

    한 트랜잭션이라는 것은 「중간에 터지면 전부 없다」와 같은 말이다. 테스트 하네스는 모든 단계를
    같은 세션에 묶어(`close_scope`) 롤백 격리를 만들기 때문에 **커밋 경계를 실행으로 볼 수 없다** —
    그래서 경계 자체를 코드에서 본다. 실행 쪽은 아래 `…_propagates…` 가 「부분 성공으로 끝나지 않는다」를 본다.
    """
    source = (BACK / "service" / "meeting_finalize_service.py").read_text(encoding="utf-8")
    body = source[source.index("async def _commit_success("):source.index("async def _commit_failure(")]

    assert body.count("async with session_scope()") == 1
    scope = body[body.index("async with session_scope()"):]
    for write in (
        "meeting_batch_service.persist(",
        "replace_content(",
        "create_run(",
        "finish_integration(",
        "job_service.finish(",
    ):
        assert write in scope, write
    # 폐기만 트랜잭션 **밖**이다 — best-effort 라 job 결과를 뒤집으면 안 된다
    assert body.index("_revoke_token") > body.index("job_service.finish(")


async def test_a_failure_inside_the_success_commit_propagates_without_settling(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession,
    fake_agent: FakeAgentGateway, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """적재 중간에서 터지면 **부분 성공으로 끝나지 않는다** — 예외가 전파되고 job 도 회의도 종결되지 않는다."""
    detail = await prepare_recording(client, owner, db_session)
    fake_agent.will_return(notes_output(detail))

    async def boom(*args, **kwargs):
        raise RuntimeError("적재 중간에서 터진다")

    monkeypatch.setattr(meeting_finalize_service.meeting_repository, "finish_integration", boom)

    job_id = await end_meeting(client, owner, detail["id"])
    with pytest.raises(RuntimeError, match="적재 중간에서 터진다"):
        await run_job(job_id)

    job = await load_job(db_session, job_id)
    assert (job.status, job.error_code, job.finished_at) == ("running", None, None)
    meeting = await load_meeting(db_session, detail["id"])
    assert (meeting.status, meeting.ai_headline, meeting.term_corrections) == ("generating", None, None)


@pytest.mark.parametrize("outcome", ["success", "failure"])
async def test_the_meeting_token_row_is_gone_after_the_pipeline_settles(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession,
    fake_agent: FakeAgentGateway, outcome: str,
) -> None:
    """② 가 종결되면(성공·실패 무관) `auth_session(kind='meeting')` 행이 **0건**이다(MF-4)."""
    from models.account import AuthSession

    if outcome == "success":
        body, _ = await finalize_successfully(client, owner, db_session, fake_agent)
    else:
        body, _ = await finalize_with_failure(client, owner, db_session, fake_agent)

    remaining = await _count(
        db_session, AuthSession, AuthSession.kind == "meeting", AuthSession.meeting_id == body["id"]
    )
    assert remaining == 0


async def test_a_failing_revoke_does_not_flip_the_job_result(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession,
    fake_agent: FakeAgentGateway, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """토큰 폐기는 **best-effort** 다 — DB 오류로 실패해도 job 결과가 뒤집히지 않는다(MF-4).

    포착은 `SQLAlchemyError` 하나다(BE §8-1) — 그 밖의 예외는 아래 테스트가 보듯 **전파된다**.
    """
    async def boom(*args, **kwargs):
        raise OperationalError("DELETE …", {}, Exception("연결이 끊겼다"))

    monkeypatch.setattr(meeting_finalize_service.auth_service, "revoke_meeting_token", boom)
    body, job_id = await finalize_successfully(client, owner, db_session, fake_agent)

    assert (await load_job(db_session, job_id)).status == "succeeded"
    assert body["integrationState"] == "succeeded"


async def test_a_non_database_failure_in_revoke_propagates(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession,
    fake_agent: FakeAgentGateway, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """폐기 자리가 삼키는 것은 **DB 오류뿐**이다 — 설계 밖 예외는 전파해 태스크 콜백이 스택째 드러낸다(BE §8-1).

    좁히기 전에는 `except Exception` 이라 무엇이든 삼켰다(WORK-012 검수 W-1).
    """
    detail = await prepare_recording(client, owner, db_session)
    fake_agent.will_return(notes_output(detail))

    async def boom(*args, **kwargs):
        raise RuntimeError("설계 밖 예외")

    monkeypatch.setattr(meeting_finalize_service.auth_service, "revoke_meeting_token", boom)

    job_id = await end_meeting(client, owner, detail["id"])
    with pytest.raises(RuntimeError, match="설계 밖 예외"):
        await run_job(job_id)

    # 폐기는 종결 **뒤**라 회의·job 은 이미 성공으로 남는다 — 삼키지 않는 것과 결과를 뒤집는 것은 다른 축이다
    assert (await load_meeting(db_session, detail["id"])).integration_state == "succeeded"


async def test_merged_summary_counts_five(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """`mergedSummary` 는 **다섯**이고 `integratedAt` 이 없다. 회의록 탭 줄 수와 정확히 같다."""
    task_id = await add_task(db_session, owner, title="연결된 업무", project_id=owner.project_id)
    body, _ = await finalize_successfully(
        client, owner, db_session, fake_agent, task_id=task_id, projectId=owner.project_id
    )
    summary = body["mergedSummary"]
    lines = [line for agenda in body["agendas"]["merged"] for line in agenda["lines"]]

    assert set(summary) == {
        "agendaCount", "discussionCount", "decisionCount", "actionCount", "taskCount"
    }
    assert summary["agendaCount"] == len(body["agendas"]["merged"])
    assert summary["discussionCount"] == sum(line["kind"] == "discussion" for line in lines)
    assert summary["actionCount"] == sum(line["kind"] == "action" for line in lines)
    assert summary["taskCount"] == sum(line["kind"] == "task" for line in lines)


# --- /finalize · job 상한 ------------------------------------------------------


async def test_finalize_is_202_only_from_ended_failed_and_runs_from_step_one(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession,
    fake_agent: FakeAgentGateway, fake_async_stt: FakeAsyncSttConnector,
) -> None:
    """`POST /finalize` 는 `ended`+`failed` 에서만 202 다. **①부터** 다시 돈다(MF-58)."""
    body, _ = await finalize_with_failure(client, owner, db_session, fake_agent)
    fake_async_stt.calls.clear()
    fake_agent.will_return(notes_output(body))

    accepted = await client.post(f"{BASE}/{body['id']}/finalize", headers=owner.headers)
    assert accepted.status_code == 202, accepted.text
    await run_job(accepted.json()["jobId"])

    assert len(fake_async_stt.calls) == 1  # ① 이 다시 돌았다
    after = (await client.get(f"{BASE}/{body['id']}", headers=owner.headers)).json()
    assert (after["status"], after["integrationState"]) == ("ended", "succeeded")

    again = await client.post(f"{BASE}/{after['id']}/finalize", headers=owner.headers)
    assert (again.status_code, again.json()["code"]) == (409, "invalid_meeting_status")


async def test_finalize_reissues_exactly_one_meeting_token(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """「다시 시도」는 회의 토큰을 **새로 발급**한다(2026-09-08 코디 확정).

    ② 종결이 행을 지웠으므로 재시도 ② 가 MCP 도구를 부르려면 토큰이 있어야 한다.
    **어느 시점에도 회의당 하나**이고(A-13), ② 가 그 새 원문으로 헤더를 싼다.
    """
    from models.account import AuthSession

    body, _ = await finalize_with_failure(client, owner, db_session, fake_agent)
    assert await _count(
        db_session, AuthSession, AuthSession.kind == "meeting", AuthSession.meeting_id == body["id"]
    ) == 0

    fake_agent.will_return(notes_output(body))
    accepted = await client.post(f"{BASE}/{body['id']}/finalize", headers=owner.headers)
    assert accepted.status_code == 202

    rows = list(
        (
            await db_session.scalars(
                select(AuthSession).where(
                    AuthSession.kind == "meeting", AuthSession.meeting_id == body["id"]
                )
            )
        ).all()
    )
    assert len(rows) == 1  # 회의당 하나
    reissued = rows[0].meeting_token

    await run_job(accepted.json()["jobId"])
    assert fake_agent.calls[-1].meeting_token == reissued  # ② 가 새 원문으로 헤더를 쌌다
    after = (await client.get(f"{BASE}/{body['id']}", headers=owner.headers)).json()
    assert after["integrationState"] == "succeeded"


def test_the_job_ceiling_is_2400_seconds() -> None:
    """job 상한은 **2400초**다(SPEC-008 §4 「수치」 — 1200 + 300×3 = 2100 에 여유).

    **클래스 기본값**을 본다 — 캐시된 `Settings` 인스턴스는 다른 테스트가 monkeypatch 로 잠시 바꾼다.
    상한을 넘겼을 때의 마감(`job_timeout` · 회의 `ended`+`failed`)은 `test_job.py` 가 실행기째 본다 —
    여기서 다시 흉내 내면 handler 대역이 두 벌이 된다.
    """
    from config import Settings

    assert Settings.model_fields["meeting_job_timeout_sec"].default == 2400
    assert Settings.model_fields["meeting_transcribe_timeout_sec"].default == 1200
    assert Settings.model_fields["meeting_transcribe_poll_sec"].default == 5
    assert Settings.model_fields["meeting_final_timeout_sec"].default == 300
    assert Settings.model_fields["meeting_final_attempts"].default == 3


async def test_progress_phase_is_transcription_then_final(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """`progress.phase` 는 **파생** — ① 도는 동안 `transcription`, `batch_run(phase='final')` 이 생기면 `final`."""
    detail = await prepare_recording(client, owner, db_session)
    job_id = await end_meeting(client, owner, detail["id"])

    before = await job_service.get_detail(db_session, account_id=owner.id, job_id=job_id)
    assert before.progress.phase == JobPhase.TRANSCRIPTION.value

    fake_agent.will_return(notes_output(detail))
    await run_job(job_id)

    after = await job_service.get_detail(db_session, account_id=owner.id, job_id=job_id)
    assert after.progress.phase == JobPhase.FINAL.value


# --- 정적 검사 ----------------------------------------------------------------


@pytest.mark.parametrize(
    "needle",
    [
        "meeting_merge_service",
        "meeting_integration.json",
        "run_final",
        "build_final_prompt",
        "_agenda_rows",
        "BatchPhase.INTEGRATION",
        "pending_change",
        "pendingChange",
        "source_human_line_id",
        "source_ai_line_id",
        "integration_failed",
        "NotImplementedError",
    ],
)
def test_the_removed_names_are_gone_from_the_backend(needle: str) -> None:
    """폐기한 이름이 **실행 코드**에 남아 있지 않다(WORK-012).

    옛 리비전(`0005`·`0006`)은 그 시점의 스키마라 제외하고, `tests/` 도 뺀다 —
    `test_migrations.py` 는 「`pending_change` 가 `payload` 로 옮겨졌다」를 단언하느라 옛 이름을 그대로 적는다.
    """
    offenders = []
    for path in BACK.rglob("*.py"):
        if ".venv" in path.parts or "tests" in path.parts or path.name.startswith("000"):
            continue
        if needle in path.read_text(encoding="utf-8"):
            offenders.append(str(path.relative_to(BACK)))

    assert offenders == [], offenders


def test_there_is_exactly_one_ai_schema_file() -> None:
    assert sorted(p.name for p in (BACK / "ai_schemas").iterdir()) == ["meeting_notes.json"]


def test_the_block_boundary_constants_live_in_one_file() -> None:
    """300자 · 2초가 **한 파일**에만 있다 — 실시간과 재전사가 같은 경계를 지난다(M-9-a)."""
    offenders = []
    for path in (BACK / "service").rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        if "BLOCK_MAX_CHARS = " in text or "BLOCK_GAP_MS = " in text:
            offenders.append(path.name)

    assert offenders == ["meeting_transcript_blocks.py"]


def test_no_second_serializer_for_the_agenda_tree() -> None:
    """트리를 만드는 함수가 **하나**다(`meeting_service.build_tracks`) — `ai.batch` 와 상세가 갈리지 않는다."""
    offenders = []
    for path in (BACK / "service").rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        if "MeetingAgendaTracksDTO(" in text and path.name != "meeting_service.py":
            offenders.append(path.name)

    assert offenders == []


def test_the_transcribe_failure_path_never_reaches_the_final_attempt() -> None:
    """**fallback 이 없다**(MF-58) — ① 의 `except` 블록 안에서 `_attempt_final` 을 부르지 않는다."""
    source = (BACK / "service" / "meeting_finalize_service.py").read_text(encoding="utf-8")
    pipeline = source[source.index("async def run_pipeline("):source.index("# --- ① async 재전사")]
    failure_arms = pipeline[pipeline.index("except TimeoutError"):pipeline.index("last_reason = \"\"")]

    assert "_attempt_final" not in failure_arms
    assert failure_arms.count("return") == 2  # 두 갈래 모두 여기서 끝난다


def test_no_broad_except_and_no_stream_condition_in_the_close_path() -> None:
    """**넓은 포착 0 · 「WS 연결 있음」 조건 0**(BE §8-1 · SPEC-008 §4).

    WORK-012 가 이 가드를 지웠다가 검수(W-1)에서 되살렸다 — 그 사이에 위반이 하나 생겼고
    잡을 검사가 없었다. `meeting_merge_service` 는 폐기됐으므로 목록에서 빠졌다.

    잠그는 것 둘 —
    ① 다섯 service + 두 repository 에 넓은 포착이 없다. 포착은 구체 타입으로만 한다
    ② `/end` 가 스트림 레지스트리를 **조건으로 보지 않는다** — 사전 조건은 `recording` 상태 하나다
    """
    broad = ("except " + "Exception", "except " + "BaseException")

    finalize = (BACK / "service" / "meeting_finalize_service.py").read_text(encoding="utf-8")
    assert "is_active(" not in finalize
    assert "meeting_stream_disconnected" not in finalize

    for name in (
        "meeting_finalize_service.py",
        "meeting_edit_service.py",
        "job_service.py",
        "meeting_batch_service.py",
    ):
        text = (BACK / "service" / name).read_text(encoding="utf-8")
        for needle in broad:
            assert needle not in text, f"{name}: {needle}"

    for name in ("job_repository.py", "meeting_line_repository.py"):
        text = (BACK / "repository" / name).read_text(encoding="utf-8")
        for needle in broad:
            assert needle not in text, f"{name}: {needle}"


def test_only_the_finalize_service_writes_the_headline_and_terms() -> None:
    writers = []
    for path in BACK.rglob("*.py"):
        if ".venv" in path.parts or "tests" in path.parts or path.name.startswith("000"):
            continue
        text = path.read_text(encoding="utf-8")
        if "finish_integration(" in text and path.name not in ("meeting_repository.py",):
            writers.append(path.name)

    assert writers == ["meeting_finalize_service.py"]
