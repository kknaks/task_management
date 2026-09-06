"""WORK-007 Phase 4 — 배치 트리거 3종 · 단일 실행 · 검증 4단 · 즉시 push. **BE §12 필수 테스트 6·7 이 여기다.**

정본: SPEC-007 §4 「AI 배치 계약」 · DEC-003 §7 · BE §8-3. 대역 `agent` 로 정상 / 스키마 위반 / 타임아웃 / 프로토콜 오류를 낸다.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dto.enums import MeetingTrack
from dto.meeting_stream import AiBatchFrame, ReadyFrame
from integrations.agent import AgentRunResult
from models.meeting import MeetingAgenda, MeetingBatchRun, MeetingLine
from service import meeting_batch_service, meeting_stream_service
from tests.fakes.agent import WARM_SESSION_ID, FakeAgentGateway
from tests.fakes.stream_client import FakeStreamClient
from tests.meeting_fixtures import BASE, MeetingOwner, get_detail, owner  # noqa: F401
from tests.meeting_live_fixtures import (  # noqa: F401
    AUDIO,
    add_block,
    add_task,
    live_scope,
    start_meeting,
)

pytestmark = pytest.mark.usefixtures("live_scope")

TRANSCRIPT = "transcript"
AGENDA_SWITCH = "agenda_switch"
TIMER = "timer"


def _item(agenda: dict, *, kind: str = "discussion", content: str = "요약 줄", task_id: int | None = None,
          detail: str | None = "상세", evidence: list | None = None) -> dict:
    return {
        "agenda": {"humanAgendaId": None, "aiAgendaId": None, "newTitle": None, **agenda},
        "kind": kind,
        "content": content,
        "detail": detail,
        "evidence": [{"fromMs": 0, "toMs": 500}] if evidence is None else evidence,
        "taskId": task_id,
    }


async def _runs(session: AsyncSession, meeting_id: int) -> list[MeetingBatchRun]:
    return list(
        (await session.scalars(select(MeetingBatchRun).where(MeetingBatchRun.meeting_id == meeting_id).order_by(MeetingBatchRun.id))).all()
    )


async def _ai_rows(session: AsyncSession, meeting_id: int) -> tuple[list[MeetingAgenda], list[MeetingLine]]:
    agendas = (await session.scalars(select(MeetingAgenda).where(MeetingAgenda.meeting_id == meeting_id, MeetingAgenda.track == MeetingTrack.AI.value).order_by(MeetingAgenda.id))).all()
    lines = (await session.scalars(select(MeetingLine).where(MeetingLine.meeting_id == meeting_id, MeetingLine.track == MeetingTrack.AI.value).order_by(MeetingLine.id))).all()
    return list(agendas), list(lines)


# --- 트리거 3종 · 단일 실행 --------------------------------------------------------------


async def test_600_chars_fire_exactly_one_batch_on_the_warm_session(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    detail = await start_meeting(client, owner)
    fake_agent.calls.clear()
    await add_block(db_session, detail["id"], content="가" * 599)

    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is False
    assert fake_agent.calls == []
    assert meeting_batch_service.is_timer_armed(detail["id"])  # 미처리가 생겼으니 상한 타이머

    await add_block(db_session, detail["id"], content="나", at_ms=2000)
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True
    assert len(fake_agent.calls) == 1
    call = fake_agent.calls[0]
    assert call.session_id == WARM_SESSION_ID
    assert call.output_schema == Path(meeting_batch_service.OUTPUT_SCHEMA) and call.timeout_sec == 120

    runs = await _runs(db_session, detail["id"])
    assert [(run.status, run.seq) for run in runs] == [("succeeded", 1)]
    assert not meeting_batch_service.is_timer_armed(detail["id"])  # 미처리 0 → 타이머 없음


async def test_agenda_switch_fires_at_80_chars_not_79(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    detail = await start_meeting(client, owner)
    fake_agent.calls.clear()
    await add_block(db_session, detail["id"], content="가" * 79)
    assert await meeting_batch_service.evaluate(detail["id"], AGENDA_SWITCH) is False
    assert fake_agent.calls == []

    await add_block(db_session, detail["id"], content="나", at_ms=2000)
    assert await meeting_batch_service.evaluate(detail["id"], AGENDA_SWITCH) is True
    assert len(fake_agent.calls) == 1


async def test_timer_fires_only_when_something_is_pending(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    detail = await start_meeting(client, owner)
    fake_agent.calls.clear()
    assert await meeting_batch_service.evaluate(detail["id"], TIMER) is False
    assert fake_agent.calls == []

    await add_block(db_session, detail["id"], content="가" * 100)
    assert await meeting_batch_service.evaluate(detail["id"], TIMER) is True
    assert len(fake_agent.calls) == 1


async def test_no_concurrent_batches_and_the_next_one_merges_both_ranges(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """실행 중 600자 트리거 → 동시 실행 0. 끝난 뒤 다음 트리거에서 두 구간이 **한 배치**로."""
    detail = await start_meeting(client, owner)
    fake_agent.calls.clear()
    first = await add_block(db_session, detail["id"], content="가" * 600)

    gate = asyncio.Event()

    class BlockingGateway(FakeAgentGateway):
        async def run(self, **kwargs):  # type: ignore[no-untyped-def]
            self.calls.append(kwargs)  # type: ignore[arg-type]
            await gate.wait()
            return AgentRunResult(session_id=WARM_SESSION_ID, output=json.dumps({"items": []}))

    blocking = BlockingGateway()
    from integrations import agent as agent_integration

    agent_integration.install_gateway(blocking)
    running = asyncio.create_task(meeting_batch_service.evaluate(detail["id"], TRANSCRIPT))
    await asyncio.sleep(0.02)
    assert len(blocking.calls) == 1

    second = await add_block(db_session, detail["id"], content="나" * 600, at_ms=3000)
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is False  # 실행 중 — 무시
    assert len(blocking.calls) == 1

    gate.set()
    assert await running is True
    runs = await _runs(db_session, detail["id"])
    assert [(run.status, run.from_transcript_id, run.to_transcript_id) for run in runs] == [("succeeded", first, first)]

    third = await add_block(db_session, detail["id"], content="다", at_ms=6000)
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True
    runs = await _runs(db_session, detail["id"])
    assert (runs[-1].from_transcript_id, runs[-1].to_transcript_id) == (second, third)
    assert len(blocking.calls) == 2


# --- BE §12 테스트 6 · 7 ------------------------------------------------------------------


async def test_schema_violation_discards_the_whole_batch(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """**BE §12 테스트 6** — 잘못된 JSON 이면 `meeting_line`·`meeting_agenda(ai)` 행 0 · `discarded` · 다음 배치에 그 구간 포함."""
    detail = await start_meeting(client, owner)
    human_id = detail["agendas"]["human"][0]["id"]
    fake_agent.calls.clear()
    first = await add_block(db_session, detail["id"], content="가" * 600)

    # 첫 항목은 멀쩡하고 둘째가 틀렸다 — 부분 파싱이 없으니 첫 항목도 들어가지 않는다
    fake_agent.will_return({"items": [_item({"humanAgendaId": human_id}), _item({"humanAgendaId": human_id}, kind="memo")]})
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True
    agendas, lines = await _ai_rows(db_session, detail["id"])
    assert agendas == [] and lines == []
    runs = await _runs(db_session, detail["id"])
    assert [run.status for run in runs] == ["discarded"] and runs[0].reason

    for bad in ("not json at all", json.dumps({"items": [{"agenda": {}}]}), json.dumps({"items": [_item({})]}),
                json.dumps({"items": [_item({"humanAgendaId": 999_999})]}),
                json.dumps({"items": [_item({"humanAgendaId": human_id}, evidence=[{"fromMs": 0, "toMs": 99_999}])]})):
        fake_agent.will_return(bad)
        assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True
    agendas, lines = await _ai_rows(db_session, detail["id"])
    assert agendas == [] and lines == []
    assert all(run.status == "discarded" for run in await _runs(db_session, detail["id"]))

    second = await add_block(db_session, detail["id"], content="나", at_ms=3000)
    fake_agent.will_return({"items": [_item({"humanAgendaId": human_id})]})
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True
    succeeded = [run for run in await _runs(db_session, detail["id"]) if run.status == "succeeded"]
    assert [(run.from_transcript_id, run.to_transcript_id, run.seq) for run in succeeded] == [(first, second, 1)]
    prompt = fake_agent.calls[-1].prompt
    assert f'"id": {first}' in prompt and f'"id": {second}' in prompt  # 폐기 구간이 다음 배치 입력에 들어갔다


async def test_task_outside_the_whitelist_is_demoted_to_action_keeping_its_body(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """**BE §12 테스트 7** — 화이트리스트 밖 `taskId` 줄은 `kind='action'`·`task_id=NULL` 로 들어가고 본문·상세·근거가 남는다."""
    detail = await start_meeting(client, owner, projectId=owner.project_id)
    human_id = detail["agendas"]["human"][0]["id"]
    inside = await add_task(db_session, owner, title="소개서 v2 문구 정리", project_id=owner.project_id)
    outside = await add_task(db_session, owner, title="다른 프로젝트 업무", project_id=None)
    await add_block(db_session, detail["id"], content="가" * 600)
    fake_agent.calls.clear()

    fake_agent.will_return({"items": [
        _item({"humanAgendaId": human_id}, kind="task", content="안쪽 업무 기한을 당긴다", task_id=inside),
        _item({"humanAgendaId": human_id}, kind="task", content="바깥 업무를 참조했다", task_id=outside, detail="바깥 상세",
              evidence=[{"fromMs": 100, "toMs": 900}]),
        _item({"humanAgendaId": human_id}, kind="task", content="업무 없는 업무 줄", task_id=None),
        _item({"humanAgendaId": human_id}, kind="decision", content="결정에 붙은 taskId 는 뗀다", task_id=inside),
    ]})
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True

    assert f'"taskWhitelist": [\n    {inside}\n  ]' in fake_agent.calls[-1].prompt
    _, lines = await _ai_rows(db_session, detail["id"])
    assert [(line.kind, line.task_id) for line in lines] == [
        ("task", inside), ("action", None), ("action", None), ("decision", None),
    ]
    demoted = lines[1]
    assert (demoted.content, demoted.detail, demoted.evidence) == ("바깥 업무를 참조했다", "바깥 상세", [{"fromMs": 100, "toMs": 900}])

    body = await get_detail(client, owner, detail["id"])
    ai_lines = body["agendas"]["ai"][0]["lines"]
    assert ai_lines[0]["task"]["title"] == "소개서 v2 문구 정리"
    assert ai_lines[1]["kind"] == "action" and ai_lines[1]["taskId"] is None
    assert body["latestBatchSeq"] == 1


# --- 실패 1단 · 프로토콜 오류 ---------------------------------------------------------------


async def test_worker_timeout_is_failed_silently_and_merged_into_the_next_batch(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    detail = await start_meeting(client, owner)
    human_id = detail["agendas"]["human"][0]["id"]
    first = await add_block(db_session, detail["id"], content="가" * 600)

    fake_agent.will_timeout()
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True
    fake_agent.will_fail()
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True
    runs = await _runs(db_session, detail["id"])
    assert [run.status for run in runs] == ["failed", "failed"]
    assert (await get_detail(client, owner, detail["id"]))["latestBatchSeq"] == 0  # 사용자 표시 없음

    second = await add_block(db_session, detail["id"], content="나", at_ms=3000)
    fake_agent.will_return({"items": [_item({"humanAgendaId": human_id})]})
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True
    last = (await _runs(db_session, detail["id"]))[-1]
    assert (last.status, last.from_transcript_id, last.to_transcript_id, last.seq) == ("succeeded", first, second, 1)


async def test_protocol_errors_propagate_without_a_failed_row(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """정의 밖 예외(프로토콜 오류)는 잡지 않는다 — 전파되고 `batch_run` 에 `failed` 가 남지 않는다."""
    detail = await start_meeting(client, owner)
    await add_block(db_session, detail["id"], content="가" * 600)
    fake_agent.will_raise(RuntimeError("broker protocol error"))
    with pytest.raises(RuntimeError, match="broker protocol error"):
        await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT)
    assert await _runs(db_session, detail["id"]) == []


# --- 적재 4단 · push ------------------------------------------------------------------


async def test_mirrored_ai_agenda_is_created_once_and_new_titles_have_no_source(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    detail = await start_meeting(client, owner)
    human_id = detail["agendas"]["human"][0]["id"]
    await add_block(db_session, detail["id"], content="가" * 600)
    fake_agent.will_return({"items": [
        _item({"humanAgendaId": human_id}, content="첫째"),
        _item({"humanAgendaId": human_id}, content="둘째"),
        _item({"newTitle": "경쟁사 요금제 비교"}, content="셋째"),
        _item({"newTitle": "경쟁사 요금제 비교"}, content="넷째"),
    ]})
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True
    agendas, lines = await _ai_rows(db_session, detail["id"])
    assert [(agenda.title, agenda.source_agenda_id, agenda.state) for agenda in agendas] == [
        ("첫째 안건", human_id, None), ("경쟁사 요금제 비교", None, None),
    ]
    assert [(line.agenda_id, line.order_index) for line in lines] == [
        (agendas[0].id, 0), (agendas[0].id, 1), (agendas[1].id, 0), (agendas[1].id, 1),
    ]

    await add_block(db_session, detail["id"], content="나" * 600, at_ms=3000)
    fake_agent.will_return({"items": [
        _item({"humanAgendaId": human_id}, content="다섯째"),
        _item({"aiAgendaId": agendas[1].id}, content="여섯째"),
    ]})
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True
    agendas_after, lines_after = await _ai_rows(db_session, detail["id"])
    assert len(agendas_after) == 2  # 미러 안건은 재사용 — 두 번째 배치가 또 만들지 않는다
    assert [line.content for line in lines_after[:4]] == ["첫째", "둘째", "셋째", "넷째"]  # 기존 AI 줄 그대로(M-7)
    assert [(line.content, line.agenda_id) for line in lines_after[4:]] == [("다섯째", agendas[0].id), ("여섯째", agendas[1].id)]
    assert (await get_detail(client, owner, detail["id"]))["latestBatchSeq"] == 2


async def test_successful_batch_is_pushed_right_after_commit(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """WS 클라이언트가 `ai.batch{seq}` 를 커밋 직후 받는다 — 새로 생긴 안건·줄만. 세션이 없으면 예외 없이 건너뛴다."""
    detail = await start_meeting(client, owner)
    human_id = detail["agendas"]["human"][0]["id"]
    await add_block(db_session, detail["id"], content="가" * 600)
    monkeypatch.setattr(meeting_batch_service, "schedule", lambda *_: None)

    fake_client = FakeStreamClient()
    stream = asyncio.create_task(
        meeting_stream_service.serve(fake_client, account_id=owner.id, meeting_id=detail["id"], audio=AUDIO)
    )
    await fake_client.wait_for(lambda: bool(fake_client.frames(ReadyFrame)))

    fake_agent.will_return({"items": [_item({"humanAgendaId": human_id}, content="push 된 줄")]})
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True
    await fake_client.wait_for(lambda: bool(fake_client.frames(AiBatchFrame)))
    frame = fake_client.frames(AiBatchFrame)[0]
    assert frame.seq == 1
    assert [agenda.source_agenda_id for agenda in frame.agendas] == [human_id]
    assert [line.content for line in frame.lines] == ["push 된 줄"] and frame.lines[0].track == "ai"

    fake_client.disconnect()
    await asyncio.wait_for(stream, timeout=3)

    await add_block(db_session, detail["id"], content="나" * 600, at_ms=3000)
    fake_agent.will_return({"items": [_item({"humanAgendaId": human_id}, content="세션 없이")]})
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True  # 건너뛰되 예외 없음
    assert (await get_detail(client, owner, detail["id"]))["latestBatchSeq"] == 2


async def test_batch_input_carries_human_context_read_only(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """사람 안건·사람 줄이 **읽기 전용 컨텍스트**로 들어가고, 배치는 사람 트랙에 아무것도 쓰지 않는다(M-6)."""
    detail = await start_meeting(client, owner)
    human_id = detail["agendas"]["human"][0]["id"]
    line = await client.post(
        f"{BASE}/{detail['id']}/lines",
        json={"agendaId": human_id, "kind": "decision", "content": "사람이 적은 결정"},
        headers=owner.headers,
    )
    assert line.status_code == 201
    await add_block(db_session, detail["id"], content="가" * 600)
    fake_agent.calls.clear()
    fake_agent.will_return({"items": [_item({"humanAgendaId": human_id})]})
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True

    prompt = fake_agent.calls[-1].prompt
    assert "사람이 적은 결정" in prompt and "첫째 안건" in prompt

    body = await get_detail(client, owner, detail["id"])
    human_lines = body["agendas"]["human"][0]["lines"]
    assert [line["content"] for line in human_lines] == ["사람이 적은 결정"]
    assert all(agenda["track"] == "ai" for agenda in body["agendas"]["ai"])
