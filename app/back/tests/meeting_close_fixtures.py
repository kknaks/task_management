"""WORK-008 테스트 공통 — 종료 파이프라인을 **테스트 세션 하나**로 돌리는 경계 · `/end` 뒤 job 을 손으로 돌리는 도우미 · 대역 모델.

**`conftest.py` 가 아니므로 자동 수집되지 않는다** — 쓰는 쪽에서 이름을 import 한다.

- `close_scope` — 스트림·배치·job·finalize 서비스의 「단계마다 새 세션」을 테스트의 `db_session` 으로 묶고(롤백 격리),
  `job_service.launch` 를 **기록기**로 바꾼다(커밋 뒤 훅이 백그라운드 태스크를 띄우면 같은 세션을 두 코루틴이 나눠 쓴다).
  `meeting_batch_service.schedule` 도 기록기다(안건 전환 훅).
- `run_job()` — 기록된 job 을 `job_service.run()` 으로 **실행기째** 돈다(상한 · handler · 종결까지).
- `integration_from_prompt()` — 통합 프롬프트의 입력 JSON 을 읽어 **규칙대로** 짝지은 출력을 만드는 대역 모델. 실패 5종은 `mutate` 로 비튼다.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable, Iterator
from contextlib import asynccontextmanager

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.job import Job
from models.meeting import Meeting, MeetingAgenda, MeetingLine
from repository import job_repository
from service import (
    job_service,
    meeting_batch_service,
    meeting_finalize_service,
    meeting_stream_service,
)
from tests.fakes.agent import FakeAgentGateway
from tests.meeting_fixtures import BASE, MeetingOwner
from tests.meeting_live_fixtures import add_block, start_meeting

HEADLINE = "개정 범위를 4개 섹션으로 확정하고 도입 사례 분리를 결정했다."


def slot(hours: int) -> dict:
    """같은 계정의 두 번째 회의 — 겹침 검사(`schedule_overlap`)를 피해 시각을 옮긴 `startAt`·`endAt` 오버라이드."""
    from datetime import timedelta

    from tests.meeting_fixtures import END, START, iso

    return {"startAt": iso(START + timedelta(hours=hours)), "endAt": iso(END + timedelta(hours=hours))}


class LaunchRecorder:
    def __init__(self) -> None:
        self.job_ids: list[int] = []

    def __call__(self, job_id: int) -> None:
        self.job_ids.append(job_id)


class ScheduleRecorder:
    def __init__(self) -> None:
        self.calls: list[tuple[int, str]] = []

    def __call__(self, meeting_id: int, cause: str) -> None:
        self.calls.append((meeting_id, cause))


@pytest.fixture
def close_scope(monkeypatch: pytest.MonkeyPatch, db_session: AsyncSession) -> Iterator[LaunchRecorder]:
    @asynccontextmanager
    async def scope() -> AsyncIterator[AsyncSession]:
        yield db_session
        await db_session.flush()

    for module in (meeting_stream_service, meeting_batch_service, job_service, meeting_finalize_service):
        monkeypatch.setattr(module, "session_scope", scope)
    recorder = LaunchRecorder()
    monkeypatch.setattr(job_service, "launch", recorder)
    monkeypatch.setattr(meeting_batch_service, "schedule", ScheduleRecorder())
    meeting_batch_service.reset_state()
    yield recorder
    meeting_batch_service.reset_state()


# --- 회의 준비 ---------------------------------------------------------------------


async def add_human_line(
    client: AsyncClient, owner: MeetingOwner, meeting_id: int, *, agenda_id: int, content: str, kind: str = "discussion"
) -> dict:
    response = await client.post(
        f"{BASE}/{meeting_id}/lines",
        json={"agendaId": agenda_id, "kind": kind, "content": content},
        headers=owner.headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


async def prepare_recording(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, **overrides: object
) -> dict:
    """`recording` 회의 — 안건 둘(첫째 `active`) · 사람 줄 셋(A·B 는 첫째, C 는 둘째) · 발화 블록 하나. 상세를 돌려준다."""
    detail = await start_meeting(client, owner, **overrides)
    first, second = detail["agendas"]["human"]
    activated = await client.patch(
        f"{BASE}/{detail['id']}/agendas/{first['id']}", json={"state": "active"}, headers=owner.headers
    )
    assert activated.status_code == 200, activated.text
    await add_human_line(client, owner, detail["id"], agenda_id=first["id"], content="사람 줄 A — 개정 범위는 4개 섹션이다")
    await add_human_line(client, owner, detail["id"], agenda_id=first["id"], content="사람 줄 B — 도입 사례는 3건만 유지한다", kind="decision")
    await add_human_line(client, owner, detail["id"], agenda_id=second["id"], content="사람 줄 C — 검수 일정은 다음 회의로")
    await add_block(db_session, detail["id"], content="회의 발화 전체 " * 10, at_ms=0, end_ms=60_000)
    response = await client.get(f"{BASE}/{detail['id']}", headers=owner.headers)
    assert response.status_code == 200
    return response.json()


def final_output(detail: dict, *, task_id: int | None = None) -> dict:
    """① 최종 배치 출력 — 첫째 안건 미러(사람 줄 A 와 같은 내용 + AI 전용 내용 + 선택 업무 줄) · 신설 안건 하나.

    **스키마 한 벌**(WORK-011 · `ai_schemas/meeting_notes.json`) — 줄이 안건 안에 중첩되고
    `headline` · `termCorrections` · `payload` 는 회의 중과 마찬가지로 `null` 이다(MF-52).
    """
    first = detail["agendas"]["human"][0]["id"]
    mirrored = [
        _batch_line(content="사람 줄 A — 개정 범위는 4개 섹션이다", detail="AI 가 붙인 상세", evidence=[{"fromMs": 1000, "toMs": 5000}]),
        _batch_line(content="AI 전용 — 후속 미팅은 9/12", kind="action", evidence=[{"fromMs": 6000, "toMs": 9000}]),
    ]
    if task_id is not None:
        mirrored.append(_batch_line(kind="task", content="업무 줄", task_id=task_id, evidence=[]))
    return notes_output(
        [
            {"humanAgendaId": first, "title": "미러 안건", "lines": mirrored},
            {
                "humanAgendaId": None,
                "title": "AI 신설 안건",
                "lines": [
                    _batch_line(content="AI 신설 안건의 논의", evidence=[{"fromMs": 10_000, "toMs": 12_000}])
                ],
            },
        ]
    )


def notes_output(agendas: list[dict]) -> dict:
    """`meeting_notes.json` 최상위 — 회의 중은 `headline` · `termCorrections` 가 언제나 `null` 이다."""
    return {"headline": None, "termCorrections": None, "agendas": agendas}


def _batch_line(*, kind: str = "discussion", content: str, detail: str | None = None,
                evidence: list | None = None, task_id: int | None = None) -> dict:
    return {
        "kind": kind,
        "content": content,
        "detail": detail,
        "evidence": [] if evidence is None else evidence,
        "taskId": task_id,
        "payload": None,
    }


# --- 대역 모델: 통합 출력 --------------------------------------------------------------------


def parse_prompt_payload(prompt: str) -> dict:
    return json.loads(prompt.split("입력:\n", 1)[1])


def integration_from_prompt(
    prompt: str, *, headline: str = HEADLINE, mutate: Callable[[dict], None] | None = None
) -> dict:
    """규칙대로 짝짓는 대역 모델 — 같은 `content` 의 AI 줄을 사람 줄에 붙이고, 미러 안건의 나머지 AI 줄은 그 사람 안건에 추가,
    신설 AI 안건은 뒤에 붙인다. `mutate` 가 출력을 비틀어 실패 5종을 만든다."""
    payload = parse_prompt_payload(prompt)
    ai_by_source: dict[int | None, list[dict]] = {}
    for agenda in payload["aiAgendas"]:
        ai_by_source.setdefault(agenda["sourceAgendaId"], []).append(agenda)

    agendas: list[dict] = []
    for human in payload["humanAgendas"]:
        mirrors = ai_by_source.get(human["id"], [])
        ai_lines = [line for mirror in mirrors for line in mirror["lines"]]
        used: set[int] = set()
        lines: list[dict] = []
        for line in human["lines"]:
            pair = next((ai for ai in ai_lines if ai["content"] == line["content"] and ai["id"] not in used), None)
            if pair is not None:
                used.add(pair["id"])
            lines.append({"sourceHumanLineId": line["id"], "sourceAiLineId": None if pair is None else pair["id"]})
        for ai in ai_lines:
            if ai["id"] not in used:
                lines.append({"sourceHumanLineId": None, "sourceAiLineId": ai["id"]})
        agendas.append({"agendaRef": {"humanAgendaId": human["id"], "aiAgendaId": None}, "lines": lines})
    for standalone in ai_by_source.get(None, []):
        agendas.append({
            "agendaRef": {"humanAgendaId": None, "aiAgendaId": standalone["id"]},
            "lines": [{"sourceHumanLineId": None, "sourceAiLineId": line["id"]} for line in standalone["lines"]],
        })
    output = {"headline": headline, "agendas": agendas}
    if mutate is not None:
        mutate(output)
    return output


def answer(*, headline: str = HEADLINE, mutate: Callable[[dict], None] | None = None):  # type: ignore[no-untyped-def]
    return lambda prompt: integration_from_prompt(prompt, headline=headline, mutate=mutate)


# --- 실패 5종 (SPEC-008 §4 통합 규칙 · WP Done Criteria) ----------------------------------------


def drop_one_human_line(output: dict) -> None:
    """사람 줄 하나를 빠뜨린 출력."""
    for agenda in output["agendas"]:
        for index, line in enumerate(agenda["lines"]):
            if line["sourceHumanLineId"] is not None:
                del agenda["lines"][index]
                return


def duplicate_human_line(output: dict) -> None:
    """같은 사람 줄을 두 번 참조한 출력(이중 계승)."""
    for agenda in output["agendas"]:
        for line in agenda["lines"]:
            if line["sourceHumanLineId"] is not None:
                agenda["lines"].append({"sourceHumanLineId": line["sourceHumanLineId"], "sourceAiLineId": None})
                return


def duplicate_ai_line(output: dict) -> None:
    """같은 AI 줄을 두 줄에 붙인 출력."""
    for agenda in output["agendas"]:
        for line in agenda["lines"]:
            if line["sourceAiLineId"] is not None:
                agenda["lines"].append({"sourceHumanLineId": None, "sourceAiLineId": line["sourceAiLineId"]})
                return


def add_unreferenced_line(output: dict) -> None:
    """참조 없는 줄."""
    output["agendas"][0]["lines"].append({"sourceHumanLineId": None, "sourceAiLineId": None})


def drop_headline(output: dict) -> None:
    del output["headline"]


def overlong_headline(output: dict) -> None:
    output["headline"] = "가" * 201


# --- job 실행 ---------------------------------------------------------------------


async def end_meeting(client: AsyncClient, owner: MeetingOwner, meeting_id: int) -> int:
    response = await client.post(f"{BASE}/{meeting_id}/end", headers=owner.headers)
    assert response.status_code == 202, response.text
    return response.json()["jobId"]


async def run_job(job_id: int) -> None:
    """실행기째 돈다 — `running` 표시 → handler → 종결. 테스트 세션 하나 안에서."""
    await job_service.run(job_id)


async def load_job(session: AsyncSession, job_id: int) -> Job:
    row = await session.scalar(select(Job).where(Job.id == job_id))
    assert row is not None
    await session.refresh(row)
    return row


async def load_meeting(session: AsyncSession, meeting_id: int) -> Meeting:
    row = await session.scalar(select(Meeting).where(Meeting.id == meeting_id))
    assert row is not None
    await session.refresh(row)
    return row


async def rows_by_track(session: AsyncSession, meeting_id: int, track: str) -> tuple[list[MeetingAgenda], list[MeetingLine]]:
    agendas = list((await session.scalars(
        select(MeetingAgenda).where(MeetingAgenda.meeting_id == meeting_id, MeetingAgenda.track == track).order_by(MeetingAgenda.order_index, MeetingAgenda.id)
    )).all())
    lines = list((await session.scalars(
        select(MeetingLine).where(MeetingLine.meeting_id == meeting_id, MeetingLine.track == track).order_by(MeetingLine.agenda_id, MeetingLine.order_index, MeetingLine.id)
    )).all())
    return agendas, lines


async def finalize_successfully(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway, **overrides: object
) -> tuple[dict, int]:
    """준비 → `/end` → ① 성공 → ② 성공. `(종료 후 상세, job_id)` 를 돌려준다."""
    detail = await prepare_recording(client, owner, db_session, **overrides)
    fake_agent.will_return(final_output(detail))
    fake_agent.will_answer(answer())
    job_id = await end_meeting(client, owner, detail["id"])
    await run_job(job_id)
    response = await client.get(f"{BASE}/{detail['id']}", headers=owner.headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["status"], body["integrationState"]) == ("ended", "succeeded"), body
    return body, job_id


async def finalize_with_failure(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway, **overrides: object
) -> tuple[dict, int]:
    """준비 → `/end` → ① 성공 → ② 3회 실패(headline 없음). `(종료 후 상세, job_id)`."""
    detail = await prepare_recording(client, owner, db_session, **overrides)
    fake_agent.will_return(final_output(detail))
    for _ in range(3):
        fake_agent.will_answer(answer(mutate=drop_headline))
    job_id = await end_meeting(client, owner, detail["id"])
    await run_job(job_id)
    response = await client.get(f"{BASE}/{detail['id']}", headers=owner.headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["status"], body["integrationState"]) == ("ended", "failed"), body
    return body, job_id


async def job_repo_dto(session: AsyncSession, job_id: int):  # type: ignore[no-untyped-def]
    return await job_repository.find_for_runner(session, job_id=job_id)
