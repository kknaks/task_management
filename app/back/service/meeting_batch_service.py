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

**WORK-008 이 더한 것 — `run_final()`**: 종료 파이프라인 ①(최종 배치). 범위 = 전체, 결과가 검증을 지나면 AI 트랙 **전량 교체**(M-7).
실패면 증분 상태 그대로(DEC-003 §7 L139). 두 번째 배치 경로가 아니라 같은 검증 4단 · 같은 스키마 · 같은 `_persist` 다.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import date
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
from service import meeting_stream_service

logger = logging.getLogger(__name__)

# 배치 출력 스키마 — codex `--output-schema` 와 재검증이 **같은 파일**을 본다. WORK-008 최종 배치도 이 파일이다
OUTPUT_SCHEMA = Path(__file__).resolve().parents[1] / "ai_schemas" / "meeting_batch.json"
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
    """테스트 격리용 — 타이머를 취소하고 락을 버린다."""
    for handle in _timers.values():
        handle.cancel()
    _timers.clear()
    _locks.clear()


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
    meeting: MeetingAiContextDTO
    seq: int
    blocks: list[TranscriptItemDTO]
    human_agendas: list[MeetingAgendaDTO]
    human_lines: list[MeetingLineDTO]
    ai_agendas: list[MeetingAgendaDTO]
    tasks: list[TaskContextDTO]

    @property
    def whitelist(self) -> frozenset[int]:
        return frozenset(task.id for task in self.tasks)


@dataclass
class _OutputLine:
    """스키마를 통과한 출력 한 줄 — 3단(강등)·4단(적재)이 이 형태를 쓴다."""

    human_agenda_id: int | None
    ai_agenda_id: int | None
    new_title: str | None
    kind: str
    content: str
    detail: str | None
    evidence: list[dict[str, int]]
    task_id: int | None


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

    # ① 읽기 — 한 세션. 커밋(닫힘) 뒤 외부 호출로 간다
    async with session_scope() as session:
        batch_input = await _load_input(session, meeting_id)
    if batch_input is None:
        return
    if batch_input.meeting.ai_session_id is None:
        # 웜스타트가 세션을 남기지 않았다 — 설계한 실패가 아니다(M-12). 전파한다
        raise RuntimeError(f"회의 {meeting_id} 에 AI 세션이 없습니다")

    first_id, last_id = batch_input.blocks[0].id, batch_input.blocks[-1].id

    # ② 제출 — 검증 1단: 워커 오류·타임아웃만 `failed`
    try:
        result = await agent_integration.get_gateway().run(
            prompt=build_batch_prompt(batch_input),
            session_id=batch_input.meeting.ai_session_id,
            output_schema=OUTPUT_SCHEMA,
            timeout_sec=settings.meeting_batch_timeout_sec,
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

    # ③ 검증 2단: 스키마 — 위반이면 전체 폐기(행 0)
    try:
        lines = _parse_output(result.output, batch_input)
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

    # ④ 검증 3단: 화이트리스트 — 그 줄만 강등
    demoted = [_demote_if_needed(line, batch_input.whitelist, meeting_id=meeting_id) for line in lines]

    # ⑤ 검증 4단: 적재 — 한 트랜잭션. 커밋 직후 push
    async with session_scope() as session:
        new_agendas, new_lines = await _persist(session, batch_input, demoted)
        await meeting_batch_run_repository.create_run(
            session,
            meeting_id=meeting_id,
            seq=batch_input.seq,
            phase=BatchPhase.INCREMENTAL.value,
            status=BatchRunStatus.SUCCEEDED.value,
            from_transcript_id=first_id,
            to_transcript_id=last_id,
        )

    await meeting_stream_service.push_ai_batch(
        meeting_id, seq=batch_input.seq, agendas=new_agendas, lines=new_lines
    )


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

    return _BatchInput(
        meeting=meeting,
        seq=await meeting_batch_run_repository.next_seq(session, meeting_id),
        blocks=blocks,
        human_agendas=await meeting_child_repository.list_agendas_by_track(
            session, meeting_id, track=MeetingTrack.HUMAN.value
        ),
        human_lines=await meeting_line_repository.list_human_lines_since(
            session, meeting_id, since=blocks[0].created_at
        ),
        ai_agendas=await meeting_child_repository.list_agendas_by_track(
            session, meeting_id, track=MeetingTrack.AI.value
        ),
        tasks=await task_repository.list_meeting_context(
            session, account_id=meeting.account_id, project_id=meeting.project_id
        ),
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

    `phase='final'` 이면 SPEC-008 「마지막 배치 실패」의 기록이다 — AI 탭 안내 바 「종결 정리 실패」의 원천(`finalBatchState`).
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


# --- ① 최종 배치 (SPEC-008 §4 종료 파이프라인 · M-7 · DEC-003 §7 L139) ----------------------------


async def run_final(meeting_id: int, *, timeout_sec: int) -> bool:
    """**AI 트랙 전체 재정리** — 회의 전체 트랜스크립트 + 사람 안건·줄 + 화이트리스트를 **같은 세션**에 보내고, 결과가
    스키마·화이트리스트 검증을 지나면 `track='ai'` 안건·줄을 **한 트랜잭션에서 DELETE + INSERT** 한다(M-7).

    실패(워커 오류 · 상한 초과 · 스키마 위반)면 **증분 상태 그대로**(§7 L139) — 검증 전에 지우지 않는다(SPEC-008 §5).
    돌려주는 값 = 성공 여부. `meeting_finalize_service` 만 부른다. 회의당 락을 **기다려** 잡는다 — 진행 중인 증분 배치가
    끝난 뒤에 돈다(동시 실행 0 · M-12). 입력·출력 스키마는 증분과 같고 범위만 전체다(SPEC-008 §4 표 ①).
    """
    _assert_single_session()
    async with _lock_for(meeting_id):
        _disarm_timer(meeting_id)
        return await _run_final_once(meeting_id, timeout_sec=timeout_sec)


async def _run_final_once(meeting_id: int, *, timeout_sec: int) -> bool:
    async with session_scope() as session:
        batch_input = await _load_final_input(session, meeting_id)
    if batch_input.meeting.ai_session_id is None:
        raise RuntimeError(f"회의 {meeting_id} 에 AI 세션이 없습니다")

    first_id = batch_input.blocks[0].id if batch_input.blocks else None
    last_id = batch_input.blocks[-1].id if batch_input.blocks else None
    phase = BatchPhase.FINAL.value

    try:
        result = await agent_integration.get_gateway().run(
            prompt=build_final_prompt(batch_input),
            session_id=batch_input.meeting.ai_session_id,
            output_schema=OUTPUT_SCHEMA,
            timeout_sec=timeout_sec,
        )
    except (AgentRunFailed, AgentRunTimeout) as exc:
        await _record(meeting_id, seq=batch_input.seq, status=BatchRunStatus.FAILED.value,
                      first_id=first_id, last_id=last_id, reason=str(exc), phase=phase)
        return False

    try:
        lines = _parse_output(result.output, batch_input)
    except _SchemaViolation as exc:
        await _record(meeting_id, seq=batch_input.seq, status=BatchRunStatus.DISCARDED.value,
                      first_id=first_id, last_id=last_id, reason=str(exc), phase=phase)
        return False

    demoted = [_demote_if_needed(line, batch_input.whitelist, meeting_id=meeting_id) for line in lines]

    # 검증을 통과한 결과로만 전량 교체 — 줄 → 안건 순(FK). 그리고 새 결과 INSERT. 한 트랜잭션
    async with session_scope() as session:
        await meeting_line_repository.delete_by_track(
            session, meeting_id=meeting_id, track=MeetingTrack.AI.value
        )
        await meeting_child_repository.delete_agendas_by_track(
            session, meeting_id=meeting_id, track=MeetingTrack.AI.value
        )
        await _persist(session, batch_input, demoted)
        await meeting_batch_run_repository.create_run(
            session,
            meeting_id=meeting_id,
            seq=batch_input.seq,
            phase=phase,
            status=BatchRunStatus.SUCCEEDED.value,
            from_transcript_id=first_id,
            to_transcript_id=last_id,
        )
    return True


async def _load_final_input(session: AsyncSession, meeting_id: int) -> _BatchInput:
    """범위 = **전체**. 기존 AI 안건은 입력에 넣지 않는다(`ai_agendas=[]`) — 전량 교체라 `aiAgendaId` 참조가 설 자리가 없다.
    사람 안건은 `humanAgendaId`, 그 밖은 `newTitle` 로만 낸다."""
    meeting = await meeting_repository.find_ai_context(session, meeting_id=meeting_id)
    if meeting is None:
        raise RuntimeError(f"회의 {meeting_id} 가 없습니다")
    return _BatchInput(
        meeting=meeting,
        seq=await meeting_batch_run_repository.next_seq(session, meeting_id),
        blocks=await meeting_transcript_repository.list_after(session, meeting_id, after_id=None),
        human_agendas=await meeting_child_repository.list_agendas_by_track(
            session, meeting_id, track=MeetingTrack.HUMAN.value
        ),
        human_lines=await meeting_line_repository.list_human_lines_since(
            session, meeting_id, since=None
        ),
        ai_agendas=[],
        tasks=await task_repository.list_meeting_context(
            session, account_id=meeting.account_id, project_id=meeting.project_id
        ),
    )


# --- 검증 2단 · 3단 -------------------------------------------------------------


def _parse_output(output: str, batch_input: _BatchInput) -> list[_OutputLine]:
    """구조·타입·enum·길이(스키마 파일) + `agenda` 키 정확히 하나 · evidence 구간 · 참조 안건 소속(코드).

    **부분 파싱이 없다** — 어느 항목 하나라도 어긋나면 전체가 `_SchemaViolation` 이다(M-16).
    """
    try:
        data = json.loads(output)
    except json.JSONDecodeError as exc:
        raise _SchemaViolation(f"JSON 이 아니다: {exc.msg}") from exc

    error = jsonschema.exceptions.best_match(_validator.iter_errors(data))
    if error is not None:
        raise _SchemaViolation(f"스키마 위반: {error.message}")

    human_ids = {agenda.id for agenda in batch_input.human_agendas}
    ai_ids = {agenda.id for agenda in batch_input.ai_agendas}
    # 최종 배치는 블록이 0개일 수 있다 — 그때 어떤 evidence 구간도 범위 안일 수 없다
    last_end_ms = max((block.end_ms for block in batch_input.blocks), default=0)

    lines: list[_OutputLine] = []
    for index, item in enumerate(data["items"]):
        agenda = item["agenda"]
        keys = [key for key in ("humanAgendaId", "aiAgendaId", "newTitle") if agenda[key] is not None]
        if len(keys) != 1:
            raise _SchemaViolation(f"items[{index}].agenda 는 키가 정확히 하나여야 한다")
        if agenda["humanAgendaId"] is not None and agenda["humanAgendaId"] not in human_ids:
            raise _SchemaViolation(f"items[{index}].agenda.humanAgendaId 가 이 회의의 사람 안건이 아니다")
        if agenda["aiAgendaId"] is not None and agenda["aiAgendaId"] not in ai_ids:
            raise _SchemaViolation(f"items[{index}].agenda.aiAgendaId 가 이 회의의 AI 안건이 아니다")
        for evidence in item["evidence"]:
            if not (0 <= evidence["fromMs"] < evidence["toMs"] <= last_end_ms):
                raise _SchemaViolation(f"items[{index}].evidence 구간이 범위 밖이다")
        lines.append(
            _OutputLine(
                human_agenda_id=agenda["humanAgendaId"],
                ai_agenda_id=agenda["aiAgendaId"],
                new_title=agenda["newTitle"],
                kind=item["kind"],
                content=item["content"],
                detail=item["detail"],
                evidence=[{"fromMs": e["fromMs"], "toMs": e["toMs"]} for e in item["evidence"]],
                task_id=item["taskId"],
            )
        )
    return lines


def _demote_if_needed(line: _OutputLine, whitelist: frozenset[int], *, meeting_id: int) -> _OutputLine:
    """DEC-003 §7 「없는 업무 참조」 — 화이트리스트 밖 `taskId` · `task` 인데 `taskId` 없음 → **그 줄만** `action`.

    본문·상세·근거는 그대로 산다(M-15). `task` 가 아닌 줄의 `taskId` 는 뜻이 없어 뗀다(강등 아님) — 단 **조용히 지나가지 않는다**:
    SPEC-007 §4 L421 「`taskId` — `kind=task` 일 때만」을 어긴 출력이라 사유를 로그로 남긴다. 폐기(2단)로 볼지 무시로 볼지는
    문서가 정한다(검수 D-5) — 정해지기 전까지 동작은 그대로, 로그만 더한다(W-4).
    """
    if line.kind != LineKind.TASK.value:
        if line.task_id is not None:
            logger.warning(
                "회의 %s 배치 출력 정정: kind=%s 줄에 taskId=%s 가 왔다 — kind=task 일 때만 뜻이 있어 뗀다(SPEC-007 §4 L421)",
                meeting_id,
                line.kind,
                line.task_id,
            )
            line.task_id = None
        return line
    if line.task_id is None or line.task_id not in whitelist:
        line.kind = LineKind.ACTION.value
        line.task_id = None
    return line


# --- 검증 4단: 적재 -------------------------------------------------------------


async def _persist(
    session: AsyncSession, batch_input: _BatchInput, lines: list[_OutputLine]
) -> tuple[list[MeetingAgendaDTO], list[MeetingLineDTO]]:
    """`newTitle` 은 AI 안건 신설(`source_agenda_id=NULL`) · `humanAgendaId` 는 미러 AI 안건이 없으면 **한 번만** 만든다.

    줄은 `track='ai'` **INSERT 만**(M-7). 같은 배치 안에서 같은 `newTitle` 은 한 안건으로 모은다.
    """
    meeting_id = batch_input.meeting.id
    new_agendas: list[MeetingAgendaDTO] = []
    mirrored: dict[int, int] = {}
    created_by_title: dict[str, int] = {}
    new_line_ids: list[int] = []

    async def _new_ai_agenda(title: str, source_agenda_id: int | None) -> int:
        order_index = await meeting_child_repository.next_agenda_order_index(
            session, meeting_id=meeting_id, track=MeetingTrack.AI.value
        )
        agenda = await meeting_child_repository.create_agenda(
            session,
            meeting_id=meeting_id,
            track=MeetingTrack.AI.value,
            title=title,
            order_index=order_index,
            state=None,
            source_agenda_id=source_agenda_id,
        )
        new_agendas.append(agenda)
        return agenda.id

    human_titles = {agenda.id: agenda.title for agenda in batch_input.human_agendas}

    for line in lines:
        if line.ai_agenda_id is not None:
            agenda_id = line.ai_agenda_id
        elif line.human_agenda_id is not None:
            agenda_id = mirrored.get(line.human_agenda_id)  # type: ignore[assignment]
            if agenda_id is None:
                existing = await meeting_child_repository.find_ai_agenda_by_source(
                    session, meeting_id=meeting_id, source_agenda_id=line.human_agenda_id
                )
                agenda_id = (
                    existing.id
                    if existing is not None
                    else await _new_ai_agenda(
                        human_titles[line.human_agenda_id], line.human_agenda_id
                    )
                )
                mirrored[line.human_agenda_id] = agenda_id
        else:
            assert line.new_title is not None  # 2단이 보장했다
            agenda_id = created_by_title.get(line.new_title)  # type: ignore[assignment]
            if agenda_id is None:
                agenda_id = await _new_ai_agenda(line.new_title, None)
                created_by_title[line.new_title] = agenda_id

        order_index = await meeting_line_repository.next_order_index(session, agenda_id=agenda_id)
        new_line_ids.append(
            await meeting_line_repository.create_line(
                session,
                meeting_id=meeting_id,
                agenda_id=agenda_id,
                track=MeetingTrack.AI.value,
                kind=line.kind,
                content=line.content,
                order_index=order_index,
                detail=line.detail,
                evidence=line.evidence,
                task_id=line.task_id,
            )
        )

    new_lines = await meeting_line_repository.find_by_ids(session, line_ids=new_line_ids)
    return new_agendas, new_lines


# --- 웜스타트 (`/start` 안에서 1회 — SPEC-007 §4) -----------------------------------


@dataclass(frozen=True)
class WarmStartContext:
    meeting: MeetingAiContextDTO
    agendas: list[MeetingAgendaDTO]
    tasks: list[TaskContextDTO]


async def load_warm_start_context(session: AsyncSession, *, meeting_id: int) -> WarmStartContext:
    """프로젝트 + 그 프로젝트의 업무(무소속 회의면 무소속 업무) + 미리 작성된 사람 안건(DEC-003 §8 L149 · §4 L98)."""
    meeting = await meeting_repository.find_ai_context(session, meeting_id=meeting_id)
    if meeting is None:
        raise RuntimeError(f"회의 {meeting_id} 가 없습니다")
    return WarmStartContext(
        meeting=meeting,
        agendas=await meeting_child_repository.list_agendas_by_track(
            session, meeting_id, track=MeetingTrack.HUMAN.value
        ),
        tasks=await task_repository.list_meeting_context(
            session, account_id=meeting.account_id, project_id=meeting.project_id
        ),
    )


async def warm_start(context: WarmStartContext) -> str:
    """새 세션을 만들고 그 `session_id` 를 돌려준다. **결과 본문은 버린다.** 트랜잭션 밖에서 부른다(BE §7)."""
    _assert_single_session()
    result = await agent_integration.get_gateway().run(
        prompt=build_warm_start_prompt(context),
        session_id=None,
        output_schema=None,
        timeout_sec=get_settings().ai_timeout_sec,
    )
    if not result.session_id:
        # 세션 없이는 배치가 이어질 수 없다(M-12) — 설계한 실패가 아니다. 전파한다
        raise RuntimeError("웜스타트가 세션 id 를 돌려주지 않았습니다")
    return result.session_id


# --- 프롬프트 -----------------------------------------------------------------


def _date(value: date | None) -> str | None:
    return None if value is None else value.isoformat()


def _task_rows(tasks: list[TaskContextDTO]) -> list[dict[str, object]]:
    return [
        {
            "id": task.id,
            "title": task.title,
            "status": task.status,
            "dueDate": _date(task.due_date),
            "workType": task.work_type_name,
        }
        for task in tasks
    ]


def _agenda_rows(agendas: list[MeetingAgendaDTO], *, with_source: bool = False) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for agenda in agendas:
        row: dict[str, object] = {"id": agenda.id, "title": agenda.title, "orderIndex": agenda.order_index}
        if with_source:
            row["sourceAgendaId"] = agenda.source_agenda_id
        else:
            row["state"] = agenda.state
        rows.append(row)
    return rows


def _dumps(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2)


def build_warm_start_prompt(context: WarmStartContext) -> str:
    payload = {
        "project": None if context.meeting.project_id is None else {
            "id": context.meeting.project_id,
            "name": context.meeting.project_name,
        },
        "tasks": _task_rows(context.tasks),
        "humanAgendas": _agenda_rows(context.agendas),
    }
    return (
        "너는 회의록 AI 요약 담당이다. 지금부터 한 회의가 시작된다. 아래 컨텍스트(프로젝트 · 업무 목록 · "
        "미리 작성된 안건)를 기억해 두고, 이후 같은 세션으로 오는 배치 요청에서 참조한다.\n"
        "업무 목록의 id 만 이후 `taskId` 로 쓸 수 있다. 목록 밖의 업무를 만들어 내지 마라.\n"
        "이번 요청에는 아무 작업도 하지 말고 「준비됨」이라고만 답하라.\n\n"
        f"컨텍스트:\n{_dumps(payload)}"
    )


def build_final_prompt(batch_input: _BatchInput) -> str:
    """① 최종 배치 — 회의 전체를 다시 정리한다. 출력 스키마는 증분과 같다(SPEC-008 §4 표 ①)."""
    payload = {
        "transcript": [
            {
                "id": block.id,
                "speakerLabel": block.speaker_label,
                "atMs": block.at_ms,
                "endMs": block.end_ms,
                "content": block.content,
            }
            for block in batch_input.blocks
        ],
        "humanAgendas": _agenda_rows(batch_input.human_agendas),
        "humanLines": [
            {"agendaId": line.agenda_id, "kind": line.kind, "content": line.content}
            for line in batch_input.human_lines
        ],
        "taskWhitelist": sorted(batch_input.whitelist),
    }
    return (
        "회의가 끝났다. **마지막 배치**다 — 아래 회의 전체 확정 발화(transcript)를 처음부터 다시 읽고 AI 요약 트랙을 "
        "**전체 재정리**한 결과를 낸다. 이전 배치에서 낸 AI 줄은 전부 버려지고 이 출력이 AI 요약 탭 전체가 된다.\n"
        "사람 안건(humanAgendas)과 사람 줄(humanLines)은 읽기 전용 컨텍스트다 — 고치지도 제안하지도 마라. "
        "줄은 반드시 안건 하나에 붙인다: 맞는 사람 안건이 있으면 `humanAgendaId`, 어디에도 맞지 않으면 `newTitle` 로 "
        "새 안건을 만든다. **`aiAgendaId` 는 쓰지 마라**(기존 AI 안건은 이 출력으로 대체된다).\n"
        "`evidence` 는 근거가 된 발화의 [atMs, endMs] 구간이다(최대 3개). `taskId` 는 kind 가 task 일 때만, "
        "taskWhitelist 안의 id 만 쓴다. 출력은 지정된 JSON 스키마 그대로다.\n\n"
        f"입력:\n{_dumps(payload)}"
    )


def build_batch_prompt(batch_input: _BatchInput) -> str:
    payload = {
        "transcript": [
            {
                "id": block.id,
                "speakerLabel": block.speaker_label,
                "atMs": block.at_ms,
                "endMs": block.end_ms,
                "content": block.content,
            }
            for block in batch_input.blocks
        ],
        "humanAgendas": _agenda_rows(batch_input.human_agendas),
        "humanLines": [
            {"agendaId": line.agenda_id, "kind": line.kind, "content": line.content}
            for line in batch_input.human_lines
        ],
        "aiAgendas": _agenda_rows(batch_input.ai_agendas, with_source=True),
        "taskWhitelist": sorted(batch_input.whitelist),
    }
    return (
        "회의 중 증분 배치다. 아래 미처리 확정 발화(transcript)에서 새로 드러난 논의 · 결정 · 업무 · 액션을 "
        "AI 요약 트랙에 **추가할 줄**로만 낸다. 기존 AI 줄을 고치거나 지우지 않는다.\n"
        "사람 안건(humanAgendas)과 사람 줄(humanLines)은 읽기 전용 컨텍스트다 — 고치지도 제안하지도 마라. "
        "줄은 반드시 안건 하나에 붙인다: 맞는 사람 안건이 있으면 `humanAgendaId`, 이미 있는 AI 안건이면 "
        "`aiAgendaId`, 어디에도 맞지 않으면 `newTitle` 로 새 안건을 만든다(세 키 중 정확히 하나만 값).\n"
        "`evidence` 는 근거가 된 발화의 [atMs, endMs] 구간이다(최대 3개). `taskId` 는 kind 가 task 일 때만, "
        "taskWhitelist 안의 id 만 쓴다. 출력은 지정된 JSON 스키마 그대로다.\n\n"
        f"입력:\n{_dumps(payload)}"
    )
