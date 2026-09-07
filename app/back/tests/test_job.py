"""WORK-008 Phase 1 — job 실행기(BE §5-3 · §6 · SPEC-008 §4). `GET /api/jobs/{id}` · 상한 마감 · 기동 스윕 · 예외 노출."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from models.job import Job
from repository import job_repository
from service import job_service
from tests.fakes.agent import FakeAgentGateway
from tests.meeting_close_fixtures import (  # noqa: F401
    close_scope,
    fake_async_stt,
    end_meeting,
    notes_output,
    finalize_successfully,
    load_job,
    load_meeting,
    prepare_recording,
    run_job,
)
from tests.meeting_fixtures import BASE, MeetingOwner, owner, stranger  # noqa: F401

pytestmark = pytest.mark.usefixtures("close_scope", "fake_async_stt")

JOBS = "/api/jobs"


@pytest.fixture
def job_log(caplog: pytest.LogCaptureFixture) -> Iterator[pytest.LogCaptureFixture]:
    """alembic `fileConfig()` 가 끈 로거를 검사 대상만 도로 켠다(`meeting_live_fixtures.batch_log` 와 같은 사정)."""
    logger = logging.getLogger("service.job_service")
    was_disabled = logger.disabled
    logger.disabled = False
    yield caplog
    logger.disabled = was_disabled


# --- GET /api/jobs/{id} ------------------------------------------------------------------


async def test_job_polling_shows_derived_progress_and_terminal_state(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway
) -> None:
    detail = await prepare_recording(client, owner, db_session)
    job_id = await end_meeting(client, owner, detail["id"])

    queued = (await client.get(f"{JOBS}/{job_id}", headers=owner.headers)).json()
    assert queued == {
        "id": job_id, "kind": "meeting_finalize", "status": "queued",
        "progress": {"phase": "transcription", "attempt": 0},
        "errorCode": None, "errorMessage": None, "finishedAt": None,
    }

    fake_agent.will_return(notes_output(detail))
    await run_job(job_id)
    done = (await client.get(f"{JOBS}/{job_id}", headers=owner.headers)).json()
    assert (done["status"], done["progress"], done["errorCode"]) == ("succeeded", {"phase": "final", "attempt": 1}, None)
    assert done["finishedAt"] is not None
    # 결과를 담지 않는다 — 원 리소스를 다시 읽는다
    assert "meeting" not in done and "merged" not in done


async def test_job_of_a_stranger_and_an_unknown_job_are_404(
    client: AsyncClient, owner: MeetingOwner, stranger: MeetingOwner, db_session: AsyncSession
) -> None:
    detail = await prepare_recording(client, owner, db_session)
    job_id = await end_meeting(client, owner, detail["id"])
    response = await client.get(f"{JOBS}/{job_id}", headers=stranger.headers)
    assert (response.status_code, response.json()["code"]) == (404, "not_found")
    assert (await client.get(f"{JOBS}/999999", headers=owner.headers)).status_code == 404
    assert (await client.get(f"{JOBS}/{job_id}")).status_code == 401


# --- 상한 마감 ----------------------------------------------------------------------


async def test_job_over_the_limit_is_closed_as_job_timeout_and_the_meeting_ends_failed(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch, job_log: pytest.LogCaptureFixture
) -> None:
    """상한 초과 → `failed(job_timeout)` + handler.on_timeout(회의 `ended`+`failed`).

    **handler.run 을 DB 를 건드리지 않는 대기로 바꾼다** — 상한이 짧으면 취소가 파이프라인의 DB 문장 도중에 떨어질 수 있고,
    테스트는 단계마다 새 세션이 아니라 **테스트 세션(중첩 트랜잭션) 하나**를 나눠 쓰므로 그 savepoint 가 깨진 채 남아 다음 조회가
    `PendingRollbackError` 로 터진다(전체 스위트에서만 재현 — 기계가 느릴 때). 프로덕션은 단계마다 `SessionLocal()` 을 새로 열어
    취소된 세션이 다음 단계로 이어지지 않는다. 여기서 재는 것은 실행기의 상한 마감이지 파이프라인 취소 가능성이 아니다.
    """
    detail = await prepare_recording(client, owner, db_session)
    job_id = await end_meeting(client, owner, detail["id"])

    handler = job_service._handlers["meeting_finalize"]
    reached = asyncio.Event()

    async def hang_without_touching_the_db(job) -> None:  # type: ignore[no-untyped-def]
        reached.set()
        await asyncio.Event().wait()  # 상한까지 끝나지 않는 파이프라인 — 취소는 이 대기에서만 떨어진다

    monkeypatch.setattr(handler, "run", hang_without_touching_the_db)
    monkeypatch.setattr(get_settings(), "meeting_job_timeout_sec", 0.05)
    job_log.set_level(logging.WARNING, logger="service.job_service")

    await run_job(job_id)
    assert reached.is_set()

    job = await load_job(db_session, job_id)
    assert (job.status, job.error_code, job.finished_at is not None) == ("failed", "job_timeout", True)
    meeting = await load_meeting(db_session, detail["id"])
    assert (meeting.status, meeting.integration_state, meeting.ai_headline) == ("ended", "failed", None)
    assert any("상한" in record.getMessage() for record in job_log.records)
    body = (await client.get(f"{BASE}/{detail['id']}", headers=owner.headers)).json()
    assert body["activeJobId"] is None and body["integrationState"] == "failed"


# --- 기동 스윕 ----------------------------------------------------------------------


async def test_startup_sweep_closes_stale_jobs_and_their_meetings(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession
) -> None:
    detail = await prepare_recording(client, owner, db_session)
    job_id = await end_meeting(client, owner, detail["id"])  # queued · 회의 generating
    async with job_service.session_scope() as session:
        await job_repository.mark_running(session, job_id=job_id)  # 재시작으로 끊긴 running

    closed = await job_service.sweep_on_startup()
    assert closed == 1

    job = await load_job(db_session, job_id)
    assert (job.status, job.error_code) == ("failed", "job_timeout") and "스윕" in (job.error_message or "")
    meeting = await load_meeting(db_session, detail["id"])
    assert (meeting.status, meeting.integration_state) == ("ended", "failed")
    # 두 번째 스윕은 할 일이 없다 · 종결된 행은 건드리지 않는다
    assert await job_service.sweep_on_startup() == 0
    assert (await load_job(db_session, job_id)).error_message and "스윕" in (await load_job(db_session, job_id)).error_message


async def test_sweep_failure_is_logged_and_does_not_block_startup(
    monkeypatch: pytest.MonkeyPatch, job_log: pytest.LogCaptureFixture
) -> None:
    async def boom(session):  # type: ignore[no-untyped-def]
        raise RuntimeError("DB 가 아직 안 떴다")

    monkeypatch.setattr(job_repository, "list_unfinished", boom)
    job_log.set_level(logging.ERROR, logger="service.job_service")

    task = job_service.launch_sweep()  # 기동 경로 — 즉시 돌아온다
    with pytest.raises(RuntimeError, match="DB 가 아직 안 떴다"):
        await task
    errors = [record for record in job_log.records if record.levelno == logging.ERROR and record.exc_info]
    assert len(errors) == 1 and "job-sweep" in errors[0].getMessage()


# --- 설계 밖 예외는 삼기지 않고 로그로 드러난다 ----------------------------------------------------------


async def test_unexpected_exception_in_the_pipeline_propagates_and_is_logged_by_the_task_callback(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_agent: FakeAgentGateway, job_log: pytest.LogCaptureFixture
) -> None:
    detail = await prepare_recording(client, owner, db_session)
    job_id = await end_meeting(client, owner, detail["id"])
    fake_agent.will_raise(ConnectionError("브로커 도달 불가"))  # 설계 밖 — 잡지 않는다
    job_log.set_level(logging.ERROR, logger="service.job_service")

    task = job_service._spawn(job_service.run(job_id), name=f"job-{job_id}")
    with pytest.raises(ConnectionError):
        await task
    assert any(record.exc_info and f"job-{job_id}" in record.getMessage() for record in job_log.records)
    # 행은 running 으로 남고 — 기동 스윕이 마감한다
    assert (await load_job(db_session, job_id)).status == "running"
    assert await job_service.sweep_on_startup() == 1
    assert (await load_job(db_session, job_id)).status == "failed"


def test_progress_is_derived_and_null_for_other_kinds() -> None:
    from dto.job import JobDTO

    def job(kind: str, attempt: int) -> JobDTO:
        return JobDTO(id=1, account_id=1, kind=kind, target_type="meeting", target_id=1, status="running", attempt=attempt,
                      error_code=None, error_message=None, finished_at=None, created_at=datetime.now(UTC))

    # `phase` 는 시도 횟수가 아니라 **`batch_run(phase='final')` 행이 생겼는가**로 갈린다(SPEC-008 §4)
    assert job_service.derive_progress(job("meeting_finalize", 0), final_started=False).phase == "transcription"
    assert job_service.derive_progress(job("meeting_finalize", 2), final_started=True).phase == "final"
    assert job_service.derive_progress(job("something_else", 2), final_started=True) is None
    assert not hasattr(Job, "phase") and not hasattr(Job, "progress")  # 파생 — 컬럼이 아니다
