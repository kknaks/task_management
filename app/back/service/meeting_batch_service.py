"""2층 — 회의 중 AI 배치 파이프라인(WP Phase 4 · SPEC-007 §4 「AI 배치 계약」 · DEC-003 §7 · BE §8-3).

한 곳으로 못박는 것 —

1. **트리거 판정은 `evaluate(meeting_id, cause)` 하나다.** 셋 중 먼저 오는 것이 배치를 낸다 — ① 미처리 확정 발화
   `MEETING_BATCH_CHARS`(600) ② 안건 전환 즉시(미처리 `MEETING_BATCH_SWITCH_MIN_CHARS`(80) 미만이면 생략)
   ③ 미처리 구간이 생긴 뒤 `MEETING_BATCH_MAX_WAIT_SEC`(180). 수치는 전부 env(DEC-003 §STT L164).
2. **회의당 락 하나** — 배치가 도는 중에 온 트리거는 **아무것도 하지 않는다**(다음 트리거 때 커진 구간으로).
   회의당 AI 세션 하나(M-12)와 같은 뜻이다.
3. **검증 4단은 SPEC-007 §4 표 순서 그대로**이고 설계한 실패만 잡는다 —
   ① 워커 오류·타임아웃 → `failed` ② 스키마 위반 → **전체 폐기** `discarded`(행 0) ③ 화이트리스트 밖 `taskId` →
   **그 줄만** `action` 강등(본문·상세·근거 유지) ④ 적재 → `succeeded` + `seq`. **광범위한 예외 포착이 없다** —
   그 밖(프로토콜 오류)은 전파한다(BASE-003 L43).
4. 커서 = **성공분** `to_transcript_id`. 실패·폐기 구간은 다음 배치에 합쳐진다.
5. **적재 트랜잭션 커밋 직후 `meeting_stream_service.push_ai_batch()`** — 세션이 없으면 건너뛴다(다음 `ready` 의
   `latestBatchSeq` 로 따라잡는다). 버퍼링하지 않는다(M-6-a).
6. **codex·Soniox 호출 중에는 트랜잭션을 열어 두지 않는다**(BE §7) — 읽기 → 커밋 → 제출 → 새 세션에서 쓰기.
   백그라운드 태스크라 요청 경계가 없으므로 단계마다 `session_scope()` 를 연다.

AI 는 `track='ai'` 에만 INSERT 한다(M-6). 사람 안건·줄은 **읽기 전용 컨텍스트**로 프롬프트에 들어간다(BASE-003 L36·L38).

**종료 시 배치는 없다**(MF-56 · WORK-012) — 회의가 끝나면 codex 호출은 ② 최종 회의록 하나뿐이다.
이 모듈이 종료 파이프라인에 주는 것은 **검증 함수 셋**(`_parse_output` · `_demote_if_needed` · `_persist`)이고,
`meeting_finalize_service` 가 `fill_final=True` · `track='merged'` 로 그대로 쓴다 — 복제하지 않는다(MF-52).
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path

import jsonschema
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from core.db import SessionLocal
from dto.enums import (
    BatchPhase,
    BatchRunStatus,
    BatchTriggerCause,
    LineKind,
    MeetingStatus,
    MeetingTrack,
)
from dto.meeting import (
    MeetingAgendaDTO,
    MeetingAiContextDTO,
    MeetingLineDTO,
    TaskContextDTO,
    TranscriptItemDTO,
)
from integrations import agent as agent_integration
from integrations.agent import AgentRunFailed, AgentRunTimeout
from repository import (
    meeting_batch_run_repository,
    meeting_child_repository,
    meeting_line_repository,
    meeting_repository,
    meeting_transcript_repository,
    task_repository,
)
from service import auth_service, meeting_stream_service

logger = logging.getLogger(__name__)

# 출력 스키마 — codex `--output-schema` 와 재검증이 **같은 파일**을 본다.
# **한 벌이다**(MF-52) — 회의 중 배치와 최종 회의록(WORK-012)이 이 파일 하나를 건다.
OUTPUT_SCHEMA = Path(__file__).resolve().parents[1] / "ai_schemas" / "meeting_notes.json"
_validator = jsonschema.Draft202012Validator(json.loads(OUTPUT_SCHEMA.read_text(encoding="utf-8")))


# --- 세션 경계 --------------------------------------------------------------


@asynccontextmanager
async def _default_session_scope() -> AsyncIterator[AsyncSession]:
    """백그라운드 단계 하나 = 세션 하나 = 커밋 하나(BE §7). 예외면 커밋하지 않는다."""
    async with SessionLocal() as session:
        yield session
        await session.commit()


# 테스트가 이 자리를 자기 세션으로 바꾼다(대역은 `integrations/` 에서만 — 세션 경계는 인프라다)
session_scope: Callable[[], AsyncIterator[AsyncSession]] = _default_session_scope  # type: ignore[assignment]


# --- 실행 상태 (프로세스 안) ----------------------------------------------------

_locks: dict[int, asyncio.Lock] = {}
_timers: dict[int, asyncio.TimerHandle] = {}
_tasks: set[asyncio.Task] = set()


def reset_state() -> None:
    """테스트 격리용 — 타이머·락·**떠 있는 태스크**를 전부 버린다.

    태스크까지 끊는 이유(WORK-010 검수 W-1) — `/start` 가 웜스타트를 인라인으로 기다리지 않게 되면서
    `/start` 를 부르는 모든 테스트가 태스크 하나를 띄운다. 남겨 두면 ① 다음 테스트의 `wait_for_tasks()` 가
    남의 태스크까지 gather 하고 ② 대역 게이트웨이가 걷힌 뒤 그 태스크가 **진짜 게이트웨이**를 만들며
    ③ 루프가 닫힐 때 pending 경고가 난다.
    """
    for handle in _timers.values():
        handle.cancel()
    _timers.clear()
    _locks.clear()
    for task in tuple(_tasks):
        task.cancel()
    _tasks.clear()


def is_timer_armed(meeting_id: int) -> bool:
    return meeting_id in _timers


def _lock_for(meeting_id: int) -> asyncio.Lock:
    return _locks.setdefault(meeting_id, asyncio.Lock())


def _assert_single_session() -> None:
    """회의당 AI 세션 **하나**(M-12). env 가 다른 값을 말하면 기동이 아니라 첫 배치에서 터진다 — 조용히 넘기지 않는다."""
    if get_settings().meeting_batch_sessions_per_meeting != 1:
        raise RuntimeError("MEETING_BATCH_SESSIONS_PER_MEETING 은 1 만 지원한다(M-12)")


# --- 트리거 -----------------------------------------------------------------


def schedule(meeting_id: int, cause: str) -> None:
    """요청·스트림 경로에서 부르는 진입점 — **커밋 뒤** 백그라운드 태스크로 `evaluate` 를 돈다."""
    task = asyncio.create_task(evaluate(meeting_id, cause))
    _tasks.add(task)
    task.add_done_callback(_on_batch_task_done)


def _on_batch_task_done(task: asyncio.Task) -> None:
    """배치는 요청 경계 밖이라 500 이 없다 — 설계 밖 예외(`ai_session_id` 없음 · 브로커 도달 불가 · 프로토콜 오류)를
    **여기서 읽어 스택째 로그로 드러낸다**(BE §8-1 「전파 = 로그에 스택」 · WORK-007 검수 W-2). 삼키지 않는다 — 태스크는 그 예외로 끝난다."""
    _tasks.discard(task)
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.error("회의 배치 태스크가 설계 밖 예외로 끝났습니다", exc_info=exc)


def _arm_timer(meeting_id: int) -> None:
    """미처리 구간이 생긴 뒤 상한(180초)에 `evaluate('timer')`. 이미 걸려 있으면 그대로 둔다."""
    if meeting_id in _timers:
        return
    loop = asyncio.get_running_loop()
    _timers[meeting_id] = loop.call_later(
        get_settings().meeting_batch_max_wait_sec,
        lambda: schedule(meeting_id, BatchTriggerCause.TIMER.value),
    )


def _disarm_timer(meeting_id: int) -> None:
    handle = _timers.pop(meeting_id, None)
    if handle is not None:
        handle.cancel()


async def _pending_chars(meeting_id: int) -> int:
    async with session_scope() as session:
        cursor = await meeting_batch_run_repository.succeeded_cursor(session, meeting_id)
        return await meeting_transcript_repository.sum_chars_after(
            session, meeting_id, after_id=cursor
        )


async def evaluate(meeting_id: int, cause: str) -> bool:
    """트리거 3종 판정. 배치를 냈으면 True. **실행 중이면 아무것도 하지 않는다**(다음 트리거 때 커진 구간으로)."""
    lock = _lock_for(meeting_id)
    if lock.locked():
        return False
    if cause == BatchTriggerCause.TIMER.value:
        _timers.pop(meeting_id, None)

    settings = get_settings()
    pending = await _pending_chars(meeting_id)
    if cause == BatchTriggerCause.TRANSCRIPT.value:
        fire = pending >= settings.meeting_batch_chars
    elif cause == BatchTriggerCause.AGENDA_SWITCH.value:
        fire = pending >= settings.meeting_batch_switch_min_chars
    elif cause == BatchTriggerCause.TIMER.value:
        fire = pending > 0
    else:
        raise ValueError(f"알 수 없는 트리거: {cause}")

    if not fire:
        if pending > 0:
            _arm_timer(meeting_id)
        return False

    await run(meeting_id)
    return True


# --- 실행 -------------------------------------------------------------------


@dataclass(frozen=True)
class _BatchInput:
    """배치 입력 — **발화뿐이다**(MF-50 · SPEC-007 §4 「배치 입력」 표).

    안건 · 사람 줄 · AI 안건 · 업무 화이트리스트를 싣지 않는다. AI 가 MCP 도구(WORK-009)로 조회하고,
    조회하면 그 순간 최신이다. `meeting` 은 세션 id 와 소유 계정을 알기 위한 것이지 프롬프트에 실리지 않는다.
    """

    meeting: MeetingAiContextDTO
    seq: int
    blocks: list[TranscriptItemDTO]


@dataclass
class _OutputLine:
    """스키마를 통과한 줄 하나 — 안건(`_OutputAgenda`) 아래에 산다.

    `payload` 는 회의 중(`fill_final=False`)에는 **읽고 버려** 언제나 `None` 이다(MF-52 · 검증 순서 4행).
    최종(`fill_final=True`)에서만 값이 실린다 — 그때도 담는 자리는 하나다(두 번째 파서를 만들지 않는다).
    """

    kind: str
    content: str
    detail: str | None
    evidence: list[dict[str, int]]
    task_id: int | None
    payload: dict | None = None


@dataclass(frozen=True)
class _OutputNotes:
    """`_parse_output(fill_final=True)` 의 결과 — 최종 전용 필드까지 담는다.

    회의 중(`False`)은 `agendas` 만 돌려받으므로 이 형태를 쓰지 않는다. **한 함수가 두 모드**이고
    반환 타입만 갈린다 — 파서를 둘로 두면 스키마가 둘로 갈린다(MF-52).
    """

    headline: str | None
    term_corrections: list[dict[str, str]]
    agendas: list["_OutputAgenda"]


@dataclass
class _OutputAgenda:
    """스키마를 통과한 안건 하나. **출력이 AI 트랙 전체**라 이 목록이 곧 새 트랙이다(MF-53).

    `human_agenda_id` 가 있으면 미러(제목은 사람 안건 것을 복사한다 — M-5-b), 없으면 AI 신설이다.
    """

    human_agenda_id: int | None
    title: str
    lines: list[_OutputLine]


# SPEC-008 §4 「`payload` 자리」 — `action`·`task` 줄에만 뜻이 있다. DB CHECK 와 같은 값이다
_PAYLOAD_KINDS = frozenset({LineKind.ACTION.value, LineKind.TASK.value})


class _SchemaViolation(Exception):
    """검증 2단 실패 — 배치 전체 폐기(M-16). 이 모듈 안에서만 쓴다."""


async def run(meeting_id: int) -> None:
    """회의당 락 아래에서 한 회차를 돈다. **락이 잡혀 있으면 기다리지 않고 돌아간다** — 동시 실행 0(M-12)."""
    _assert_single_session()
    lock = _lock_for(meeting_id)
    if lock.locked():
        return
    async with lock:
        await _run_once(meeting_id)
        _disarm_timer(meeting_id)
        if await _pending_chars(meeting_id) > 0:
            _arm_timer(meeting_id)


async def _run_once(meeting_id: int) -> None:
    settings = get_settings()

    # ① 읽기 — 한 세션. 커밋(닫힘) 뒤 외부 호출로 간다.
    #    회의 토큰 원문도 여기서 읽는다(A-13) — codex 가 MCP 도구를 부를 때 헤더로 쓴다
    async with session_scope() as session:
        batch_input = await _load_input(session, meeting_id)
        meeting_token = (
            None
            if batch_input is None
            else await auth_service.get_meeting_token(session, meeting_id=meeting_id)
        )
    if batch_input is None:
        return
    # 검증 0 — `ai_session_id` 가 없으면 **제출하지 않는다**(SPEC-007 §4 검증 순서 0행 · MF-1 · MF-70).
    # 구간은 미처리로 남고 다음 트리거 때 다시 평가된다. 화면 표시도 기록도 없다 — 로그 한 줄뿐이다.
    if batch_input.meeting.ai_session_id is None:
        logger.info("회의 %s 에 AI 세션이 없어 배치를 제출하지 않습니다", meeting_id)
        return
    # 토큰이 없거나 만료됐다 — 제출해도 도구가 전부 401 이다. **세션 없음과 같은 취급**이다
    if meeting_token is None:
        logger.warning("회의 %s 에 회의 토큰이 없어 배치를 제출하지 않습니다", meeting_id)
        return

    first_id, last_id = batch_input.blocks[0].id, batch_input.blocks[-1].id

    # ② 제출 — 검증 1단: 워커 오류·타임아웃만 `failed`
    try:
        result = await agent_integration.get_gateway().run(
            prompt=build_batch_prompt(batch_input),
            session_id=batch_input.meeting.ai_session_id,
            output_schema=OUTPUT_SCHEMA,
            timeout_sec=settings.meeting_batch_timeout_sec,
            meeting_token=meeting_token,
        )
    except (AgentRunFailed, AgentRunTimeout) as exc:
        await _record(
            meeting_id,
            seq=batch_input.seq,
            status=BatchRunStatus.FAILED.value,
            first_id=first_id,
            last_id=last_id,
            reason=str(exc),
        )
        return

    # ③ 검증 2단: 스키마 — 위반이면 **전체 폐기**(행 0 · AI 트랙은 직전 성공분 그대로 · M-16 · M-7).
    #    사람 안건 소속 검사는 **검사 시점 조회**다 — 입력에 안건을 싣지 않으므로(MF-50) 여기서 읽는다
    async with session_scope() as session:
        human_agenda_ids = {
            agenda.id
            for agenda in await meeting_child_repository.list_agendas_by_track(
                session, meeting_id, track=MeetingTrack.HUMAN.value
            )
        }
    try:
        agendas = _parse_output(
            result.output,
            human_agenda_ids=human_agenda_ids,
            last_end_ms=max(block.end_ms for block in batch_input.blocks),
        )
    except _SchemaViolation as exc:
        await _record(
            meeting_id,
            seq=batch_input.seq,
            status=BatchRunStatus.DISCARDED.value,
            first_id=first_id,
            last_id=last_id,
            reason=str(exc),
        )
        return

    # ④ 검증 3단: 업무 참조 사후 검사 — **검사 시점에** 조회한 집합으로 그 줄만 강등(M-15 · MF-50).
    #    제출 뒤에 생긴 업무를 AI 가 가리켜도 강등되지 않는다
    async with session_scope() as session:
        allowed_task_ids = {
            task.id
            for task in await task_repository.list_meeting_context(
                session,
                account_id=batch_input.meeting.account_id,
                project_id=batch_input.meeting.project_id,
            )
        }
    for agenda in agendas:
        agenda.lines = [
            _demote_if_needed(line, allowed_task_ids, meeting_id=meeting_id)
            for line in agenda.lines
        ]

    # ⑤ 검증 5단: 적재 — **전량 교체** 한 트랜잭션(MF-53 · M-7). 커밋 직후 push
    async with session_scope() as session:
        tree = await _persist(session, meeting_id=meeting_id, agendas=agendas)
        await meeting_batch_run_repository.create_run(
            session,
            meeting_id=meeting_id,
            seq=batch_input.seq,
            phase=BatchPhase.INCREMENTAL.value,
            status=BatchRunStatus.SUCCEEDED.value,
            from_transcript_id=first_id,
            to_transcript_id=last_id,
        )

    await meeting_stream_service.push_ai_batch(meeting_id, seq=batch_input.seq, agendas=tree)


async def _load_input(session: AsyncSession, meeting_id: int) -> _BatchInput | None:
    meeting = await meeting_repository.find_ai_context(session, meeting_id=meeting_id)
    if meeting is None:
        raise RuntimeError(f"회의 {meeting_id} 가 없습니다")
    if meeting.status != MeetingStatus.RECORDING.value:
        # 회의 중 증분만(M-7). 종료 후 최종 배치는 WORK-008 이 다른 진입점으로 돈다
        return None

    cursor = await meeting_batch_run_repository.succeeded_cursor(session, meeting_id)
    blocks = await meeting_transcript_repository.list_after(session, meeting_id, after_id=cursor)
    if not blocks:
        return None

    # **커서 · 블록뿐이다**(MF-50) — 안건 · 사람 줄 · AI 안건 · 업무를 읽지 않는다
    return _BatchInput(
        meeting=meeting,
        seq=await meeting_batch_run_repository.next_seq(session, meeting_id),
        blocks=blocks,
    )


async def _record(
    meeting_id: int,
    *,
    seq: int,
    status: str,
    first_id: int | None,
    last_id: int | None,
    reason: str,
    phase: str = BatchPhase.INCREMENTAL.value,
) -> None:
    """실패·폐기 기록 — **커서는 전진하지 않는다**(성공분만 커서다). 사용자에게 표시할 것이 없다.

    `phase='final'` 이면 종료 파이프라인 ② 의 실패한 시도다(SPEC-008 §4) — 재시도 회차가 `seq` 다.
    """
    async with session_scope() as session:
        await meeting_batch_run_repository.create_run(
            session,
            meeting_id=meeting_id,
            seq=seq,
            phase=phase,
            status=status,
            from_transcript_id=first_id,
            to_transcript_id=last_id,
            reason=reason[:2000],
        )


# --- 검증 2단 · 3단 -------------------------------------------------------------


def _parse_output(
    output: str,
    *,
    human_agenda_ids: set[int],
    last_end_ms: int,
    fill_final: bool = False,
) -> list[_OutputAgenda] | _OutputNotes:
    """검증 2단 — 구조 · 타입 · enum · 길이(스키마 파일) + evidence 구간 · `humanAgendaId` 소속(코드).

    **부분 파싱이 없다** — 어느 항목 하나라도 어긋나면 전체가 `_SchemaViolation` 이고 행이 하나도 안 들어간다(M-16).

    `humanAgendaId` 는 **이 회의의 사람 안건**이어야 한다. AI 안건 id 를 넣으면 위반이다 —
    AI 안건은 배치마다 새로 생기므로(MF-53) 참조할 대상이 아니다.

    **한 함수가 두 모드**다(파서를 둘로 두지 않는다 — MF-52) —
    `fill_final=False`(회의 중)는 `payload`·`headline`·`termCorrections` 를 **읽고 버리고** `list[_OutputAgenda]` 를,
    `True`(최종 회의록 · WORK-012)는 셋을 채워 `_OutputNotes` 를 돌려준다. 버리는 것은 폐기 사유가 아니다(검증 순서 4행).
    """
    try:
        data = json.loads(output)
    except json.JSONDecodeError as exc:
        raise _SchemaViolation(f"JSON 이 아니다: {exc.msg}") from exc

    error = jsonschema.exceptions.best_match(_validator.iter_errors(data))
    if error is not None:
        raise _SchemaViolation(f"스키마 위반: {error.message}")

    agendas: list[_OutputAgenda] = []
    for index, agenda in enumerate(data["agendas"]):
        human_agenda_id = agenda["humanAgendaId"]
        if human_agenda_id is not None and human_agenda_id not in human_agenda_ids:
            raise _SchemaViolation(
                f"agendas[{index}].humanAgendaId 가 이 회의의 사람 안건이 아니다"
            )
        lines: list[_OutputLine] = []
        for line_index, line in enumerate(agenda["lines"]):
            for evidence in line["evidence"]:
                if not (0 <= evidence["fromMs"] < evidence["toMs"] <= last_end_ms):
                    raise _SchemaViolation(
                        f"agendas[{index}].lines[{line_index}].evidence 구간이 범위 밖이다"
                    )
            lines.append(
                _OutputLine(
                    kind=line["kind"],
                    content=line["content"],
                    detail=line["detail"],
                    evidence=[
                        {"fromMs": e["fromMs"], "toMs": e["toMs"]} for e in line["evidence"]
                    ],
                    task_id=line["taskId"],
                    # 회의 중이면 여기서 버린다 — `payload` 는 최종에서만 값이 있다(MF-52)
                    payload=_final_payload(line) if fill_final else None,
                )
            )
        agendas.append(
            _OutputAgenda(
                human_agenda_id=human_agenda_id, title=agenda["title"], lines=lines
            )
        )
    if not fill_final:
        return agendas
    return _OutputNotes(
        headline=data["headline"],
        term_corrections=[dict(row) for row in (data["termCorrections"] or [])],
        agendas=agendas,
    )


def _final_payload(line: dict) -> dict | None:
    """**`payload` 자리**(SPEC-008 §4) — `kind ∈ {action, task}` 줄에만. 그 밖에 실려 오면 **버린다**(폐기 사유 아님)."""
    payload = line["payload"]
    if payload is None or line["kind"] not in _PAYLOAD_KINDS:
        return None
    return dict(payload)


def _demote_if_needed(
    line: _OutputLine, allowed_task_ids: set[int], *, meeting_id: int
) -> _OutputLine:
    """검증 3단 — DEC-003 §7 「없는 업무 참조」. **그 줄만** `action` 으로 강등한다.

    `allowed_task_ids` 는 **입력에 실려 온 화이트리스트가 아니라 검사 시점에 조회한 집합**이다(MF-50 · M-15) —
    배치를 제출한 뒤 만들어진 업무를 AI 가 도구로 보고 가리켰다면 그것은 올바른 참조다.
    본문 · 상세 · 근거는 그대로 산다.

    강등되면 `taskId` 와 `payload` 를 **함께** 뗀다(SPEC-008 §4) — 없는 업무의 변경안은 뜻이 없다.

    `task` 가 아닌 줄의 `taskId` 는 뜻이 없어 뗀다(강등 아님) — 단 **조용히 지나가지 않는다**:
    SPEC-007 §4 「`taskId` — `kind=task` 일 때만」을 어긴 출력이라 사유를 로그로 남긴다.
    """
    if line.kind != LineKind.TASK.value:
        if line.task_id is not None:
            logger.warning(
                "회의 %s 배치 출력 정정: kind=%s 줄에 taskId=%s 가 왔다 — kind=task 일 때만 뜻이 있어 뗀다(SPEC-007 §4)",
                meeting_id,
                line.kind,
                line.task_id,
            )
            line.task_id = None
        return line
    if line.task_id is None or line.task_id not in allowed_task_ids:
        line.kind = LineKind.ACTION.value
        line.task_id = None
        # SPEC-008 §4 「업무 참조」 — `taskId` 와 **`payload` 를 함께** 뗀다. 가리키는 업무가 없어진 변경안이라 뜻이 없다
        line.payload = None
    return line


# --- 검증 5단: 적재 — 전량 교체 ---------------------------------------------------


async def _persist(
    session: AsyncSession,
    *,
    meeting_id: int,
    agendas: list[_OutputAgenda],
    track: str = MeetingTrack.AI.value,
    copy_human_state: bool = False,
) -> list[MeetingAgendaDTO]:
    """**한 트랙 전량 교체**(MF-53 · M-7) — DELETE(줄 → 안건 · FK 순) 뒤 출력대로 INSERT.

    회의 중 배치는 `track='ai'`, 종료 후 ② 최종 회의록은 `track='merged'` 로 **같은 함수**를 쓴다(WORK-012).
    `copy_human_state=True` 면 미러 안건이 사람 안건의 `state` 를 복사한다 — `merged` 만 그렇게 한다
    (AI 안건에는 상태 축이 없다 · SPEC-008 §4 「미러 안건의 `state`」).

    **검증이 끝난 뒤에만 부른다.** 검증 전에 지우면 실패했을 때 직전 성공분이 사라진다(M-7) —
    그래서 `delete_by_track` · `delete_agendas_by_track` 을 부르는 곳은 **이 함수 하나**다(정적 검사).

    `human_agenda_id` 가 있으면 `source_agenda_id` 를 그 id 로 두고 **제목은 사람 안건 것을 복사**한다(M-5-b).
    없으면 `source_agenda_id=NULL` 인 신설이다.

    돌려주는 것은 **줄이 중첩된 트리**다 — 상세 응답의 같은 트랙과 같은 직렬화 함수를 지난다.
    """
    # 순환 import 를 피한다 — `meeting_service` 가 이 모듈을 import 한다.
    # 트리 모양이 둘로 갈리지 않게 **같은 함수**를 쓰는 것이 요점이다(SPEC-007 §4 `ai.batch`)
    from service import meeting_service

    await meeting_line_repository.delete_by_track(session, meeting_id=meeting_id, track=track)
    await meeting_child_repository.delete_agendas_by_track(
        session, meeting_id=meeting_id, track=track
    )

    human = {
        agenda.id: agenda
        for agenda in await meeting_child_repository.list_agendas_by_track(
            session, meeting_id, track=MeetingTrack.HUMAN.value
        )
    }

    for order_index, agenda in enumerate(agendas):
        source = human.get(agenda.human_agenda_id) if agenda.human_agenda_id is not None else None
        created = await meeting_child_repository.create_agenda(
            session,
            meeting_id=meeting_id,
            track=track,
            title=agenda.title if source is None else source.title,
            order_index=order_index,
            state=source.state if (copy_human_state and source is not None) else None,
            source_agenda_id=agenda.human_agenda_id,
        )
        for line_order, line in enumerate(agenda.lines):
            await meeting_line_repository.create_line(
                session,
                meeting_id=meeting_id,
                agenda_id=created.id,
                track=track,
                kind=line.kind,
                content=line.content,
                order_index=line_order,
                detail=line.detail,
                evidence=line.evidence,
                task_id=line.task_id,
                payload=line.payload,
            )

    rows = await meeting_child_repository.list_agendas_by_track(session, meeting_id, track=track)
    lines = await meeting_line_repository.list_by_track(session, meeting_id, track=track)
    return getattr(meeting_service.build_tracks(rows, lines), track)


# --- 웜스타트 (`/start` 의 **커밋 뒤 백그라운드** — MF-1 · SPEC-007 §4 「웜스타트」 표) ------------
#
# `/start` 는 전이만 하고 즉시 응답한다. 웜스타트는 여기서 태스크 하나로 나가고,
# **실패 처리를 만들지 않는다**(MF-70) — 실패의 결과는 `ai_session_id` 가 `NULL` 로 남는 것 하나이고
# 그 뒤는 이미 있는 두 경로가 받는다(회의 중 = 배치 미제출 · 종료 후 = ② `final_failed`).
# 재시도 · 재웜스타트 · 별도 기록 · 상태 컬럼 어느 것도 없다. 예외는 done 콜백이 로그로 드러낸다.


async def launch_warm_start(meeting_id: int) -> None:
    """`/start` 의 **커밋 뒤 훅**이 부른다(`register_after_commit`). 태스크만 띄우고 **즉시 돌아온다**.

    `await` 하지 않는다 — 여기서 기다리면 「회의 시작」이 다시 codex 를 기다리게 된다(MF-1).
    커밋이 안 되면 훅이 돌지 않으므로 **웜스타트도 없다**(`core/db.run_after_commit_hooks`).
    """
    task = asyncio.create_task(_warm_start_once(meeting_id))
    _tasks.add(task)
    task.add_done_callback(_on_warm_start_task_done)


def _on_warm_start_task_done(task: asyncio.Task) -> None:
    """**여기가 웜스타트 실패 처리의 전부다**(MF-70) — 로그 한 줄. 재시도도 기록도 없다.

    모양은 `_on_batch_task_done` 과 같다(BE §8-1 「전파 = 로그에 스택」). 삼키지 않는다.
    """
    _tasks.discard(task)
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.error("회의 웜스타트 태스크가 예외로 끝났습니다", exc_info=exc)


async def _warm_start_once(meeting_id: int) -> None:
    """새 세션을 만들고 `session_id` 만 남긴다. **결과 본문은 버린다.**

    ① 회의 토큰 원문을 읽는다(WORK-009 · A-13). **없으면 제출하지 않는다** — 도구가 전부 401 이 될 뿐이라
       제출에 뜻이 없다. 배치 쪽과 같은 규칙이고, 그때도 결과는 `ai_session_id` 가 `NULL` 로 남는 것뿐이다
    ② 제출 — 새 세션(`session_id=None`) · **`output_schema=None`**(웜스타트는 JSON 을 강제하지 않는다) ·
       컨텍스트 없음(MF-50 — AI 가 도구로 조회한다)
    ③ `session_id` 를 **새 세션**에서 UPDATE. codex 를 기다리는 동안 트랜잭션을 열어 두지 않는다(BE §7)
    """
    _assert_single_session()

    async with session_scope() as session:
        meeting_token = await auth_service.get_meeting_token(session, meeting_id=meeting_id)
    if meeting_token is None:
        # MF-70 — 여기서 끝난다. 재발급도 재시도도 없다
        logger.warning("회의 %s 에 회의 토큰이 없어 웜스타트를 제출하지 않습니다", meeting_id)
        return

    result = await agent_integration.get_gateway().run(
        prompt=build_warm_start_prompt(),
        session_id=None,
        output_schema=None,
        timeout_sec=get_settings().ai_timeout_sec,
        meeting_token=meeting_token,
    )
    if not result.session_id:
        # 세션 없이는 배치가 이어질 수 없다(M-12) — 설계한 실패가 아니다. 전파한다(콜백이 로그)
        raise RuntimeError("웜스타트가 세션 id 를 돌려주지 않았습니다")

    async with session_scope() as session:
        await meeting_repository.set_ai_session_id(
            session, meeting_id=meeting_id, ai_session_id=result.session_id
        )


async def wait_for_tasks() -> None:
    """테스트 격리용 — 떠 있는 백그라운드 태스크를 거둔다(`reset_state` 와 같은 결).

    프로덕션 경로는 이것을 부르지 않는다. 부르면 「기다리지 않는다」가 깨진다.
    """
    while _tasks:
        await asyncio.gather(*tuple(_tasks), return_exceptions=True)


# --- 프롬프트 -----------------------------------------------------------------


def _dumps(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2)


# 종료 파이프라인(`meeting_finalize_service`)이 **같은 함수**를 쓰는 공개 이름 —
# 검증·적재를 복제하지 않는다는 계약이 이 세 줄이다(MF-52 · SPEC-008 §5).
parse_output = _parse_output
demote_if_needed = _demote_if_needed
persist = _persist
dumps = _dumps
SchemaViolation = _SchemaViolation


# 웜스타트 프롬프트 — **여섯 절 고정 상수**(WORK-010 §Internal Interface · 초안 `ai-prompt-draft.md` §A).
#
# **컨텍스트를 싣지 않는다**(MF-50). 프로젝트 · 업무 목록 · 안건 · 유형 · 화이트리스트가 여기 없다 —
# AI 가 필요할 때 MCP 도구로 조회하고, 조회하면 그 순간 최신이다. 데이터를 실을 자리가 없으므로
# 이 문자열에 JSON 블록도 없다(`_dumps` 를 부르지 않는다).
#
# ⑤ 의 도구 이름 일곱은 `integrations/agent.py` 의 `enabled_tools`(WORK-009) 와 **글자 그대로** 같아야 한다.
# 프롬프트에만 있고 설정에 없는 이름을 적으면 AI 가 없는 도구를 부르려다 시간을 버린다.
# 인자 이름은 적지 않는다 — MCP 의 `tools/list` 가 스키마로 이미 알려 준다.
_WARM_START_PROMPT = """너는 회의에 참가하는 두 명 중 하나다. 사람과 AI 가 각자 회의록을 쓰고, 회의가 끝나면 합친다.
사람이 모든 것을 다 칠 수 없고 너도 모든 것을 정확히 요약할 수 없다 — 그래서 둘 다 쓴다.

## 회의는 이렇게 흐른다

회의가 시작되면 사람의 말이 실시간으로 받아쓰기 되어 발화로 너에게 온다.
사람은 그와 별개로 자기 회의록에 안건 · 논의 · 결정 등을 직접 적는다.
너는 네 트랙(AI 요약)에만 쓴다. 사람이 쓴 것을 고치지도, 사람에게 제안하지도 않는다 — 사람 트랙은 읽기 전용이다.

발화는 한 번에 다 오지 않는다. 일정량이 쌓이면 그 구간만 너에게 온다.
회의가 끝나면 마지막으로 전체를 처음부터 다시 읽고 정리한다.
그다음 사람 것과 네 것을 합친다 — 사람이 나중에 보는 것은 합쳐진 회의록이다.

## 무엇을 만드나 — 안건이 뼈대고 나머지는 거기서 파생된다

안건
├─ 논의   아직 정해지지 않은 것
├─ 결정   정해진 것
├─ 액션   새로 생긴 할 일
└─ 업무   이미 있는 업무의 현황 · 변경

논의 · 결정 · 액션 · 업무는 전부 어떤 안건에서 나온다.
안건 없이 떠 있는 줄은 없다 — 「무슨 이야기를 하다 나온 것인가」가 항상 있어야 한다.
그러니 줄을 만들기 전에 먼저 어느 안건인지를 정해라.

안건 — 회의에서 다루는 주제 단위. 「무엇에 대해 이야기하는가」다.
  - 사람이 미리 적어둔 안건이 있으면 거기에 붙인다. 그것이 이 회의의 뼈대다
  - 화제가 조금 옮겨갔다고 새 안건을 만들지 마라. 같은 주제 안에서 이야기가 흐르는 것은 한 안건이다
  - 새로 만드는 것은 정말 어디에도 안 붙을 때만이다
  - 안건 하나에 논의 · 결정 · 액션 · 업무가 여러 개 달린다. 그게 정상이다

논의 — 오간 이야기. 아직 정해지지 않은 것.
  - 의견 · 현황 공유 · 질문 · 「검토가 필요하다」
  - 예: 「A안과 B안 중 고민이 필요하다」

결정 — 이 회의에서 정해진 것. 되돌리려면 다시 회의해야 하는 것.
  - 「~로 한다」 「~는 하지 않는다」 「~로 통일한다」
  - 확실하지 않으면 결정으로 올리지 마라. 논의로 둬라 — 「그렇게 할까요?」는 결정이 아니다

액션 — 이 회의 때문에 새로 생긴 할 일.
  - 「~하기로 했다」 「~를 준비한다」 「다음 주까지 ~한다」
  - 이미 하고 있던 일의 현황 보고는 액션이 아니다 — 그건 업무다
  - 담당 · 기한이 말에 나왔으면 함께 담는다

업무 — 이미 있는 업무의 현황 · 변경.
  - 반드시 실제로 있는 업무를 가리킨다. 없는 업무를 만들어 내지 마라 — 도구로 조회해서 확인해라
  - 기한 변경 · 진행 상태 · 진행 메모 · 완료 결과가 여기 담긴다

## 어떻게 요약하나

- 발화를 그대로 옮기지 마라. 한 문장으로 압축한다. 「어, 그」 같은 말버릇은 버린다
- 말한 사람 이름을 쓰지 마라. 화자는 익명이고 이름을 모른다
- 인사 · 잡담 · 같은 말 반복은 버린다
- 숫자 · 날짜 · 고유명사는 그대로 옮긴다. 383,900원을 「약 38만원」으로 바꾸지 마라
- 말하지 않은 것을 채우지 마라. 흐름상 그럴 것 같아도 발화에 없으면 쓰지 않는다
- 줄마다 근거 구간을 단다 — 그 줄이 어느 발화에서 나왔는지
- 확실하지 않으면 한 단계 낮춰라 — 결정 같으면 논의로, 액션 같으면 논의로

## 쓸 수 있는 도구

  get_meeting        이 회의 정보 — 제목 · 일시 · 유형 · 프로젝트
  get_account        사용자 정보
  list_agendas       안건 목록 — 사람이 적은 안건과 네가 만든 안건 둘 다
  get_agenda         안건 상세 — 그 안건에 달린 줄(논의 · 결정 · 액션 · 업무)
  list_tasks         업무 목록 — 제목 · 상태 · 기한 · 유형
  get_task           업무 상세 — 할일 · 메모 · 연관 · 일정
  list_work_types    업무 유형 목록 — 이름 · 종류 · 설명

  필요할 때 조회해라. 미리 다 주지 않는다.
  도구는 이 회의 · 이 계정 범위에서만 답한다 — 다른 사람 데이터에는 닿지 않는다.

## 쓰면 안 되는 것

  위 도구가 전부다. 그 밖에는 아무것도 쓰지 마라.

  - 셸 · 파일 · 명령 실행 — 쓰지 마라
  - 웹 검색 · 외부 조회 — 쓰지 마라. 회의에서 나온 말만 다룬다
  - 이미지 생성 — 쓰지 마라
  - 쓰기 도구 — 없다. 너는 조회만 한다.
    회의록에 남길 것은 출력으로만 낸다. 도구로 직접 쓰지 않는다(저장하는 것은 서버다)

이번 요청에는 아무것도 만들지 말고 「준비됨」이라고만 답하라."""


def build_warm_start_prompt() -> str:
    """**인자가 없다**(MF-50) — 회의마다 달라질 것이 없어서다. 상수를 그대로 돌려준다."""
    return _WARM_START_PROMPT


_BATCH_INSTRUCTIONS = """회의 중 배치다. 아래는 아직 반영하지 않은 확정 발화다.

**이번 구간을 반영해 AI 트랙 전체를 다시 정리해라.**
앞 배치에서 낸 안건과 줄도 **포함해서 처음부터 다시** 낸다 — 이 출력이 AI 요약 탭 전체가 된다.
앞 배치가 잘못 가른 안건을 합치거나, 잘못 붙인 줄을 옮기는 것도 여기서 한다.

정리하기 전에 이 순서로 조회해라.

  1. list_agendas   지금 안건이 무엇인지 본다 — 사람이 적은 안건과 네가 앞서 만든 안건 둘 다
  2. get_agenda     붙일 안건의 줄을 본다 — 사람이 이미 적어 둔 것을 또 만들지 않으려고
  3. 업무를 가리킬 때만 — list_tasks 로 찾고, get_task 로 확인하고, 필요하면 list_work_types 를 본다

안건은 사람 안건을 미러하면 그 id 를 humanAgendaId 에 넣는다(제목은 서버가 사람 안건 것으로 맞춘다).
어디에도 맞지 않는 새 주제만 humanAgendaId 를 비우고 제목을 직접 짓는다.
evidence 는 근거가 된 발화의 [atMs, endMs] 구간이다(최대 3개).
payload · headline · termCorrections 는 회의 중에는 쓰지 않는다 — null 로 둔다.

발화:
"""


def build_batch_prompt(batch_input: _BatchInput) -> str:
    """**발화 하나뿐이다**(MF-50 · SPEC-007 §4 「배치 입력」 표).

    안건 · 사람 줄 · AI 안건 · 업무 화이트리스트를 싣지 않는다 — AI 가 도구로 조회한다.
    세션이 앞 구간을 기억하므로 앞 발화도 다시 싣지 않는다.
    """
    transcript = [
        {
            "speakerLabel": block.speaker_label,
            "atMs": block.at_ms,
            "endMs": block.end_ms,
            "content": block.content,
        }
        for block in batch_input.blocks
    ]
    return f"{_BATCH_INSTRUCTIONS}{_dumps(transcript)}"
