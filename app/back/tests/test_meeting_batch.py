"""WORK-011 — 배치 입력은 발화뿐 · 검증 0~5 · AI 트랙 전량 교체. **BE §12 필수 테스트 6 · 7 · 7-a 가 여기다.**

정본: SPEC-007 §4 「AI 배치 계약」(배치 입력 표 · 배치 출력 · 검증 순서 0~5 · `ai.batch`) · §5 · DEC-003 §7 ·
BE §8-3 · M-6 · M-7 · M-15 · M-16 · MF-49 · 50 · 51 · 52 · 53.
대역 `agent` 로 정상 / 스키마 위반 / 타임아웃 / 프로토콜 오류를 낸다.
"""

from __future__ import annotations

import asyncio
import json
import logging
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
from tests.meeting_close_fixtures import payload
from tests.meeting_fixtures import BASE, MeetingOwner, get_detail, owner  # noqa: F401
from tests.meeting_live_fixtures import (  # noqa: F401
    AUDIO,
    add_block,
    add_task,
    batch_log,
    live_scope,
    start_meeting,
)

pytestmark = pytest.mark.usefixtures("live_scope")

TRANSCRIPT = "transcript"
AGENDA_SWITCH = "agenda_switch"
TIMER = "timer"

# MF-49 — 트리거 ①. 이 파일이 「배치가 돈다」를 만들 때 쓰는 최소 분량
FIRE = 1000


def _line(*, kind: str = "discussion", content: str = "요약 줄", task_id: int | None = None,
          detail: str | None = "상세", evidence: list | None = None) -> dict:
    """`meeting_notes.json` 의 줄 하나 — `payload` 는 회의 중 언제나 `null` 이다(MF-52)."""
    return {
        "kind": kind,
        "content": content,
        "detail": detail,
        "evidence": [{"fromMs": 0, "toMs": 500}] if evidence is None else evidence,
        "taskId": task_id,
        "payload": None,
    }


def _agenda(*, human_agenda_id: int | None = None, title: str = "안건", lines: list | None = None) -> dict:
    return {
        "humanAgendaId": human_agenda_id,
        "title": title,
        "lines": [_line()] if lines is None else lines,
    }


def _notes(agendas: list[dict], *, headline: object = None, term_corrections: object = None) -> dict:
    """최상위 — 출력은 **AI 트랙 전체**다(MF-53)."""
    return {"headline": headline, "termCorrections": term_corrections, "agendas": agendas}


async def _runs(session: AsyncSession, meeting_id: int) -> list[MeetingBatchRun]:
    return list(
        (await session.scalars(select(MeetingBatchRun).where(MeetingBatchRun.meeting_id == meeting_id).order_by(MeetingBatchRun.id))).all()
    )


async def _ai_rows(session: AsyncSession, meeting_id: int) -> tuple[list[MeetingAgenda], list[MeetingLine]]:
    agendas = (await session.scalars(select(MeetingAgenda).where(MeetingAgenda.meeting_id == meeting_id, MeetingAgenda.track == MeetingTrack.AI.value).order_by(MeetingAgenda.id))).all()
    lines = (await session.scalars(select(MeetingLine).where(MeetingLine.meeting_id == meeting_id, MeetingLine.track == MeetingTrack.AI.value).order_by(MeetingLine.id))).all()
    return list(agendas), list(lines)


# --- 트리거 3종 · 단일 실행 --------------------------------------------------------------


async def test_1000_chars_fire_exactly_one_batch_on_the_warm_session(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """**MF-49 — 경계는 1000자다.** 999 에서는 안 돌고 1000 에서 돈다."""
    detail = await start_meeting(client, owner)
    fake_agent.calls.clear()
    await add_block(db_session, detail["id"], content="가" * (FIRE - 1))

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
    """실행 중 트리거 → 동시 실행 0. 끝난 뒤 다음 트리거에서 두 구간이 **한 배치**로."""
    detail = await start_meeting(client, owner)
    fake_agent.calls.clear()
    first = await add_block(db_session, detail["id"], content="가" * FIRE)

    gate = asyncio.Event()

    class BlockingGateway(FakeAgentGateway):
        async def run(self, **kwargs):  # type: ignore[no-untyped-def]
            self.calls.append(kwargs)  # type: ignore[arg-type]
            await gate.wait()
            return AgentRunResult(session_id=WARM_SESSION_ID, output=json.dumps(_notes([])))

    blocking = BlockingGateway()
    from integrations import agent as agent_integration

    agent_integration.install_gateway(blocking)
    running = asyncio.create_task(meeting_batch_service.evaluate(detail["id"], TRANSCRIPT))
    await asyncio.sleep(0.02)
    assert len(blocking.calls) == 1

    second = await add_block(db_session, detail["id"], content="나" * FIRE, at_ms=3000)
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


# --- 검증 0 — 세션이 없으면 조용히 미제출 -------------------------------------------------


async def test_no_ai_session_means_no_submission_and_no_record(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway,
    batch_log: pytest.LogCaptureFixture,
) -> None:
    """**검증 0**(SPEC-007 §4) — `ai_session_id` 가 없으면 **제출하지 않는다.**

    구간은 미처리로 남고(다음 트리거 때 다시 평가) 화면 표시도 `meeting_batch_run` 행도 없다. 로그 한 줄뿐이다.
    """
    detail = await start_meeting(client, owner)
    await db_session.execute(
        MeetingAgenda.__table__.metadata.tables["meeting"].update()
        .where(MeetingAgenda.__table__.metadata.tables["meeting"].c.id == detail["id"])
        .values(ai_session_id=None)
    )
    await db_session.flush()
    fake_agent.calls.clear()
    await add_block(db_session, detail["id"], content="가" * FIRE)

    batch_log.set_level(logging.INFO, logger="service.meeting_batch_service")
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True

    assert fake_agent.calls == []
    assert await _runs(db_session, detail["id"]) == []
    assert "AI 세션이 없어" in batch_log.text
    # 구간이 남았으니 세션이 생기면 그대로 나간다
    assert await meeting_batch_service._pending_chars(detail["id"]) >= FIRE


# --- 배치 입력 — 발화뿐이다 (MF-50) -------------------------------------------------------


@pytest.mark.parametrize("needle", ["humanAgendas", "humanLines", "aiAgendas", "taskWhitelist"])
async def test_the_batch_prompt_carries_no_context(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway,
    needle: str,
) -> None:
    """안건 · 사람 줄 · AI 안건 · 화이트리스트를 **싣지 않는다** — AI 가 도구로 조회한다."""
    detail = await start_meeting(client, owner)
    human_id = detail["agendas"]["human"][0]["id"]
    await client.post(
        f"{BASE}/{detail['id']}/lines",
        json={"agendaId": human_id, "kind": "decision", "content": "사람이 적은 결정"},
        headers=owner.headers,
    )
    await add_task(db_session, owner, title="업무 제목이 새면 안 된다", project_id=None)
    await add_block(db_session, detail["id"], content="가" * FIRE)
    fake_agent.calls.clear()
    fake_agent.will_return(_notes([_agenda(human_agenda_id=human_id)]))
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True

    assert needle not in fake_agent.calls[-1].prompt


async def test_the_batch_prompt_leaks_no_agenda_or_task_titles(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """안건 제목 · 사람 줄 본문 · 업무 제목이 프롬프트에 **0건**이다. 발화만 있다."""
    detail = await start_meeting(client, owner)
    human_id = detail["agendas"]["human"][0]["id"]
    await client.post(
        f"{BASE}/{detail['id']}/lines",
        json={"agendaId": human_id, "kind": "decision", "content": "사람이 적은 결정"},
        headers=owner.headers,
    )
    await add_task(db_session, owner, title="업무 제목이 새면 안 된다", project_id=None)
    await add_block(db_session, detail["id"], content="발화 내용이다 " + "가" * FIRE)
    fake_agent.calls.clear()
    fake_agent.will_return(_notes([_agenda(human_agenda_id=human_id)]))
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True

    prompt = fake_agent.calls[-1].prompt
    assert "첫째 안건" not in prompt and "둘째 안건" not in prompt
    assert "사람이 적은 결정" not in prompt
    assert "업무 제목이 새면 안 된다" not in prompt
    assert "발화 내용이다" in prompt  # 실리는 것은 이것뿐이다


async def test_the_batch_prompt_tells_the_ai_to_split_the_agendas_alone(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """**MF-71** — 회의 중 프롬프트에 **안건 도구가 한 글자도 없다.** 남는 조회는 업무 셋뿐이다.

    사람이 적은 것을 보지 말라고 「말하는」 것이 아니라 **도구를 안 주는** 것이 잠금이고(옵션 빌더 `phase`),
    프롬프트는 그것과 어긋나지 않아야 한다 — 없는 도구를 부르라고 적으면 AI 가 헤맨다.
    """
    detail = await start_meeting(client, owner)
    await add_block(db_session, detail["id"], content="가" * FIRE)
    fake_agent.calls.clear()
    fake_agent.will_return(_notes([]))
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True

    call = fake_agent.calls[-1]
    prompt = call.prompt
    # 잠금과 프롬프트가 같은 말을 한다 — 이 제출은 `batch` 단계로 나갔다
    assert call.phase == "batch"
    for banned in ("list_agendas", "get_agenda"):
        assert banned not in prompt, banned
    assert "조회" in prompt and "list_tasks" in prompt  # 업무 셋은 남는다
    order = [prompt.index(name) for name in ("list_tasks", "get_task", "list_work_types")]
    assert order == sorted(order)
    # 계약 문장(MF-53)은 그대로다
    assert "AI 트랙 전체를 다시 정리해라" in prompt
    assert "안건은 발화만 보고 네가 가른다" in prompt
    # 미러 지시가 사라졌다 — humanAgendaId 는 회의 중에 쓰지 않는다
    assert "미러" not in prompt
    # 초안 §B 의 「새로 드러난 것만」은 계약에 졌다(WP §Open Issues)
    assert "추가할 줄" not in prompt


# --- BE §12 테스트 6 — 스키마 위반 전체 폐기 -----------------------------------------------


async def test_schema_violation_discards_the_whole_batch(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """**BE §12 테스트 6** — 잘못된 JSON 이면 행 0 · `discarded` · 다음 배치에 그 구간 포함(M-16)."""
    detail = await start_meeting(client, owner)
    human_id = detail["agendas"]["human"][0]["id"]
    fake_agent.calls.clear()
    first = await add_block(db_session, detail["id"], content="가" * FIRE)

    # 첫 안건은 멀쩡하고 둘째가 틀렸다 — 부분 파싱이 없으니 첫 안건도 들어가지 않는다
    fake_agent.will_return(
        _notes([_agenda(human_agenda_id=human_id), _agenda(lines=[_line(kind="memo")])])
    )
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True
    agendas, lines = await _ai_rows(db_session, detail["id"])
    assert agendas == [] and lines == []
    runs = await _runs(db_session, detail["id"])
    assert [run.status for run in runs] == ["discarded"] and runs[0].reason

    for bad in (
        "not json at all",
        json.dumps({"agendas": []}),  # headline · termCorrections 누락
        json.dumps(_notes([{"humanAgendaId": None, "title": "제목만"}])),  # lines 누락
        json.dumps(_notes([_agenda(lines=[_line(evidence=[{"fromMs": 0, "toMs": 99_999}])])])),  # 구간 밖
        json.dumps(_notes([_agenda(title="")])),  # 제목 길이
    ):
        fake_agent.will_return(bad)
        assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True
    agendas, lines = await _ai_rows(db_session, detail["id"])
    assert agendas == [] and lines == []
    assert all(run.status == "discarded" for run in await _runs(db_session, detail["id"]))

    second = await add_block(db_session, detail["id"], content="나", at_ms=3000)
    fake_agent.will_return(_notes([_agenda(human_agenda_id=human_id)]))
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True
    succeeded = [run for run in await _runs(db_session, detail["id"]) if run.status == "succeeded"]
    assert [(run.from_transcript_id, run.to_transcript_id, run.seq) for run in succeeded] == [(first, second, 1)]


async def test_a_human_agenda_id_is_ignored_instead_of_discarding_the_batch(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """**BE §12 6 확장**(MF-71 · SPEC-007 §4 검증 2) — `humanAgendaId` 가 실려 와도 **폐기가 아니다.**

    스키마 파일은 한 벌이라 필드 자체는 남는다(최종이 쓴다). 회의 중에는 서버가 **읽고 버린다** —
    줄은 들어가고 `source_agenda_id` 는 `NULL` 이다. 예전에는 「이 회의 사람 안건이 아니면 위반」이었고,
    사람 안건이면 미러였다. 둘 다 사라졌다 — 회의 중 AI 는 사람 안건을 아예 보지 않는다.
    """
    detail = await start_meeting(client, owner)
    human_id = detail["agendas"]["human"][0]["id"]
    await add_block(db_session, detail["id"], content="가" * FIRE)

    # ① 이 회의의 사람 안건 id · ② 남의 것(없는 id) — 어느 쪽도 폐기가 아니다
    fake_agent.will_return(_notes([
        _agenda(human_agenda_id=human_id, title="모델이 지은 제목"),
        _agenda(human_agenda_id=999_999, title="없는 안건을 가리킨 것"),
    ]))
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True

    assert (await _runs(db_session, detail["id"]))[-1].status == "succeeded"
    agendas, lines = await _ai_rows(db_session, detail["id"])
    assert [(a.title, a.source_agenda_id, a.state) for a in agendas] == [
        ("모델이 지은 제목", None, None),
        ("없는 안건을 가리킨 것", None, None),
    ]
    assert len(lines) == 2


# --- BE §12 테스트 7 — 강등 · 회의 중 payload 버림 -----------------------------------------


async def test_task_outside_the_project_is_demoted_to_action_keeping_its_body(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """**BE §12 테스트 7** — 회의 프로젝트 밖 `taskId` 줄은 `action` · `task_id=NULL` 이 되고 본문·상세·근거가 남는다."""
    detail = await start_meeting(client, owner, projectId=owner.project_id)
    human_id = detail["agendas"]["human"][0]["id"]
    inside = await add_task(db_session, owner, title="소개서 v2 문구 정리", project_id=owner.project_id)
    outside = await add_task(db_session, owner, title="다른 프로젝트 업무", project_id=None)
    await add_block(db_session, detail["id"], content="가" * FIRE)
    fake_agent.calls.clear()

    fake_agent.will_return(_notes([_agenda(human_agenda_id=human_id, lines=[
        _line(kind="task", content="안쪽 업무 기한을 당긴다", task_id=inside),
        _line(kind="task", content="바깥 업무를 참조했다", task_id=outside, detail="바깥 상세",
              evidence=[{"fromMs": 100, "toMs": 900}]),
        _line(kind="task", content="업무 없는 업무 줄", task_id=None),
        _line(kind="decision", content="결정에 붙은 taskId 는 뗀다", task_id=inside),
    ])]))
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True

    _, lines = await _ai_rows(db_session, detail["id"])
    assert [(line.kind, line.task_id) for line in lines] == [
        ("task", inside), ("action", None), ("action", None), ("decision", None),
    ]
    demoted = lines[1]
    assert (demoted.content, demoted.detail, demoted.evidence) == ("바깥 업무를 참조했다", "바깥 상세", [{"fromMs": 100, "toMs": 900}])

    body = await get_detail(client, owner, detail["id"])
    ai_lines = body["agendas"]["ai"][0]["lines"]
    assert ai_lines[0]["task"]["title"] == "소개서 v2 문구 정리"
    assert ai_lines[0]["task"]["workType"]["id"] == owner.task_type_id
    assert ai_lines[0]["task"]["workType"]["isDeleted"] is False
    assert ai_lines[1]["kind"] == "action" and ai_lines[1]["taskId"] is None
    assert body["latestBatchSeq"] == 1


async def test_the_whitelist_is_read_at_check_time_not_at_submit_time(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """**검사 시점 조회**다(M-15 · MF-50) — 제출 뒤에 만든 업무를 AI 가 도구로 보고 가리켜도 강등되지 않는다."""
    detail = await start_meeting(client, owner, projectId=owner.project_id)
    human_id = detail["agendas"]["human"][0]["id"]
    await add_block(db_session, detail["id"], content="가" * FIRE)

    created: dict[str, int] = {}

    def answer(_prompt: str) -> str:
        # 제출이 끝난 **뒤에** 업무가 생겼다 — 검사 시점 조회라면 이 id 가 살아 있어야 한다
        return json.dumps(_notes([_agenda(human_agenda_id=human_id, lines=[
            _line(kind="task", content="제출 뒤에 생긴 업무", task_id=created["id"]),
        ])]))

    created["id"] = await add_task(db_session, owner, title="제출 직전에 없던 업무", project_id=owner.project_id)
    fake_agent.will_answer(answer)
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True

    _, lines = await _ai_rows(db_session, detail["id"])
    assert [(line.kind, line.task_id) for line in lines] == [("task", created["id"])]


async def test_payload_headline_and_term_corrections_are_dropped_during_the_meeting(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """**검증 4단**(MF-52) — 회의 중에는 셋 다 **버린다**. 폐기 사유가 아니다."""
    detail = await start_meeting(client, owner)
    human_id = detail["agendas"]["human"][0]["id"]
    await add_block(db_session, detail["id"], content="가" * FIRE)

    output = _notes(
        [_agenda(human_agenda_id=human_id, lines=[_line(content="payload 가 실려 왔다")])],
        headline="회의 중에는 안 쓴다",
        term_corrections=[{"stt": "캐스티", "correct": "Casti", "grade": "auto"}],
    )
    output["agendas"][0]["lines"][0]["payload"] = payload(title="만들어 달라는 업무")
    fake_agent.will_return(output)
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True

    _, lines = await _ai_rows(db_session, detail["id"])
    # 회의 중에는 `payload` 컬럼이 NULL 이다 — 값이 차는 것은 최종 회의록뿐이다(MF-52)
    assert [(line.content, line.payload) for line in lines] == [("payload 가 실려 왔다", None)]
    body = await get_detail(client, owner, detail["id"])
    assert body["headline"] is None
    assert body["agendas"]["ai"][0]["lines"][0]["payload"] is None


async def test_task_id_on_a_non_task_line_is_stripped_with_a_reason_log(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway,
    batch_log: pytest.LogCaptureFixture,
) -> None:
    """`kind≠task` 인데 `taskId` 가 온 출력은 조용히 정정되지 않는다: 떼되 **사유 로그**가 남는다."""
    detail = await start_meeting(client, owner, projectId=owner.project_id)
    human_id = detail["agendas"]["human"][0]["id"]
    inside = await add_task(db_session, owner, title="안쪽 업무", project_id=owner.project_id)
    await add_block(db_session, detail["id"], content="가" * FIRE)
    fake_agent.will_return(_notes([_agenda(human_agenda_id=human_id, lines=[
        _line(kind="decision", content="결정에 붙은 taskId", task_id=inside),
    ])]))

    batch_log.set_level(logging.WARNING, logger="service.meeting_batch_service")
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True

    _, lines = await _ai_rows(db_session, detail["id"])
    assert [(line.kind, line.task_id) for line in lines] == [("decision", None)]
    stripped = [record for record in batch_log.records if record.levelno == logging.WARNING and "taskId" in record.getMessage()]
    assert len(stripped) == 1
    assert f"회의 {detail['id']}" in stripped[0].getMessage()
    assert f"taskId={inside}" in stripped[0].getMessage() and "kind=decision" in stripped[0].getMessage()


# --- 실패 1단 · 프로토콜 오류 ---------------------------------------------------------------


async def test_worker_timeout_is_failed_silently_and_merged_into_the_next_batch(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    detail = await start_meeting(client, owner)
    human_id = detail["agendas"]["human"][0]["id"]
    first = await add_block(db_session, detail["id"], content="가" * FIRE)

    fake_agent.will_timeout()
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True
    fake_agent.will_fail()
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True
    runs = await _runs(db_session, detail["id"])
    assert [run.status for run in runs] == ["failed", "failed"]
    assert (await get_detail(client, owner, detail["id"]))["latestBatchSeq"] == 0  # 사용자 표시 없음

    second = await add_block(db_session, detail["id"], content="나", at_ms=3000)
    fake_agent.will_return(_notes([_agenda(human_agenda_id=human_id)]))
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True
    last = (await _runs(db_session, detail["id"]))[-1]
    assert (last.status, last.from_transcript_id, last.to_transcript_id, last.seq) == ("succeeded", first, second, 1)


async def test_protocol_errors_propagate_without_a_failed_row(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """정의 밖 예외(프로토콜 오류)는 잡지 않는다 — 전파되고 `batch_run` 에 `failed` 가 남지 않는다."""
    detail = await start_meeting(client, owner)
    await add_block(db_session, detail["id"], content="가" * FIRE)
    fake_agent.will_raise(RuntimeError("broker protocol error"))
    with pytest.raises(RuntimeError, match="broker protocol error"):
        await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT)
    assert await _runs(db_session, detail["id"]) == []


async def test_scheduled_batch_task_exception_is_logged_with_its_stack(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway,
    batch_log: pytest.LogCaptureFixture,
) -> None:
    """실제 경로는 `schedule()` 의 백그라운드 태스크다. 요청 경계 밖이라 500 이 없으니
    설계 밖 예외를 **done 콜백이 읽어 스택째 ERROR 로그**로 드러낸다. 삼키지 않는다."""
    detail = await start_meeting(client, owner)
    await add_block(db_session, detail["id"], content="가" * FIRE)
    fake_agent.will_raise(RuntimeError("broker protocol error"))
    batch_log.set_level(logging.ERROR, logger="service.meeting_batch_service")

    meeting_batch_service.schedule(detail["id"], TRANSCRIPT)
    [task] = list(meeting_batch_service._tasks)
    with pytest.raises(RuntimeError, match="broker protocol error"):
        await task
    await asyncio.sleep(0)  # done 콜백이 돈다

    assert task not in meeting_batch_service._tasks
    errors = [record for record in batch_log.records if record.levelno == logging.ERROR]
    assert len(errors) == 1
    assert errors[0].exc_info is not None and isinstance(errors[0].exc_info[1], RuntimeError)
    assert "broker protocol error" in batch_log.text and "Traceback" in batch_log.text
    assert await _runs(db_session, detail["id"]) == []


# --- BE §12 테스트 7-a — 전량 교체 ---------------------------------------------------------


async def test_7a_the_second_batch_replaces_the_first_wholesale(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """**BE §12 테스트 7-a**(MF-53 · M-7) — 두 번째 배치 뒤 첫 배치의 AI 안건·줄 id 가 **DB 에 남아 있지 않다**."""
    detail = await start_meeting(client, owner)
    human_id = detail["agendas"]["human"][0]["id"]
    await add_block(db_session, detail["id"], content="가" * FIRE)
    fake_agent.will_return(_notes([
        _agenda(human_agenda_id=human_id, lines=[_line(content="첫째"), _line(content="둘째")]),
        _agenda(title="경쟁사 요금제 비교", lines=[_line(content="셋째")]),
    ]))
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True
    first_agendas, first_lines = await _ai_rows(db_session, detail["id"])
    assert [(a.title, a.source_agenda_id, a.state) for a in first_agendas] == [
        ("안건", None, None), ("경쟁사 요금제 비교", None, None),
    ]
    assert [line.content for line in first_lines] == ["첫째", "둘째", "셋째"]

    # 두 번째 배치 — 앞 배치가 가른 두 안건을 하나로 합쳤다
    await add_block(db_session, detail["id"], content="나" * FIRE, at_ms=3000)
    fake_agent.will_return(_notes([
        _agenda(human_agenda_id=human_id, lines=[_line(content="합친 첫째"), _line(content="합친 셋째")]),
    ]))
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True

    after_agendas, after_lines = await _ai_rows(db_session, detail["id"])
    assert [line.content for line in after_lines] == ["합친 첫째", "합친 셋째"]
    # **id 가 남아 있지 않다** — 트랙이 통째로 갈렸다
    assert {a.id for a in after_agendas}.isdisjoint({a.id for a in first_agendas})
    assert {line.id for line in after_lines}.isdisjoint({line.id for line in first_lines})
    assert (await get_detail(client, owner, detail["id"]))["latestBatchSeq"] == 2


async def test_7a_a_failing_second_batch_keeps_the_first_one(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """**BE §12 테스트 7-a 뒷면** — 두 번째가 검증에 떨어지면 첫 배치 것이 **그대로**다.

    검증 전에 지우지 않기 때문이다(M-7) — DELETE 는 `_persist` 안, 검증 뒤에 있다.
    """
    detail = await start_meeting(client, owner)
    human_id = detail["agendas"]["human"][0]["id"]
    await add_block(db_session, detail["id"], content="가" * FIRE)
    fake_agent.will_return(_notes([_agenda(human_agenda_id=human_id, lines=[_line(content="살아남을 줄")])]))
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True
    before_agendas, before_lines = await _ai_rows(db_session, detail["id"])

    await add_block(db_session, detail["id"], content="나" * FIRE, at_ms=3000)
    for bad in ("not json at all", json.dumps(_notes([_agenda(lines=[_line(kind="memo")])]))):
        fake_agent.will_return(bad)
        assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True

    after_agendas, after_lines = await _ai_rows(db_session, detail["id"])
    assert [(a.id, a.title) for a in after_agendas] == [(a.id, a.title) for a in before_agendas]
    assert [(line.id, line.content) for line in after_lines] == [(line.id, line.content) for line in before_lines]
    # 워커 오류(1단)도 마찬가지다
    fake_agent.will_timeout()
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True
    _, still = await _ai_rows(db_session, detail["id"])
    assert [line.id for line in still] == [line.id for line in before_lines]


async def test_7b_the_mid_meeting_batch_writes_alone(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """**BE §12 7-b**(MF-71 · M-5-b · M-5-c · M-7) — 중간 배치가 넣는 `track='ai'` 안건은 **전부 신설**이다.

    `source_agenda_id` · `state` 가 전부 `NULL` 이고 제목은 **출력의 `title` 그대로**다 —
    사람 안건 제목을 복사하지 않는다. 사람이 회의록 탭에 안건을 적어 두어도 AI 탭에 그 사본이 생기지 않는다.
    """
    detail = await start_meeting(client, owner)
    human_id = detail["agendas"]["human"][0]["id"]
    human_title = detail["agendas"]["human"][0]["title"]
    await add_block(db_session, detail["id"], content="가" * FIRE)
    fake_agent.will_return(_notes([
        _agenda(human_agenda_id=human_id, title="AI 가 지은 제목"),
        _agenda(title="경쟁사 요금제 비교"),
    ]))
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True

    agendas, _ = await _ai_rows(db_session, detail["id"])
    assert [(a.title, a.source_agenda_id, a.state, a.order_index) for a in agendas] == [
        ("AI 가 지은 제목", None, None, 0),
        ("경쟁사 요금제 비교", None, None, 1),
    ]
    # 사람 안건은 그대로 남아 있고 AI 트랙에 그 제목의 사본이 없다
    body = await get_detail(client, owner, detail["id"])
    assert human_title in [agenda["title"] for agenda in body["agendas"]["human"]]
    assert human_title not in [agenda["title"] for agenda in body["agendas"]["ai"]]
    assert all(agenda["sourceAgendaId"] is None for agenda in body["agendas"]["ai"])


# --- push -------------------------------------------------------------------------------


async def test_successful_batch_pushes_the_whole_ai_track(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`ai.batch` 는 **AI 트랙 전체**다 — 줄이 `agendas[].lines[]` 안에 중첩된다(SPEC-007 §4)."""
    detail = await start_meeting(client, owner)
    human_id = detail["agendas"]["human"][0]["id"]
    await add_block(db_session, detail["id"], content="가" * FIRE)
    monkeypatch.setattr(meeting_batch_service, "schedule", lambda *_: None)

    fake_client = FakeStreamClient()
    stream = asyncio.create_task(
        meeting_stream_service.serve(fake_client, account_id=owner.id, meeting_id=detail["id"], audio=AUDIO)
    )
    await fake_client.wait_for(lambda: bool(fake_client.frames(ReadyFrame)))

    task_id = await add_task(db_session, owner, title="push 되는 업무", project_id=None)
    fake_agent.will_return(_notes([_agenda(human_agenda_id=human_id, lines=[
        _line(content="push 된 줄"),
        _line(kind="task", content="push 된 업무 줄", task_id=task_id),
    ])]))
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True
    await fake_client.wait_for(lambda: bool(fake_client.frames(AiBatchFrame)))
    frame = fake_client.frames(AiBatchFrame)[0]

    assert frame.seq == 1
    assert [agenda.source_agenda_id for agenda in frame.agendas] == [None]  # 미러가 없다(MF-71)
    # 줄이 안건 안에 있다 — 최상위 `lines` 가 없다
    assert not hasattr(frame, "lines")
    pushed = frame.agendas[0].lines
    assert [line.content for line in pushed] == ["push 된 줄", "push 된 업무 줄"]
    assert pushed[0].track == "ai"
    assert pushed[1].task is not None and pushed[1].task.work_type.id == owner.task_type_id

    # 상세 응답 `agendas.ai` 와 **같은 모양**이다
    body = await get_detail(client, owner, detail["id"])
    assert [line["content"] for line in body["agendas"]["ai"][0]["lines"]] == [line.content for line in pushed]

    fake_client.disconnect()
    await asyncio.wait_for(stream, timeout=3)

    await add_block(db_session, detail["id"], content="나" * FIRE, at_ms=3000)
    fake_agent.will_return(_notes([_agenda(human_agenda_id=human_id, lines=[_line(content="세션 없이")])]))
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True  # 건너뛰되 예외 없음
    assert (await get_detail(client, owner, detail["id"]))["latestBatchSeq"] == 2


async def test_the_batch_never_writes_to_the_human_track(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    """AI 는 `track='ai'` 에만 쓴다(M-6) — 사람 줄은 배치가 몇 번을 돌아도 그대로다."""
    detail = await start_meeting(client, owner)
    human_id = detail["agendas"]["human"][0]["id"]
    line = await client.post(
        f"{BASE}/{detail['id']}/lines",
        json={"agendaId": human_id, "kind": "decision", "content": "사람이 적은 결정"},
        headers=owner.headers,
    )
    assert line.status_code == 201
    await add_block(db_session, detail["id"], content="가" * FIRE)
    fake_agent.will_return(_notes([_agenda(human_agenda_id=human_id)]))
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True

    body = await get_detail(client, owner, detail["id"])
    assert [line["content"] for line in body["agendas"]["human"][0]["lines"]] == ["사람이 적은 결정"]
    assert all(agenda["track"] == "ai" for agenda in body["agendas"]["ai"])


# --- 정적 검사 ----------------------------------------------------------------------------


BACK_DIR = Path(__file__).resolve().parents[1]


def test_only_persist_deletes_the_ai_track() -> None:
    """**검증 전에 지우지 않는다**(M-7) — DELETE 를 부르는 곳이 `_persist` 하나여야 그 순서가 지켜진다."""
    source = (BACK_DIR / "service" / "meeting_batch_service.py").read_text(encoding="utf-8")
    persist = source[source.index("async def _persist("):]
    persist = persist[: persist.index("\n# ---")]

    # 호출식만 센다 — 주석·docstring 의 언급은 세지 않는다
    for needle in (
        "meeting_line_repository.delete_by_track(",
        "meeting_child_repository.delete_agendas_by_track(",
    ):
        assert source.count(needle) == 1, needle
        assert persist.count(needle) == 1, needle


def test_the_batch_input_reads_nothing_but_the_transcript() -> None:
    """`_load_input` 이 안건 · 사람 줄 · 업무를 읽지 않는다(MF-50)."""
    source = (BACK_DIR / "service" / "meeting_batch_service.py").read_text(encoding="utf-8")
    load_input = source[source.index("async def _load_input("):source.index("async def _record(")]

    for needle in ("list_agendas_by_track", "list_human_lines_since", "list_meeting_context"):
        assert needle not in load_input, needle


def test_there_is_exactly_one_notes_schema_file() -> None:
    """스키마는 **한 벌**이다(MF-52) — `meeting_batch.json` 은 없다."""
    names = sorted(path.name for path in (BACK_DIR / "ai_schemas").iterdir())

    assert "meeting_batch.json" not in names
    assert "meeting_notes.json" in names
    assert meeting_batch_service.OUTPUT_SCHEMA.name == "meeting_notes.json"
