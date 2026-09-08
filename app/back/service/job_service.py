"""2층 — **job 실행기**(BE §5-3 · §6 · SPEC-008 §4). `job` 행이 정본, 실행은 back 프로세스의 asyncio 태스크다.

한 곳으로 못박는 것 —

1. **행은 요청 트랜잭션 안에서**(`create`), **태스크는 커밋 뒤에**(`launch`) — 부르는 service 가 `register_after_commit` 으로 건다.
   행이 없는 태스크도, 태스크 없는 `running` 행도 만들지 않는다.
2. **단계마다 세션을 새로 열고 끝에 commit**(BE §7) — `session_scope()`. 태스크 수명 내내 세션을 붙들지 않는다.
3. **상한 마감** — `MEETING_JOB_TIMEOUT_SEC`(2400) 를 넘기면 실행 중인 일을 끊고 `failed(job_timeout)` 로 마감한다. 무한 대기 금지(DEC-003 §7 L141).
   대상 리소스 쪽 마감(회의 `ended`+`failed`)은 handler 의 `on_timeout` 이 한다 — 이 파일은 회의를 모른다.
4. **기동 스윕** — `queued`/`running` 잔여를 `failed(job_timeout)` 로 마감한다(재개하지 않는다 — 통합은 처음부터 다시 돌리는 게 맞고
   「다시 생성」 표면이 그 자리다). 스윕은 **별도 태스크**로 돌아 기동을 막지 않고, 예외는 완료 콜백이 스택째 로그로 드러낸다.
5. **설계 밖 예외는 잡지 않는다** — 실행기 태스크가 그 예외로 끝나고 완료 콜백이 로그를 남긴다(BE §8-1 · WORK-007 검수 W-2).
   그 job 행은 `running` 으로 남고 다음 기동 스윕이 마감한다.
6. `progress{phase, attempt}` 는 **파생** — `attempt` 는 `job.attempt`, `phase` 는 ① 을 도는 동안 `transcription` 이고
   그 회의에 `meeting_batch_run(phase='final')` 행이 생기면 `final` 이다(SPEC-008 §4). 컬럼이 아니다(G-7).
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from core.db import SessionLocal
from core.exceptions import NotFoundError
from dto.enums import (
    JOB_TERMINAL_STATUSES,
    BatchPhase,
    JobErrorCode,
    JobKind,
    JobPhase,
    JobStatus,
)
from dto.job import JobDetailDTO, JobDTO, JobProgressDTO
from repository import job_repository, meeting_batch_run_repository

logger = logging.getLogger(__name__)

_NOT_FOUND = "작업을 찾을 수 없습니다"
_TIMEOUT_MESSAGE = "job 상한을 넘겼습니다"
_SWEEP_MESSAGE = "기동 스윕 — 재시작으로 끊긴 작업을 마감했습니다"


# --- 세션 경계 --------------------------------------------------------------


@asynccontextmanager
async def _default_session_scope() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
        await session.commit()


session_scope: Callable[[], AsyncIterator[AsyncSession]] = _default_session_scope  # type: ignore[assignment]


# --- handler 등록 -----------------------------------------------------------------


class JobHandler(Protocol):
    """`kind` 하나의 실행 계약. `run` 은 상한 안에서 끝나고 스스로 `finish` 한다 · `on_timeout` 은 대상 리소스를 실패로 마감한다."""

    async def run(self, job: JobDTO) -> None: ...

    async def on_timeout(self, job: JobDTO) -> None: ...


_handlers: dict[str, JobHandler] = {}
_tasks: set[asyncio.Task] = set()


def register_handler(kind: str, handler: JobHandler) -> None:
    _handlers[kind] = handler


def _handler_for(kind: str) -> JobHandler:
    handler = _handlers.get(kind)
    if handler is None:
        # 등록 없는 kind 는 설계 위반 — 조용히 넘기지 않는다
        raise RuntimeError(f"job kind {kind} 의 handler 가 없다")
    return handler


# --- 생성 · 기동 -----------------------------------------------------------------


async def create(
    session: AsyncSession, *, account_id: int, kind: str, target_type: str, target_id: int
) -> JobDTO:
    """`queued` 행 — 요청 트랜잭션 안. 태스크는 `launch` 가 커밋 뒤에 띄운다."""
    return await job_repository.create(
        session, account_id=account_id, kind=kind, target_type=target_type, target_id=target_id
    )


def launch(job_id: int) -> None:
    """커밋 뒤 훅에서 부른다 — 실행기 태스크를 띄운다. 테스트는 이 자리를 기록기로 바꾼다."""
    _spawn(run(job_id), name=f"job-{job_id}")


def _spawn(coroutine: Awaitable[None], *, name: str) -> asyncio.Task:
    task = asyncio.create_task(coroutine, name=name)  # type: ignore[arg-type]
    _tasks.add(task)
    task.add_done_callback(_on_task_done)
    return task


def _on_task_done(task: asyncio.Task) -> None:
    """백그라운드는 요청 경계 밖이라 500 이 없다 — 설계 밖 예외를 **여기서 스택째 로그로 드러낸다**. 삼키지 않는다."""
    _tasks.discard(task)
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.error("job 태스크 %s 가 설계 밖 예외로 끝났습니다", task.get_name(), exc_info=exc)


# --- 실행 -------------------------------------------------------------------


async def run(job_id: int) -> None:
    """한 job 을 상한 아래에서 돈다. `running` 표시 → handler.run → (상한 초과면) `failed(job_timeout)` + handler.on_timeout."""
    async with session_scope() as session:
        job = await job_repository.find_for_runner(session, job_id=job_id)
        if job is None:
            raise RuntimeError(f"job {job_id} 이 없습니다")
        if job.status in JOB_TERMINAL_STATUSES:
            return
        await job_repository.mark_running(session, job_id=job_id)
    handler = _handler_for(job.kind)

    try:
        await asyncio.wait_for(handler.run(job), timeout=get_settings().meeting_job_timeout_sec)
    except TimeoutError:
        logger.warning("job %s 가 상한 %s초를 넘겨 실패로 마감합니다", job_id, get_settings().meeting_job_timeout_sec)
        await _close_as_timeout(job, message=_TIMEOUT_MESSAGE)


async def _close_as_timeout(job: JobDTO, *, message: str) -> None:
    """`failed(job_timeout)` — job 행 + 대상 리소스(handler). 이미 종결된 행은 건드리지 않는다."""
    async with session_scope() as session:
        current = await job_repository.find_for_runner(session, job_id=job.id)
        if current is None or current.status in JOB_TERMINAL_STATUSES:
            return
        await job_repository.finish(
            session,
            job_id=job.id,
            status=JobStatus.FAILED.value,
            finished_at=datetime.now(UTC),
            error_code=JobErrorCode.JOB_TIMEOUT.value,
            error_message=message,
        )
    await _handler_for(job.kind).on_timeout(job)


async def set_attempt(job_id: int, attempt: int) -> None:
    """handler 가 통합 시도 시작마다 부른다 — 자기 세션·자기 커밋(BE §7 단계 경계)."""
    async with session_scope() as session:
        await job_repository.set_attempt(session, job_id=job_id, attempt=attempt)


async def finish(
    session: AsyncSession,
    *,
    job_id: int,
    status: str,
    error_code: str | None = None,
    error_message: str | None = None,
) -> None:
    """handler 가 **대상 리소스의 종결과 같은 트랜잭션**에서 부른다(회의 `ended` + job `succeeded` 가 한 커밋)."""
    await job_repository.finish(
        session,
        job_id=job_id,
        status=status,
        finished_at=datetime.now(UTC),
        error_code=error_code,
        error_message=error_message,
    )


# --- 기동 스윕 (BE §5-3) -----------------------------------------------------------


def launch_sweep() -> asyncio.Task:
    """앱 기동 시 — 스윕을 **별도 태스크**로 띄운다. 실패해도 기동을 막지 않고, 예외는 완료 콜백이 로그로 드러낸다."""
    return _spawn(sweep_on_startup(), name="job-sweep")


async def sweep_on_startup() -> int:
    """`queued`/`running` 잔여를 `failed(job_timeout)` 로 마감하고 handler 의 `on_timeout` 을 부른다. 마감한 수를 돌려준다.

    재개하지 않는다 — 재시작 전의 태스크는 죽었고, 통합은 「다시 생성」으로 처음부터 도는 것이 맞다.
    """
    async with session_scope() as session:
        stale = await job_repository.list_unfinished(session)
    for job in stale:
        logger.warning("기동 스윕: job %s(kind=%s, status=%s) 를 job_timeout 으로 마감합니다", job.id, job.kind, job.status)
        await _close_as_timeout(job, message=_SWEEP_MESSAGE)
    return len(stale)


# --- 조회 (SPEC-008 §4 `GET /api/jobs/{jobId}`) ------------------------------------------


def derive_progress(job: JobDTO, *, final_started: bool) -> JobProgressDTO | None:
    """`progress{phase, attempt}` — **파생**(컬럼이 아니다 · SPEC-008 §4).

    `final_started` 는 「그 회의에 `meeting_batch_run(phase='final')` 행이 생겼는가」다 —
    생기기 전은 ① 재전사(`transcription`), 생긴 뒤는 ② 최종 회의록(`final`)이다.
    `kind≠meeting_finalize` 면 `None`.
    """
    if job.kind != JobKind.MEETING_FINALIZE.value:
        return None
    phase = JobPhase.FINAL.value if final_started else JobPhase.TRANSCRIPTION.value
    return JobProgressDTO(phase=phase, attempt=job.attempt)


async def get_detail(session: AsyncSession, *, account_id: int, job_id: int) -> JobDetailDTO:
    job = await job_repository.find(session, account_id=account_id, job_id=job_id)
    if job is None:
        raise NotFoundError(_NOT_FOUND)
    final_started = False
    if job.kind == JobKind.MEETING_FINALIZE.value:
        run = await meeting_batch_run_repository.find_latest_by_phase(
            session, job.target_id, phase=BatchPhase.FINAL.value
        )
        final_started = run is not None
    return JobDetailDTO(job=job, progress=derive_progress(job, final_started=final_started))
