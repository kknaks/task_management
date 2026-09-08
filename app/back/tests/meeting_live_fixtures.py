"""WORK-007 테스트 공통 — `recording` 회의 · 같은 DB 세션을 쓰는 세션 경계 · 배치 스케줄 기록기.

**`conftest.py` 가 아니므로 자동 수집되지 않는다** — 쓰는 쪽에서 이름을 import 한다.
대역(Soniox · codex · storage)은 `conftest.py` 의 autouse 픽스처가 `integrations/` 경계에 이미 끼웠다.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from dto.enums import MeetingTrack, TaskStatus
from dto.meeting_stream import AudioDeclaration
from models.meeting import MeetingAgenda, MeetingTranscript
from models.task import Task
from service import meeting_batch_service, meeting_stream_service
from tests.meeting_fixtures import BASE, MeetingOwner, create_meeting

AUDIO = AudioDeclaration(format="pcm_s16le", sample_rate=16000, channels=1)


@pytest.fixture
def live_scope(monkeypatch: pytest.MonkeyPatch, db_session: AsyncSession) -> Iterator[None]:
    """스트림·배치 서비스의 「단계마다 새 세션」을 **테스트의 세션 하나**로 묶는다 — 롤백 격리를 지키기 위해서다."""

    @asynccontextmanager
    async def scope() -> AsyncIterator[AsyncSession]:
        yield db_session
        await db_session.flush()

    monkeypatch.setattr(meeting_stream_service, "session_scope", scope)
    monkeypatch.setattr(meeting_batch_service, "session_scope", scope)
    meeting_batch_service.reset_state()
    yield
    meeting_batch_service.reset_state()


@pytest.fixture
def batch_log(caplog: pytest.LogCaptureFixture) -> Iterator[pytest.LogCaptureFixture]:
    """배치 서비스 로거의 `caplog`.

    `migrated_database` 가 도는 alembic `env.py` 의 `fileConfig()` 가 **이미 만들어진 로거를 전부 끈다**(`disable_existing_loggers`
    기본값) — 앱 프로세스에서는 alembic 이 돌지 않으므로 테스트에서만 생기는 일이다. 검사 대상 로거 하나만 도로 켠다.
    """
    logger = logging.getLogger("service.meeting_batch_service")
    was_disabled = logger.disabled
    logger.disabled = False
    yield caplog
    logger.disabled = was_disabled


class ScheduleRecorder:
    """`meeting_batch_service.schedule` 대역 — 백그라운드 태스크를 띄우지 않고 호출만 적는다(세션 공유 때문)."""

    def __init__(self) -> None:
        self.calls: list[tuple[int, str]] = []

    def __call__(self, meeting_id: int, cause: str) -> None:
        self.calls.append((meeting_id, cause))


@pytest.fixture
def schedule_calls(monkeypatch: pytest.MonkeyPatch) -> ScheduleRecorder:
    recorder = ScheduleRecorder()
    monkeypatch.setattr(meeting_batch_service, "schedule", recorder)
    return recorder


async def start_meeting(
    client: AsyncClient, owner: MeetingOwner, **overrides: object
) -> dict:
    """생성 + `/start` — `recording` 상세를 돌려준다. 기본 안건 둘."""
    overrides.setdefault("agendas", [{"title": "첫째 안건"}, {"title": "둘째 안건"}])
    created = await create_meeting(client, owner, **overrides)
    response = await client.post(f"{BASE}/{created['id']}/start", headers=owner.headers)
    assert response.status_code == 200, response.text
    # WORK-010 — `/start` 는 웜스타트를 **기다리지 않는다**(MF-1). 응답 뒤 커밋 훅이 태스크를 띄운다.
    # 테스트는 그 태스크가 끝난 상태를 전제로 이어지므로(배치가 `ai_session_id` 를 쓴다) 여기서 거둔다.
    # 「기다리지 않는다」 자체는 `test_meeting_start_warm.py` 가 따로 단언한다.
    await meeting_batch_service.wait_for_tasks()
    return response.json()


async def add_block(
    session: AsyncSession,
    meeting_id: int,
    *,
    content: str,
    speaker: str = "1",
    at_ms: int = 0,
    end_ms: int | None = None,
) -> int:
    """확정 발화 블록을 직접 넣는다(스트림을 거치지 않고 배치 입력을 만든다)."""
    row = MeetingTranscript(
        meeting_id=meeting_id,
        speaker_label=speaker,
        at_ms=at_ms,
        end_ms=at_ms + 1000 if end_ms is None else end_ms,
        content=content,
    )
    session.add(row)
    await session.flush()
    return row.id


async def add_ai_agenda(
    session: AsyncSession, meeting_id: int, *, title: str, source_agenda_id: int | None = None
) -> int:
    row = MeetingAgenda(
        meeting_id=meeting_id,
        track=MeetingTrack.AI.value,
        title=title,
        order_index=0,
        state=None,
        source_agenda_id=source_agenda_id,
    )
    session.add(row)
    await session.flush()
    return row.id


async def add_task(
    session: AsyncSession, owner: MeetingOwner, *, title: str, project_id: int | None
) -> int:
    row = Task(
        account_id=owner.id,
        work_type_id=owner.task_type_id,
        project_id=project_id,
        title=title,
        status=TaskStatus.TODO.value,
        due_date=date(2026, 9, 30),
    )
    session.add(row)
    await session.flush()
    return row.id
