"""3층 — `job` 의 ORM/SQL 만(BE §5-3 · §6). `commit()` 하지 않는다.

- 폴링 조회는 `account_id` 로 먼저 좁힌다(§9) — 남의 job 은 없는 것과 같다.
- 실행기·스윕은 서버 내부라 요청 주체가 없다 — `find_for_runner`·`list_unfinished` 만 `account_id` 없이 읽는다.
- **상태 대입은 `mark_running`·`finish` 둘뿐**이고 부르는 곳은 `job_service` 하나다.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from dto.enums import JOB_TERMINAL_STATUSES, JobStatus
from dto.job import JobDTO
from models.job import Job


def _to_dto(row: Job) -> JobDTO:
    return JobDTO(
        id=row.id,
        account_id=row.account_id,
        kind=row.kind,
        target_type=row.target_type,
        target_id=row.target_id,
        status=row.status,
        attempt=row.attempt,
        error_code=row.error_code,
        error_message=row.error_message,
        finished_at=row.finished_at,
        created_at=row.created_at,
    )


async def create(
    session: AsyncSession, *, account_id: int, kind: str, target_type: str, target_id: int
) -> JobDTO:
    """`queued` 로 만든다 — 태스크 기동은 커밋 뒤(`job_service.launch`)다."""
    row = Job(
        account_id=account_id,
        kind=kind,
        target_type=target_type,
        target_id=target_id,
        status=JobStatus.QUEUED.value,
        attempt=0,
    )
    session.add(row)
    await session.flush()
    await session.refresh(row)
    return _to_dto(row)


async def find(session: AsyncSession, *, account_id: int, job_id: int) -> JobDTO | None:
    """폴링 — **본인 것만**. 남의 것은 None(404)."""
    row = (
        await session.scalars(select(Job).where(Job.id == job_id, Job.account_id == account_id))
    ).one_or_none()
    return None if row is None else _to_dto(row)


async def find_for_runner(session: AsyncSession, *, job_id: int) -> JobDTO | None:
    """실행기가 읽는다 — 요청 주체가 없어 `account_id` 로 좁히지 않는 조회다."""
    row = (await session.scalars(select(Job).where(Job.id == job_id))).one_or_none()
    return None if row is None else _to_dto(row)


async def find_active_job_id(
    session: AsyncSession, *, target_type: str, target_id: int
) -> int | None:
    """`activeJobId` 파생 — 그 리소스의 `queued`/`running` job. 없으면 None. 둘 이상이면 설계 위반이라 그대로 터진다."""
    return await session.scalar(
        select(Job.id).where(
            Job.target_type == target_type,
            Job.target_id == target_id,
            Job.status.not_in(JOB_TERMINAL_STATUSES),
        )
    )


async def list_unfinished(session: AsyncSession) -> list[JobDTO]:
    """기동 스윕 대상 — `queued`/`running` 잔여 전부(BE §5-3)."""
    rows = (
        await session.scalars(
            select(Job).where(Job.status.not_in(JOB_TERMINAL_STATUSES)).order_by(Job.id)
        )
    ).all()
    return [_to_dto(row) for row in rows]


async def mark_running(session: AsyncSession, *, job_id: int) -> None:
    await session.execute(
        update(Job)
        .where(Job.id == job_id)
        .values(status=JobStatus.RUNNING.value)
        .execution_options(synchronize_session="fetch")
    )
    await session.flush()


async def set_attempt(session: AsyncSession, *, job_id: int, attempt: int) -> None:
    """통합 시도 회차 — `progress.attempt` 의 원천. 시도 **시작** 때 올린다."""
    await session.execute(
        update(Job)
        .where(Job.id == job_id)
        .values(attempt=attempt)
        .execution_options(synchronize_session="fetch")
    )
    await session.flush()


async def finish(
    session: AsyncSession,
    *,
    job_id: int,
    status: str,
    finished_at: datetime,
    error_code: str | None = None,
    error_message: str | None = None,
) -> None:
    """종결 — `succeeded` 또는 `failed(error_code)`. 종결 상태 밖의 값은 받지 않는다."""
    if status not in JOB_TERMINAL_STATUSES:
        raise ValueError(f"종결 상태가 아니다: {status}")
    await session.execute(
        update(Job)
        .where(Job.id == job_id)
        .values(
            status=status,
            finished_at=finished_at,
            error_code=error_code,
            error_message=None if error_message is None else error_message[:2000],
        )
        .execution_options(synchronize_session="fetch")
    )
    await session.flush()
