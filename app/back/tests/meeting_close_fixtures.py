"""WORK-008 테스트 공통 — 종료 파이프라인을 **테스트 세션 하나**로 돌리는 경계 · `/end` 뒤 job 을 손으로 돌리는 도우미 · 대역 모델.

**`conftest.py` 가 아니므로 자동 수집되지 않는다** — 쓰는 쪽에서 이름을 import 한다.

- `close_scope` — 스트림·배치·job·finalize 서비스의 「단계마다 새 세션」을 테스트의 `db_session` 으로 묶고(롤백 격리),
  `job_service.launch` 를 **기록기**로 바꾼다(커밋 뒤 훅이 백그라운드 태스크를 띄우면 같은 세션을 두 코루틴이 나눠 쓴다).
  `meeting_batch_service.schedule` 도 기록기다(안건 전환 훅).
- `run_job()` — 기록된 job 을 `job_service.run()` 으로 **실행기째** 돈다(상한 · handler · 종결까지).
- `notes_output()` — ② 최종 회의록 출력 대역. **사람 안건 전부를 정확히 한 번씩** 덮는다. 실패 케이스는 `notes_from(mutate=…)` 로 비튼다.
- `fake_async_stt` — ① 재전사 대역(`stt-async-v5`). 기본은 성공이고 `will_fail()`·`will_timeout()` 으로 설계한 실패 둘을 낸다.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable, Iterator
from contextlib import asynccontextmanager

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.job import Job
from dto.enums import LineKind, MeetingTrack
from models.meeting import Meeting, MeetingAgenda, MeetingLine
from repository import job_repository, meeting_repository
from service import (
    job_service,
    meeting_batch_service,
    meeting_finalize_service,
    meeting_stream_service,
)
from integrations import soniox as soniox_integration
from integrations.soniox import SttToken
from tests.fakes.agent import FakeAgentGateway
from tests.fakes.soniox import FakeAsyncSttConnector
from tests.meeting_fixtures import BASE, MeetingOwner
from tests.meeting_live_fixtures import add_ai_agenda, add_block, start_meeting

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


# 재전사 결과 대역 — 실시간 블록과 **다른 문장**이라 「전량 교체됐는가」가 눈에 보인다
RETRANSCRIBED = [
    SttToken(text="재전사된 발화입니다. ", is_final=True, speaker="1", start_ms=1000, end_ms=5000),
    SttToken(text="캐스티 안건을 정리합시다.", is_final=True, speaker="2", start_ms=6000, end_ms=12_000),
]


@pytest.fixture
def fake_async_stt() -> Iterator[FakeAsyncSttConnector]:
    """① 재전사 대역 — 실제 Soniox 를 부르지 않는다(BE §12). 기본은 성공이다."""
    connector = FakeAsyncSttConnector(tokens=list(RETRANSCRIBED))
    soniox_integration.install_async_connector(connector)
    yield connector
    soniox_integration.install_async_connector(None)


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
    await add_block(db_session, detail["id"], content="실시간 블록 — 재전사가 이것을 갈아끼운다", at_ms=0, end_ms=60_000)
    # 회의 중 배치가 낸 AI 트랙 — 종료 파이프라인이 **손대지 않아야 하는** 것이다(M-6 · MF-56).
    # 배치를 실제로 돌리지 않고 행만 심는다: 대역 게이트웨이의 응답 순서를 테스트가 쥐고 있어야 해서다
    ai_agenda_id = await add_ai_agenda(
        db_session, detail["id"], title="회의 중 AI 안건", source_agenda_id=first["id"]
    )
    db_session.add(
        MeetingLine(
            meeting_id=detail["id"],
            agenda_id=ai_agenda_id,
            track=MeetingTrack.AI.value,
            kind=LineKind.DISCUSSION.value,
            content="회의 중 AI 줄",
            order_index=0,
            evidence=[{"fromMs": 0, "toMs": 5000}],
        )
    )
    await db_session.flush()
    await meeting_repository.set_recording_path(db_session, meeting_id=detail["id"], recording_path="recordings/1.webm")
    response = await client.get(f"{BASE}/{detail['id']}", headers=owner.headers)
    assert response.status_code == 200
    return response.json()


def notes_output(
    detail: dict,
    *,
    task_id: int | None = None,
    headline: str = HEADLINE,
    term_corrections: list | None = None,
) -> dict:
    """② 최종 회의록 출력 — **사람 안건 전부를 정확히 한 번씩** 덮는다(SPEC-008 §4 「안건 참조」).

    스키마는 회의 중 배치와 한 벌(`ai_schemas/meeting_notes.json`)이고, 최종이라 `headline` ·
    `termCorrections` · `payload` 에 값이 있다.
    """
    human = detail["agendas"]["human"]
    agendas = [
        {
            "humanAgendaId": human[0]["id"],
            "title": "모델이 지은 제목(서버가 사람 안건 것으로 맞춘다)",
            "lines": [
                _line(content="사람 줄 A — 개정 범위는 4개 섹션이다", detail="AI 가 붙인 상세",
                      evidence=[{"fromMs": 1000, "toMs": 5000}]),
                _line(content="AI 전용 — 후속 미팅은 9/12", kind="action",
                      evidence=[{"fromMs": 6000, "toMs": 9000}]),
            ],
        }
    ]
    agendas += [
        {"humanAgendaId": agenda["id"], "title": agenda["title"],
         "lines": [_line(content=f"{agenda['title']} 요약", evidence=[])]}
        for agenda in human[1:]
    ]
    agendas.append(
        {"humanAgendaId": None, "title": "AI 신설 안건",
         "lines": [_line(content="AI 신설 안건의 논의", evidence=[{"fromMs": 10_000, "toMs": 12_000}])]}
    )
    if task_id is not None:
        agendas[0]["lines"].append(
            _line(kind="task", content="업무 줄", task_id=task_id, evidence=[],
                  payload=payload(dueDate="2026-09-02", status="in_progress", note="진행 메모"))
        )
    return {
        "headline": headline,
        "termCorrections": [] if term_corrections is None else term_corrections,
        "agendas": agendas,
    }


# `meeting_notes.json` 의 `payload` 는 **두 모양의 합집합(열한 키)**이고 strict 규격이라 **전부** 보내야 한다.
# 모델이 실제로 보내는 모양이 이것이다 — 안 쓰는 키는 `null`. 서버가 줄 종류의 키만 남긴다(`_final_payload`)
_PAYLOAD_KEYS = (
    "title", "workTypeId", "projectId", "startDate", "dueDate", "description",
    "todos", "status", "note", "relatedTaskIds", "completionResult",
)


def payload(**values: object) -> dict:
    """모델이 낸 `payload` 한 벌 — 준 키만 값이 있고 나머지 열한 키는 `null` 이다."""
    unknown = set(values) - set(_PAYLOAD_KEYS)
    assert not unknown, f"스키마에 없는 payload 키: {sorted(unknown)}"
    return {key: values.get(key) for key in _PAYLOAD_KEYS}


def _line(*, kind: str = "discussion", content: str, detail: str | None = None,
          evidence: list | None = None, task_id: int | None = None, payload: dict | None = None) -> dict:
    return {
        "kind": kind,
        "content": content,
        "detail": detail,
        "evidence": [] if evidence is None else evidence,
        "taskId": task_id,
        "payload": payload,
    }


def notes_from(detail: dict, *, mutate: Callable[[dict], None] | None = None, **kwargs) -> dict:
    """`notes_output` 을 만들고 `mutate` 로 비튼다 — 실패 케이스가 그 자리를 쓴다."""
    output = notes_output(detail, **kwargs)
    if mutate is not None:
        mutate(output)
    return output


# --- 출력 비틀기(② 실패 케이스) ---------------------------------------------------


def drop_headline(output: dict) -> None:
    output["headline"] = None


def overlong_headline(output: dict) -> None:
    output["headline"] = "가" * 201


def drop_one_human_agenda(output: dict) -> None:
    """사람 안건 하나를 빠뜨린다 — **그 시도 실패**(SPEC-008 §4 「안건 참조」)."""
    output["agendas"] = [
        agenda for agenda in output["agendas"] if agenda["humanAgendaId"] is None
    ] + [agenda for agenda in output["agendas"] if agenda["humanAgendaId"] is not None][1:]


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
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway,
    *, task_id: int | None = None, **overrides: object
) -> tuple[dict, int]:
    """준비 → `/end` → ① 재전사 성공 → ② 최종 회의록 성공. `(종료 후 상세, job_id)` 를 돌려준다."""
    detail = await prepare_recording(client, owner, db_session, **overrides)
    fake_agent.will_return(notes_output(detail, task_id=task_id))
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
    for _ in range(3):
        fake_agent.will_return(notes_from(detail, mutate=drop_headline))
    job_id = await end_meeting(client, owner, detail["id"])
    await run_job(job_id)
    response = await client.get(f"{BASE}/{detail['id']}", headers=owner.headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["status"], body["integrationState"]) == ("ended", "failed"), body
    return body, job_id


async def job_repo_dto(session: AsyncSession, job_id: int):  # type: ignore[no-untyped-def]
    return await job_repository.find_for_runner(session, job_id=job_id)
