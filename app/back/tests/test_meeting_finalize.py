"""WORK-008 Phase 1 — `/end` · 종료 파이프라인 ①② · `/integrate` · `MeetingDetail` 의 통합 필드. **BE §12 필수 테스트 8 이 여기다.**

정본: SPEC-008 §4(`/end` · 종료 파이프라인 · 통합 규칙 · Case Matrix · 수치) · DEC-003 §4 · §7 · ERD M-7 · M-8-a · M-19.
대역 `agent` 가 ① 출력(배치 스키마)과 ② 출력(통합 스키마)을 순서대로 낸다. 파이프라인은 `job_service.run()` 으로 **실행기째** 돈다.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from integrations.agent import AgentRunFailed, AgentRunTimeout
from models.meeting import Meeting, MeetingBatchRun, MeetingLine, MeetingTranscript
from service import meeting_batch_service, meeting_merge_service
from tests.fakes.agent import WARM_SESSION_ID, FakeAgentGateway
from tests.meeting_close_fixtures import (  # noqa: F401
    HEADLINE,
    LaunchRecorder,
    add_unreferenced_line,
    answer,
    close_scope,
    drop_headline,
    drop_one_human_line,
    duplicate_ai_line,
    duplicate_human_line,
    end_meeting,
    final_output,
    notes_output,
    finalize_successfully,
    finalize_with_failure,
    load_job,
    load_meeting,
    overlong_headline,
    prepare_recording,
    rows_by_track,
    run_job,
    slot,
)
from tests.meeting_fixtures import BASE, MeetingOwner, create_meeting, owner, stranger  # noqa: F401
from tests.meeting_live_fixtures import add_task, start_meeting

pytestmark = pytest.mark.usefixtures("close_scope")


async def _runs(session: AsyncSession, meeting_id: int) -> list[MeetingBatchRun]:
    return list((await session.scalars(
        select(MeetingBatchRun).where(MeetingBatchRun.meeting_id == meeting_id).order_by(MeetingBatchRun.id)
    )).all())


# --- /end ------------------------------------------------------------------------


async def test_end_returns_202_with_job_and_moves_the_meeting_to_generating(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, close_scope: LaunchRecorder
) -> None:
    detail = await prepare_recording(client, owner, db_session)
    assert detail["agendas"]["human"][0]["state"] == "active"

    response = await client.post(f"{BASE}/{detail['id']}/end", headers=owner.headers)
    assert response.status_code == 202, response.text
    job_id = response.json()["jobId"]
    assert set(response.json()) == {"jobId"}

    meeting = await load_meeting(db_session, detail["id"])
    assert (meeting.status, meeting.integration_state, meeting.ai_headline) == ("generating", "running", None)
    job = await load_job(db_session, job_id)
    assert (job.kind, job.status, job.attempt, job.target_id) == ("meeting_finalize", "queued", 0, detail["id"])
    # 커밋 뒤 훅이 태스크를 띄운다 — 기록기가 받았다
    assert close_scope.job_ids == [job_id]

    body = (await client.get(f"{BASE}/{detail['id']}", headers=owner.headers)).json()
    assert [a["state"] for a in body["agendas"]["human"]] == ["done", None]  # active → done · 나머지 그대로
    assert body["activeJobId"] == job_id
    assert body["agendas"]["merged"] == [] and body["headline"] is None and body["mergedSummary"] is None


async def test_end_is_accepted_without_a_live_stream_and_rejected_outside_recording(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession
) -> None:
    """`paused/stream`(WS 없음) = 스트림 레지스트리에 세션이 없는 `recording` — 그대로 202. `scheduled`·`generating`·`ended` 는 409."""
    scheduled = await create_meeting(client, owner)
    response = await client.post(f"{BASE}/{scheduled['id']}/end", headers=owner.headers)
    assert (response.status_code, response.json()["code"]) == (409, "invalid_meeting_status")

    recording = await start_meeting(client, owner, **slot(2))
    from service import meeting_stream_service
    assert meeting_stream_service.is_active(recording["id"]) is False  # WS 가 없다
    assert (await client.post(f"{BASE}/{recording['id']}/end", headers=owner.headers)).status_code == 202
    # 이미 generating — 두 번째 /end 는 409
    again = await client.post(f"{BASE}/{recording['id']}/end", headers=owner.headers)
    assert (again.status_code, again.json()["code"]) == (409, "invalid_meeting_status")


async def test_end_of_a_strangers_meeting_is_404(
    client: AsyncClient, owner: MeetingOwner, stranger: MeetingOwner, db_session: AsyncSession
) -> None:
    detail = await start_meeting(client, owner)
    response = await client.post(f"{BASE}/{detail['id']}/end", headers=stranger.headers)
    assert (response.status_code, response.json()["code"]) == (404, "not_found")


# --- 파이프라인 성공 ----------------------------------------------------------------------


async def test_pipeline_success_fills_merged_headline_and_summary_with_human_text_intact(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """① → ② 성공 — `merged` 줄의 `content` 가 사람 줄과 **바이트 단위로 같고**, 근거는 AI 줄에서, `headline`·`mergedSummary` 가 같은 응답에 있다."""
    detail = await prepare_recording(client, owner, db_session)
    fake_agent.calls.clear()
    fake_agent.will_return(final_output(detail))
    fake_agent.will_answer(answer())
    job_id = await end_meeting(client, owner, detail["id"])
    await run_job(job_id)

    # 호출 둘 — ①(배치 스키마 · 300초) · ②(통합 스키마 · 180초) · 둘 다 웜스타트 세션 resume
    assert [(c.output_schema, c.timeout_sec, c.session_id) for c in fake_agent.calls] == [
        (Path(meeting_batch_service.OUTPUT_SCHEMA), 300, WARM_SESSION_ID),
        (Path(meeting_merge_service.OUTPUT_SCHEMA), 180, WARM_SESSION_ID),
    ]
    assert "sourceHumanLineId" in fake_agent.calls[1].prompt and "짝짓기" not in fake_agent.calls[0].prompt

    job = await load_job(db_session, job_id)
    assert (job.status, job.attempt, job.error_code, job.finished_at is not None) == ("succeeded", 1, None, True)

    body = (await client.get(f"{BASE}/{detail['id']}", headers=owner.headers)).json()
    assert (body["status"], body["integrationState"], body["activeJobId"]) == ("ended", "succeeded", None)
    assert body["headline"] == HEADLINE
    assert body["finalBatchState"] == "succeeded"
    assert body["mergedSummary"] == {
        "agendaCount": 3, "decisionCount": 1, "actionCount": 1,
        "integratedAt": body["mergedSummary"]["integratedAt"],
    }
    assert body["mergedSummary"]["integratedAt"] is not None

    merged = body["agendas"]["merged"]
    human = body["agendas"]["human"]
    ai = body["agendas"]["ai"]
    assert [(a["title"], a["state"], a["sourceAgendaId"]) for a in merged] == [
        ("첫째 안건", "done", human[0]["id"]), ("둘째 안건", None, human[1]["id"]), ("AI 신설 안건", None, ai[1]["id"]),
    ]
    first = merged[0]["lines"]
    human_a, human_b = human[0]["lines"]
    ai_a, ai_only = ai[0]["lines"]
    # 사람 줄 A — 글자 그대로 + AI 줄의 근거·상세 계승
    assert first[0]["content"].encode() == human_a["content"].encode()
    assert (first[0]["sourceHumanLineId"], first[0]["sourceAiLineId"]) == (human_a["id"], ai_a["id"])
    assert (first[0]["evidence"], first[0]["detail"]) == ([{"fromMs": 1000, "toMs": 5000}], "AI 가 붙인 상세")
    # 사람 줄 B — 짝 없음 · 종류 그대로
    assert (first[1]["content"], first[1]["kind"], first[1]["evidence"]) == (human_b["content"], "decision", [])
    assert (first[1]["sourceHumanLineId"], first[1]["sourceAiLineId"]) == (human_b["id"], None)
    # AI 전용 내용은 **추가로**
    assert (first[2]["content"], first[2]["kind"]) == ("AI 전용 — 후속 미팅은 9/12", "action")
    assert (first[2]["sourceHumanLineId"], first[2]["sourceAiLineId"]) == (None, ai_only["id"])
    assert [l["orderIndex"] for l in first] == [0, 1, 2]
    assert [l["content"] for l in merged[2]["lines"]] == ["AI 신설 안건의 논의"]
    # 사람 원본 · AI 트랙은 그대로 남아 있다(화면에 보이지 않을 뿐)
    assert len(human[0]["lines"]) == 2 and len(human[1]["lines"]) == 1 and len(ai) == 2

    runs = await _runs(db_session, detail["id"])
    assert [(r.phase, r.status, r.seq) for r in runs] == [("final", "succeeded", 1), ("integration", "succeeded", 1)]
    assert body["latestBatchSeq"] == 1  # 통합 행은 배치 회차에 세지 않는다


async def test_final_batch_replaces_the_ai_track_wholesale_only_after_validation(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """회의 중 증분 AI 줄이 있어도 ① 성공분이 **전량 교체**한다(M-7)."""
    detail = await prepare_recording(client, owner, db_session)
    # 회의 중 증분 배치 한 회차
    fake_agent.will_return(
        notes_output(
            [
                {
                    "humanAgendaId": detail["agendas"]["human"][0]["id"],
                    "title": "미러 안건",
                    "lines": [{"kind": "discussion", "content": "증분 AI 줄", "detail": None,
                               "evidence": [], "taskId": None, "payload": None}],
                }
            ]
        )
    )
    assert await meeting_batch_service.evaluate(detail["id"], "timer") is True
    _, before = await rows_by_track(db_session, detail["id"], "ai")
    assert [l.content for l in before] == ["증분 AI 줄"]

    fake_agent.will_return(final_output(detail))
    fake_agent.will_answer(answer())
    await run_job(await end_meeting(client, owner, detail["id"]))

    _, after = await rows_by_track(db_session, detail["id"], "ai")
    assert "증분 AI 줄" not in [l.content for l in after]
    assert len(after) == 3
    body = (await client.get(f"{BASE}/{detail['id']}", headers=owner.headers)).json()
    assert body["latestBatchSeq"] == 2 and body["finalBatchState"] == "succeeded"


# --- 실패 5종 → 3회 뒤 ended+failed · merged 0 · ai_headline NULL (BE §12 테스트 8) --------------------------


@pytest.mark.parametrize("mutate", [drop_one_human_line, duplicate_human_line, duplicate_ai_line, add_unreferenced_line, drop_headline, overlong_headline],
                         ids=["missing-human-line", "double-inheritance", "duplicate-ai-ref", "no-reference", "no-headline", "headline-201"])
async def test_each_structural_failure_counts_the_attempt_and_three_of_them_end_failed(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway, mutate
) -> None:
    detail = await prepare_recording(client, owner, db_session)
    fake_agent.will_return(final_output(detail))
    for _ in range(3):
        fake_agent.will_answer(answer(mutate=mutate))
    fake_agent.calls.clear()
    job_id = await end_meeting(client, owner, detail["id"])
    await run_job(job_id)

    assert len(fake_agent.calls) == 4  # ① 1 + ② 3
    job = await load_job(db_session, job_id)
    assert (job.status, job.attempt, job.error_code) == ("failed", 3, "integration_failed")
    assert job.error_message
    meeting = await load_meeting(db_session, detail["id"])
    assert (meeting.status, meeting.integration_state, meeting.ai_headline) == ("ended", "failed", None)
    _, merged = await rows_by_track(db_session, detail["id"], "merged")
    assert merged == []
    # 사람 줄 · AI 줄 · 트랜스크립트가 그대로 남는다
    _, human = await rows_by_track(db_session, detail["id"], "human")
    _, ai = await rows_by_track(db_session, detail["id"], "ai")
    blocks = await db_session.scalar(select(MeetingTranscript.id).where(MeetingTranscript.meeting_id == detail["id"]))
    assert len(human) == 3 and len(ai) == 3 and blocks is not None
    runs = await _runs(db_session, detail["id"])
    assert [(r.phase, r.status, r.seq) for r in runs] == [("final", "succeeded", 1), ("integration", "failed", 1), ("integration", "failed", 2), ("integration", "failed", 3)]

    body = (await client.get(f"{BASE}/{detail['id']}", headers=owner.headers)).json()
    assert (body["headline"], body["mergedSummary"], body["agendas"]["merged"], body["activeJobId"]) == (None, None, [], None)
    assert body["finalBatchState"] == "succeeded"


async def test_a_failed_attempt_followed_by_a_good_one_succeeds_on_attempt_two(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    detail = await prepare_recording(client, owner, db_session)
    fake_agent.will_return(final_output(detail))
    fake_agent.will_answer(answer(mutate=drop_one_human_line))
    fake_agent.will_answer(answer())
    job_id = await end_meeting(client, owner, detail["id"])
    await run_job(job_id)
    job = await load_job(db_session, job_id)
    assert (job.status, job.attempt) == ("succeeded", 2)
    assert (await load_meeting(db_session, detail["id"])).ai_headline == HEADLINE


async def test_all_timeouts_end_with_integration_timeout_and_a_mix_with_integration_failed(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    detail = await prepare_recording(client, owner, db_session)
    fake_agent.will_return(final_output(detail))
    for _ in range(3):
        fake_agent.will_raise(AgentRunTimeout("대역: 180초 초과"))
    job_id = await end_meeting(client, owner, detail["id"])
    await run_job(job_id)
    job = await load_job(db_session, job_id)
    assert (job.status, job.error_code) == ("failed", "integration_timeout")

    # 다시 생성: 타임아웃 2 + 워커 오류 1 → integration_failed
    fake_agent.will_raise(AgentRunTimeout("대역"))
    fake_agent.will_raise(AgentRunFailed("대역: 워커 오류"))
    fake_agent.will_raise(AgentRunTimeout("대역"))
    response = await client.post(f"{BASE}/{detail['id']}/integrate", headers=owner.headers)
    assert response.status_code == 202
    await run_job(response.json()["jobId"])
    assert (await load_job(db_session, response.json()["jobId"])).error_code == "integration_failed"


# --- ① 실패 → ② 로 -----------------------------------------------------------------------


@pytest.mark.parametrize("failure", [AgentRunFailed("대역: 워커 오류"), AgentRunTimeout("대역: 300초 초과"), "not json"],
                         ids=["worker-error", "timeout", "schema-violation"])
async def test_final_batch_failure_keeps_ai_lines_and_still_integrates(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway, failure
) -> None:
    """① 이 실패해도 AI 줄은 회의 중 상태 그대로이고 ② 로 넘어가 `succeeded` 가 된다. `finalBatchState='failed'`."""
    detail = await prepare_recording(client, owner, db_session)
    fake_agent.will_return(
        notes_output(
            [
                {
                    "humanAgendaId": detail["agendas"]["human"][0]["id"],
                    "title": "미러 안건",
                    "lines": [{"kind": "discussion", "content": "증분 AI 줄", "detail": None,
                               "evidence": [{"fromMs": 0, "toMs": 500}], "taskId": None, "payload": None}],
                }
            ]
        )
    )
    assert await meeting_batch_service.evaluate(detail["id"], "timer") is True
    _, before = await rows_by_track(db_session, detail["id"], "ai")

    fake_agent.will_return(failure) if isinstance(failure, str) else fake_agent.will_raise(failure)
    fake_agent.will_answer(answer())
    job_id = await end_meeting(client, owner, detail["id"])
    await run_job(job_id)

    _, after = await rows_by_track(db_session, detail["id"], "ai")
    assert [(l.id, l.content) for l in after] == [(l.id, l.content) for l in before]
    body = (await client.get(f"{BASE}/{detail['id']}", headers=owner.headers)).json()
    assert (body["status"], body["integrationState"], body["finalBatchState"]) == ("ended", "succeeded", "failed")
    assert body["headline"] == HEADLINE
    assert [l["content"] for l in body["agendas"]["merged"][0]["lines"]][-1] == "증분 AI 줄"  # 증분 AI 줄이 추가분으로 통합됐다
    runs = await _runs(db_session, detail["id"])
    assert runs[1].phase == "final" and runs[1].status in ("failed", "discarded") and runs[1].reason


# --- /integrate ----------------------------------------------------------------------


async def test_integrate_reruns_only_step_two_and_fills_the_headline_for_the_first_time(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    body, _ = await finalize_with_failure(client, owner, db_session, fake_agent)
    assert body["headline"] is None
    final_runs_before = len([r for r in await _runs(db_session, body["id"]) if r.phase == "final"])
    fake_agent.calls.clear()

    fake_agent.will_answer(answer())
    response = await client.post(f"{BASE}/{body['id']}/integrate", headers=owner.headers)
    assert response.status_code == 202, response.text
    job_id = response.json()["jobId"]
    meeting = await load_meeting(db_session, body["id"])
    assert (meeting.status, meeting.integration_state) == ("generating", "running")
    await run_job(job_id)

    assert [c.output_schema for c in fake_agent.calls] == [Path(meeting_merge_service.OUTPUT_SCHEMA)]  # ② 만
    assert len([r for r in await _runs(db_session, body["id"]) if r.phase == "final"]) == final_runs_before
    after = (await client.get(f"{BASE}/{body['id']}", headers=owner.headers)).json()
    assert (after["status"], after["integrationState"], after["headline"]) == ("ended", "succeeded", HEADLINE)
    assert len(after["agendas"]["merged"]) == 3

    # 성공분에 /integrate → 409 · 재생성 없음
    again = await client.post(f"{BASE}/{body['id']}/integrate", headers=owner.headers)
    assert (again.status_code, again.json()["code"]) == (409, "invalid_meeting_status")


async def test_integrate_is_rejected_unless_ended_and_failed(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession
) -> None:
    scheduled = await create_meeting(client, owner)
    assert (await client.post(f"{BASE}/{scheduled['id']}/integrate", headers=owner.headers)).status_code == 409
    recording = await start_meeting(client, owner, **slot(2))
    assert (await client.post(f"{BASE}/{recording['id']}/integrate", headers=owner.headers)).status_code == 409
    await client.post(f"{BASE}/{recording['id']}/end", headers=owner.headers)  # generating
    assert (await client.post(f"{BASE}/{recording['id']}/integrate", headers=owner.headers)).status_code == 409


async def test_integrate_uses_the_edited_human_track(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """실패 상태에서 사람 줄을 고치고 지운 뒤 「다시 생성」 — 통합본에 **고친 문장**이 그대로 있고 지운 줄은 없다(SPEC-008 S-2)."""
    body, _ = await finalize_with_failure(client, owner, db_session, fake_agent)
    human = body["agendas"]["human"]
    line_a, line_b = human[0]["lines"]
    edited = await client.patch(f"{BASE}/{body['id']}/lines/{line_a['id']}", json={"content": "고친 사람 줄 A"}, headers=owner.headers)
    assert edited.status_code == 200, edited.text
    assert (await client.delete(f"{BASE}/{body['id']}/lines/{line_b['id']}", headers=owner.headers)).status_code == 204

    fake_agent.will_answer(answer())
    response = await client.post(f"{BASE}/{body['id']}/integrate", headers=owner.headers)
    await run_job(response.json()["jobId"])
    after = (await client.get(f"{BASE}/{body['id']}", headers=owner.headers)).json()
    contents = [l["content"] for a in after["agendas"]["merged"] for l in a["lines"]]
    assert "고친 사람 줄 A" in contents and line_b["content"] not in contents


# --- 정적 검사 (WP Phase 1) --------------------------------------------------------------------

BACK = Path(__file__).resolve().parents[1]


def test_static_merge_service_reads_only_four_model_fields() -> None:
    """모델 출력에서 읽는 필드가 `agendaRef` · `humanAgendaId` · `aiAgendaId` · `sourceHumanLineId` · `sourceAiLineId` · `headline` 뿐이다 —
    `content`·`kind`·`detail`·`evidence`·`taskId` 를 **모델 출력 dict 에서** 읽는 코드가 0건이다."""
    import re

    text = (BACK / "service" / "meeting_merge_service.py").read_text(encoding="utf-8")
    keys = sorted(set(re.findall(r'\["(\w+)"\]', text)))
    assert keys == ["agendaRef", "agendas", "aiAgendaId", "headline", "humanAgendaId", "lines", "sourceAiLineId", "sourceHumanLineId"], keys
    schema = json.loads((BACK / "ai_schemas" / "meeting_integration.json").read_text(encoding="utf-8"))
    line_props = schema["properties"]["agendas"]["items"]["properties"]["lines"]["items"]["properties"]
    assert set(line_props) == {"sourceHumanLineId", "sourceAiLineId"}
    assert schema["properties"]["agendas"]["items"]["properties"]["lines"]["items"]["additionalProperties"] is False


def test_static_ai_headline_is_written_from_the_finalize_service_only() -> None:
    writers = []
    for path in BACK.rglob("*.py"):
        if ".venv" in path.parts or "tests" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        if "headline=" in text and "finish_integration(" in text and path.parts[-2] == "service":
            writers.append(path.relative_to(BACK).as_posix())
        if "ai_headline=" in text and path.parts[-2] != "repository" and "models" not in path.parts:
            writers.append(path.relative_to(BACK).as_posix())
    assert writers == ["service/meeting_finalize_service.py"], writers
    # 별도 엔드포인트가 없다
    router = (BACK / "api" / "meeting_router.py").read_text(encoding="utf-8")
    assert "headline" not in router.lower().replace("한 줄 요약", "")


def test_static_end_has_no_stream_condition_and_no_broad_except() -> None:
    finalize = (BACK / "service" / "meeting_finalize_service.py").read_text(encoding="utf-8")
    assert "is_active(" not in finalize  # 「WS 연결 있음」 조건이 없다
    assert "meeting_stream_disconnected" not in finalize
    for name in ("meeting_finalize_service.py", "meeting_merge_service.py", "meeting_edit_service.py", "job_service.py", "meeting_batch_service.py"):
        text = (BACK / "service" / name).read_text(encoding="utf-8")
        assert "except Exception" not in text and "except BaseException" not in text, name
    for name in ("job_repository.py", "meeting_line_repository.py"):
        assert "except Exception" not in (BACK / "repository" / name).read_text(encoding="utf-8")


# --- 살아 있는 스트림이 있을 때의 /end — WS 닫기(1000) 요청 · 업스트림 닫힘 ----------------------------------


async def test_end_with_a_live_stream_closes_it_with_1000_and_still_returns_202(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_stt
) -> None:
    """WS 가 열려 있으면 서버가 `1000 meeting_ended` 로 닫고, `serve()` 의 `finally` 가 업스트림을 닫는다. 종료는 그와 무관하게 202 다."""
    import asyncio

    from dto.meeting_stream import ReadyFrame
    from service import meeting_stream_service
    from tests.fakes.stream_client import FakeStreamClient
    from tests.meeting_live_fixtures import AUDIO

    detail = await prepare_recording(client, owner, db_session)
    stream_client = FakeStreamClient()
    serving = asyncio.create_task(
        meeting_stream_service.serve(stream_client, account_id=owner.id, meeting_id=detail["id"], audio=AUDIO)
    )
    await stream_client.wait_for(lambda: bool(stream_client.frames(ReadyFrame)))
    assert meeting_stream_service.is_active(detail["id"]) is True

    response = await client.post(f"{BASE}/{detail['id']}/end", headers=owner.headers)
    assert response.status_code == 202, response.text
    await asyncio.wait_for(serving, timeout=3)

    assert stream_client.closed == (meeting_stream_service.CLOSE_ENDED, meeting_stream_service.REASON_ENDED)
    assert meeting_stream_service.is_active(detail["id"]) is False
    assert fake_stt.sessions and all(session._closed.is_set() for session in fake_stt.sessions)  # 업스트림이 닫혔다
