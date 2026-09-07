"""WORK-010 Phase 1·2 — `/start` 는 전이만 · 웜스타트는 컨텍스트 없이 백그라운드.

정본: SPEC-006 §4 `POST …/start` · SPEC-007 §4 「웜스타트」 표 5행 · §5 · §6 AC · DEC-003 §7 · §8 ·
MF-1(즉시 응답) · MF-50(컨텍스트 안 싣는다) · MF-55(용어 다섯) · MF-70(실패 처리 없음).

**BE §12 8-a 가 여기 있다** — 워커를 막아 둔 채 회의가 시작되는가.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from core.db import run_after_commit_hooks
from integrations.agent import AgentRunResult
from models.job import Job
from models.meeting import Meeting, MeetingBatchRun
from service import auth_service, meeting_batch_service, meeting_service
from tests.fakes.agent import WARM_SESSION_ID, FakeAgentGateway
from tests.meeting_fixtures import BASE, MeetingOwner, create_meeting, owner  # noqa: F401
from tests.meeting_live_fixtures import (  # noqa: F401
    add_block,
    batch_log,
    live_scope,
    start_meeting,
)

pytestmark = pytest.mark.usefixtures("live_scope")

TRANSCRIPT = "transcript"

BACK_DIR = Path(__file__).resolve().parents[1]

# WORK-009 `integrations/agent.py` 의 `enabled_tools` 와 **글자 그대로** 같아야 한다
TOOL_NAMES = (
    "get_meeting",
    "get_account",
    "list_agendas",
    "get_agenda",
    "list_tasks",
    "get_task",
    "list_work_types",
)


async def _meeting_row(session: AsyncSession, meeting_id: int) -> Meeting:
    return (await session.scalars(select(Meeting).where(Meeting.id == meeting_id))).one()


async def _start_directly(
    client: AsyncClient, session: AsyncSession, owner: MeetingOwner
) -> int:
    """`meeting_service.start()` 를 **직접** 부른다 — 커밋 훅이 아직 돌지 않은 상태를 보려고."""
    created = await create_meeting(client, owner)
    await meeting_service.start(session, account_id=owner.id, meeting_id=created["id"])
    return created["id"]


# --- Phase 1 — `/start` 는 전이만 --------------------------------------------------


async def test_start_does_not_touch_the_gateway_before_the_commit_hook_runs(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner, fake_agent: FakeAgentGateway
) -> None:
    """**커밋이 안 되면 웜스타트도 없다.** `start()` 가 돌아온 시점에 게이트웨이 호출은 0건이다(MF-1)."""
    meeting_id = await _start_directly(client, db_session, owner)

    # 전이는 이미 났고 응답을 만들 재료도 다 있다 — 그런데 codex 는 아직 안 불렸다
    assert (await _meeting_row(db_session, meeting_id)).status == "recording"
    assert fake_agent.calls == []

    await run_after_commit_hooks(db_session)
    await meeting_batch_service.wait_for_tasks()

    assert len(fake_agent.calls) == 1


async def test_the_hook_never_runs_when_the_request_does_not_commit(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner, fake_agent: FakeAgentGateway
) -> None:
    """훅을 돌리지 않으면 — 즉 요청이 커밋되지 않았으면 — 제출이 **0건**이다."""
    await _start_directly(client, db_session, owner)
    await meeting_batch_service.wait_for_tasks()

    assert fake_agent.calls == []


async def test_start_stores_the_session_id_in_a_later_transaction(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner, fake_agent: FakeAgentGateway
) -> None:
    """웜스타트가 성공하면 `ai_session_id` 가 **나중에** 찬다. 그 뒤 배치가 정상 제출된다."""
    detail = await start_meeting(client, owner)
    assert (await _meeting_row(db_session, detail["id"])).ai_session_id == WARM_SESSION_ID

    fake_agent.calls.clear()
    await add_block(db_session, detail["id"], content="가" * 600)
    assert await meeting_batch_service.evaluate(detail["id"], TRANSCRIPT) is True
    assert fake_agent.calls[0].session_id == WARM_SESSION_ID


async def test_warm_start_submission_parameters(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner, fake_agent: FakeAgentGateway
) -> None:
    """새 세션 · 스키마 없음 · 웜스타트 상한 · **회의 토큰 원문**(WP §Internal Interface 제출 파라미터)."""
    detail = await start_meeting(client, owner)
    token = await auth_service.get_meeting_token(db_session, meeting_id=detail["id"])

    call = fake_agent.calls[0]
    assert call.session_id is None
    assert call.output_schema is None
    assert call.timeout_sec == get_settings().ai_timeout_sec
    assert call.meeting_token == token


async def test_warm_start_is_not_submitted_without_a_meeting_token(
    client: AsyncClient,
    db_session: AsyncSession,
    owner: MeetingOwner,
    fake_agent: FakeAgentGateway,
    batch_log: pytest.LogCaptureFixture,
) -> None:
    """토큰이 없으면 **제출하지 않는다** — 도구가 전부 401 이 될 뿐이다. 로그 한 줄이 전부다(MF-70)."""
    detail = await start_meeting(client, owner)
    await auth_service.revoke_meeting_token(db_session, meeting_id=detail["id"])
    fake_agent.calls.clear()

    with batch_log.at_level("WARNING", logger="service.meeting_batch_service"):
        await meeting_batch_service._warm_start_once(detail["id"])

    assert fake_agent.calls == []
    assert "회의 토큰이 없어" in batch_log.text


# --- BE §12 8-a — 워커를 막아 둔 채 회의 시작 -------------------------------------------


async def test_8a_meeting_starts_while_the_worker_is_down(
    client: AsyncClient,
    db_session: AsyncSession,
    owner: MeetingOwner,
    fake_agent: FakeAgentGateway,
    batch_log: pytest.LogCaptureFixture,
) -> None:
    """BE §12 8-a · SPEC-007 §6 AC — 워커가 죽어 있어도 **회의는 시작된다**.

    응답이 오고 · `recording` 이고 · `recording_started_at` 이 찼고 · `ai_session_id` 는 `NULL` 이다.
    그 상태에서 배치 트리거를 밀어도 **제출이 나가지 않고**, DB 어디에도 실패 기록이 없다(MF-70).
    """
    created = await create_meeting(client, owner)
    fake_agent.will_raise(RuntimeError("worker down"))

    response = await client.post(f"{BASE}/{created['id']}/start", headers=owner.headers)
    await meeting_batch_service.wait_for_tasks()

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "recording" and body["recordingStartedAt"] is not None

    row = await _meeting_row(db_session, created["id"])
    assert row.status == "recording" and row.recording_started_at is not None
    assert row.ai_session_id is None

    # 트리거를 밀어도 제출 0 — 세션이 없으면 배치는 나가지 않는다(SPEC-007 §5 검증 0)
    fake_agent.calls.clear()
    await add_block(db_session, created["id"], content="가" * 600)
    meeting_batch_service.schedule(created["id"], TRANSCRIPT)
    await meeting_batch_service.wait_for_tasks()
    assert fake_agent.calls == []

    # **실패 기록이 없다** — 상태도 컬럼도 행도 만들지 않았다(MF-70)
    runs = (
        await db_session.scalars(
            select(MeetingBatchRun).where(MeetingBatchRun.meeting_id == created["id"])
        )
    ).all()
    jobs = (await db_session.scalars(select(Job).where(Job.account_id == owner.id))).all()
    assert list(runs) == [] and list(jobs) == []


async def test_warm_start_failure_leaves_the_meeting_recording(
    client: AsyncClient,
    db_session: AsyncSession,
    owner: MeetingOwner,
    fake_agent: FakeAgentGateway,
    batch_log: pytest.LogCaptureFixture,
) -> None:
    """예외는 **응답에 닿지 않는다**(전에는 500 이었다). 태스크 콜백이 스택을 로그로 남기고 끝이다."""
    created = await create_meeting(client, owner)
    fake_agent.will_raise(RuntimeError("broker down"))

    with batch_log.at_level("ERROR", logger="service.meeting_batch_service"):
        response = await client.post(f"{BASE}/{created['id']}/start", headers=owner.headers)
        await meeting_batch_service.wait_for_tasks()

    assert response.status_code == 200
    assert (await _meeting_row(db_session, created["id"])).status == "recording"
    assert "웜스타트 태스크가 예외로 끝났습니다" in batch_log.text


async def test_a_missing_session_id_is_not_stored_silently(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner, fake_agent: FakeAgentGateway
) -> None:
    """워커가 `session_id` 없이 끝내면 전파한다 — `ai_session_id` 는 `NULL` 로 남는다(조용한 기본값 없음)."""
    created = await create_meeting(client, owner)
    fake_agent.will_return(AgentRunResult(session_id=None, output=""))

    await client.post(f"{BASE}/{created['id']}/start", headers=owner.headers)
    await meeting_batch_service.wait_for_tasks()

    assert (await _meeting_row(db_session, created["id"])).ai_session_id is None


# --- Phase 2 — 프롬프트 -----------------------------------------------------------


def _prompt() -> str:
    return meeting_batch_service.build_warm_start_prompt()


def test_the_prompt_takes_no_argument() -> None:
    """인자가 없다 — 회의마다 달라질 것이 없다(MF-50)."""
    assert _prompt() == meeting_batch_service.build_warm_start_prompt()


@pytest.mark.parametrize(
    "needle", ["humanAgendas", "taskWhitelist", '"tasks"', '"project"', "컨텍스트:"]
)
def test_the_prompt_carries_no_context(needle: str) -> None:
    """프로젝트 · 업무 목록 · 안건 · 화이트리스트가 **없다**(MF-50 — AI 가 도구로 조회한다)."""
    assert needle not in _prompt()


def test_the_prompt_has_no_json_block() -> None:
    """실을 데이터가 없으므로 `_dumps` 도 JSON 블록도 없다."""
    prompt = _prompt()
    assert "{" not in prompt and "}" not in prompt


def test_the_prompt_lists_exactly_the_seven_tools() -> None:
    """도구 이름 일곱이 전부 있고 **그 밖의 도구 이름이 없다** — WORK-009 `enabled_tools` 와 글자 그대로."""
    found = sorted(set(re.findall(r"\b(?:get|list)_[a-z_]+", _prompt())))

    assert found == sorted(TOOL_NAMES)


def test_the_prompt_matches_the_allow_list_in_the_option_builder() -> None:
    """프롬프트와 codex 설정이 **같은 일곱**을 말한다 — 어긋나면 없는 도구를 부르려다 시간을 버린다."""
    from integrations.agent import _TOOL_NAMES

    assert sorted(_TOOL_NAMES) == sorted(TOOL_NAMES)


@pytest.mark.parametrize("term", ["안건", "논의", "결정", "액션", "업무"])
def test_the_prompt_defines_the_five_terms(term: str) -> None:
    """용어 다섯의 **뜻**이 각각 한 절씩 있다(MF-55 · DEC-003 §8) — F-10 의 원인이 여기였다."""
    assert f"\n{term} — " in _prompt()


def test_the_prompt_says_the_agenda_is_the_backbone() -> None:
    assert "안건이 뼈대" in _prompt()


def test_the_prompt_has_the_six_sections_and_the_closing_line() -> None:
    prompt = _prompt()
    headings = re.findall(r"^## (.+)$", prompt, flags=re.MULTILINE)

    assert headings == [
        "회의는 이렇게 흐른다",
        "무엇을 만드나 — 안건이 뼈대고 나머지는 거기서 파생된다",
        "어떻게 요약하나",
        "쓸 수 있는 도구",
        "쓰면 안 되는 것",
    ]
    # ① 역할은 머리글 없이 첫 문단이다
    assert prompt.startswith("너는 회의에 참가하는 두 명 중 하나다")
    assert prompt.endswith("이번 요청에는 아무것도 만들지 말고 「준비됨」이라고만 답하라.")


def test_the_prompt_fits_on_a_page() -> None:
    """워커 로그에서 한눈에 읽혀야 한다 — 컨텍스트를 뺀 이유의 절반이 이것이다."""
    assert len(_prompt()) < 4000


# --- 정적 검사 — 옛 경로와 실패 갈래가 코드에 없다 -------------------------------------


def _source(name: str) -> str:
    return (BACK_DIR / "service" / name).read_text(encoding="utf-8")


@pytest.mark.parametrize(
    "needle", ["session.commit(", "load_warm_start_context", "WarmStartContext"]
)
def test_meeting_service_no_longer_commits_or_loads_context(needle: str) -> None:
    """`/start` 가 전이만 한다 — 이 파일에 `commit()` 호출이 **0건**이다(BE §7)."""
    assert needle not in _source("meeting_service.py")


@pytest.mark.parametrize("needle", ["_task_rows", "WarmStartContext", "load_warm_start_context"])
def test_the_context_loaders_are_gone(needle: str) -> None:
    assert needle not in _source("meeting_batch_service.py")


def test_no_retry_or_attempt_around_the_warm_start() -> None:
    """**실패 갈래를 만들지 않는다**(MF-70) — 웜스타트 절에 `retry` · `attempt` 가 0건.

    배치·종료 쪽의 기존 `attempt` 는 그대로다(그건 SPEC-008 이 정한 시도 횟수다).
    """
    source = _source("meeting_batch_service.py")
    start = source.index("# --- 웜스타트")
    end = source.index("async def wait_for_tasks")
    warm_start_section = source[start:end]

    assert "retry" not in warm_start_section
    assert "attempt" not in warm_start_section
    assert "warm_start_failed" not in source
