"""2층 — **종료 파이프라인**(SPEC-008 §4 「종료 파이프라인 · 통합 규칙」 · DEC-003 §4 L104 · §7 · BE §6 · §7 · §8-3).

```
/end ─→ job ─→ ① 최종 배치(AI 트랙 전체 재정리 · 300초 · 실패해도 ②로)
              └→ ② 통합본 + 같은 응답의 headline(180초 × 3회 · 즉시 재시도)
                   ├ 성공: merged INSERT + ai_headline + ended/succeeded + job succeeded — **한 트랜잭션**(M-19 ①)
                   └ 3회 실패: ended/failed · ai_headline NULL · job failed(integration_failed | integration_timeout)
```

한 곳으로 못박는 것 —

1. **`/end` 의 사전 조건은 `recording` 상태 하나다.** 스트림 상태를 보지 않는다 — `paused/stream`(WS 없음)에서도 받는다
   (BE §8-2 L243 · SPEC-007 U-1 L113). WS 가 살아 있으면 `meeting_stream_service.close_for_end()` 로 닫기를 **요청**하고, 없으면 그냥 간다.
2. **① 은 `meeting_batch_service.run_final()`** — 두 번째 배치 경로가 아니다. 실패는 DEC-003 §7 L139 대로 증분 상태 그대로.
3. **② 의 검증은 `meeting_merge_service.validate_and_build()`** — 모델 출력의 텍스트를 여기서 읽지 않는다. `headline` 도 그 함수가 낸 값이다.
4. **`ai_headline` 을 쓰는 코드는 이 파일 하나**(`meeting_repository.finish_integration` 호출) — 별도 호출·별도 엔드포인트 없음(M-19).
5. **설계한 실패만 잡는다** — `AgentRunFailed`·`AgentRunTimeout`(워커 오류·시도 상한)·`IntegrationAttemptFailed`(구조 검증). 그 밖은 전파한다 —
   job 태스크의 완료 콜백이 스택째 로그로 드러낸다(BE §8-1).
6. 단계마다 `session_scope()` — codex 대기 중에 트랜잭션을 열어 두지 않는다(BE §7). 이 파일은 `commit()` 을 부르지 않는다.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from core.db import SessionLocal, register_after_commit
from dto.enums import (
    BatchPhase,
    BatchRunStatus,
    JobErrorCode,
    JobKind,
    JobStatus,
    JobTargetType,
    MeetingStatus,
    MeetingTrack,
)
from dto.job import JobDTO
from dto.meeting import MeetingAgendaDTO, MergePlanDTO
from integrations import agent as agent_integration
from integrations.agent import AgentRunFailed, AgentRunTimeout
from repository import (
    meeting_batch_run_repository,
    meeting_child_repository,
    meeting_line_repository,
    meeting_repository,
)
from service import auth_service, job_service, meeting_batch_service, meeting_merge_service, meeting_service, meeting_stream_service
from service.meeting_merge_service import IntegrationAttemptFailed

logger = logging.getLogger(__name__)


# --- 세션 경계 --------------------------------------------------------------


@asynccontextmanager
async def _default_session_scope() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
        await session.commit()


session_scope: Callable[[], AsyncIterator[AsyncSession]] = _default_session_scope  # type: ignore[assignment]


# --- 요청 표면: /end · /integrate (요청 트랜잭션 안 · 태스크는 커밋 뒤) -----------------------------


async def end(session: AsyncSession, *, account_id: int, meeting_id: int) -> int:
    """`POST …/end` → job id. 순서(SPEC-008 §4) — WS 닫기 요청 → `active→done` → `generating`/`running` → job INSERT → (커밋 뒤) 태스크.

    사전 조건은 허용 표의 `end` 행(`recording`) **하나**다. 스트림 레지스트리를 조건으로 보지 않는다.
    """
    meeting = await meeting_service.require_meeting(session, account_id=account_id, meeting_id=meeting_id)
    meeting_service.assert_allowed(meeting, "end")

    closed = await meeting_stream_service.close_for_end(meeting_id)
    logger.info("회의 %s 종료 — 스트림 %s", meeting_id, "닫기 요청" if closed else "없음(paused/stream 또는 미연결)")

    await meeting_child_repository.mark_active_agendas_done(session, meeting_id=meeting_id)
    await meeting_repository.begin_generating(session, meeting_id=meeting_id)
    job = await job_service.create(
        session,
        account_id=account_id,
        kind=JobKind.MEETING_FINALIZE.value,
        target_type=JobTargetType.MEETING.value,
        target_id=meeting_id,
    )
    _plans[job.id] = True
    register_after_commit(session, _launcher(job.id))
    return job.id


async def integrate(session: AsyncSession, *, account_id: int, meeting_id: int) -> int:
    """`POST …/integrate` → job id. `ended`+`failed` 에서만(허용 표 `integrate` 행 + `integration_state`). **②만** 돈다 — ① 은 다시 돌지 않는다."""
    meeting = await meeting_service.require_meeting(session, account_id=account_id, meeting_id=meeting_id)
    meeting_service.assert_allowed(meeting, "integrate")

    await meeting_repository.begin_generating(session, meeting_id=meeting_id)
    job = await job_service.create(
        session,
        account_id=account_id,
        kind=JobKind.MEETING_FINALIZE.value,
        target_type=JobTargetType.MEETING.value,
        target_id=meeting_id,
    )
    _plans[job.id] = False
    register_after_commit(session, _launcher(job.id))
    return job.id


# job id → ① 을 돌리는가. `/end` 는 True · `/integrate` 는 False. 프로세스 안의 값이라 재시작으로 사라진 job 은 스윕이 마감한다
_plans: dict[int, bool] = {}


def _launcher(job_id: int):
    async def _launch() -> None:
        job_service.launch(job_id)

    return _launch


# --- job handler ----------------------------------------------------------------


@dataclass(frozen=True)
class _IntegrationInput:
    ai_session_id: str | None
    human_agendas: list[MeetingAgendaDTO]
    ai_agendas: list[MeetingAgendaDTO]


class MeetingFinalizeHandler:
    """`job_service` 가 부르는 실행 계약 — `run` 이 파이프라인, `on_timeout` 이 상한 초과 시 회의 마감."""

    async def run(self, job: JobDTO) -> None:
        await run_pipeline(job, final_batch=_plans.pop(job.id, True))

    async def on_timeout(self, job: JobDTO) -> None:
        """job 상한 초과 · 기동 스윕 — 회의를 `ended`+`failed` 로. `ai_headline` 은 NULL 그대로(M-19 ②). 이미 `ended` 면 건드리지 않는다."""
        _plans.pop(job.id, None)
        async with session_scope() as session:
            context = await meeting_repository.find_ai_context(session, meeting_id=job.target_id)
            if context is None or context.status != MeetingStatus.GENERATING.value:
                return
            await meeting_repository.finish_integration(
                session, meeting_id=job.target_id, succeeded=False, headline=None
            )


job_service.register_handler(JobKind.MEETING_FINALIZE.value, MeetingFinalizeHandler())


# --- 파이프라인 ---------------------------------------------------------------


async def run_pipeline(job: JobDTO, *, final_batch: bool) -> None:
    """① (선택) → ② 시도 N회 → 종결. 각 단계가 자기 세션·자기 커밋이다(BE §7)."""
    settings = get_settings()
    meeting_id = job.target_id

    if final_batch:
        succeeded = await meeting_batch_service.run_final(
            meeting_id, timeout_sec=settings.meeting_final_batch_timeout_sec
        )
        if not succeeded:
            logger.warning("회의 %s 최종 배치 실패 — AI 탭은 회의 중 증분 상태 그대로 두고 통합으로 간다(DEC-003 §7)", meeting_id)

    last_reason = ""
    timeouts = 0
    attempts = settings.meeting_integration_attempts
    for attempt in range(1, attempts + 1):
        await job_service.set_attempt(job.id, attempt)
        try:
            plan = await _attempt_integration(meeting_id, timeout_sec=settings.meeting_integration_timeout_sec)
        except AgentRunTimeout as exc:
            timeouts += 1
            last_reason = str(exc)
            await _record_attempt(meeting_id, attempt=attempt, status=BatchRunStatus.FAILED.value, reason=last_reason)
            logger.warning("회의 %s 통합 시도 %s/%s 상한 초과: %s", meeting_id, attempt, attempts, last_reason)
            continue
        except (AgentRunFailed, IntegrationAttemptFailed) as exc:
            last_reason = str(exc)
            await _record_attempt(meeting_id, attempt=attempt, status=BatchRunStatus.FAILED.value, reason=last_reason)
            logger.warning("회의 %s 통합 시도 %s/%s 실패: %s", meeting_id, attempt, attempts, last_reason)
            continue

        await _commit_success(job, meeting_id=meeting_id, attempt=attempt, plan=plan)
        return

    error_code = (
        JobErrorCode.INTEGRATION_TIMEOUT.value
        if timeouts == attempts
        else JobErrorCode.INTEGRATION_FAILED.value
    )
    await _commit_failure(job, meeting_id=meeting_id, error_code=error_code, reason=last_reason)


async def _attempt_integration(meeting_id: int, *, timeout_sec: int) -> MergePlanDTO:
    """읽기(세션) → 커밋 → codex(트랜잭션 없음) → 구조 검증. 적재는 하지 않는다 — 성공 트랜잭션은 `_commit_success` 다."""
    async with session_scope() as session:
        inputs = await _load_integration_input(session, meeting_id)
        meeting_token = await auth_service.get_meeting_token(session, meeting_id=meeting_id)
    if inputs.ai_session_id is None:
        raise RuntimeError(f"회의 {meeting_id} 에 AI 세션이 없습니다")
    if meeting_token is None:
        # 폐기(WORK-012)는 ② 가 **끝난 뒤**다 — 여기서 없다는 것은 발급이 깨졌거나 만료다. 전파한다
        raise RuntimeError(f"회의 {meeting_id} 에 회의 토큰이 없습니다")

    result = await agent_integration.get_gateway().run(
        prompt=build_integration_prompt(inputs.human_agendas, inputs.ai_agendas),
        session_id=inputs.ai_session_id,
        output_schema=meeting_merge_service.OUTPUT_SCHEMA,
        timeout_sec=timeout_sec,
        meeting_token=meeting_token,
    )
    return meeting_merge_service.validate_and_build(
        human_agendas=inputs.human_agendas, ai_agendas=inputs.ai_agendas, output=result.output
    )


async def _load_integration_input(session: AsyncSession, meeting_id: int) -> _IntegrationInput:
    context = await meeting_repository.find_ai_context(session, meeting_id=meeting_id)
    if context is None:
        raise RuntimeError(f"회의 {meeting_id} 가 없습니다")
    return _IntegrationInput(
        ai_session_id=context.ai_session_id,
        human_agendas=await _load_tree(session, meeting_id, track=MeetingTrack.HUMAN.value),
        ai_agendas=await _load_tree(session, meeting_id, track=MeetingTrack.AI.value),
    )


async def _load_tree(session: AsyncSession, meeting_id: int, *, track: str) -> list[MeetingAgendaDTO]:
    """한 트랙의 「안건 > 줄」 트리 — `meeting_service._build_tracks` 와 같은 모양으로 중첩한다."""
    agendas = await meeting_child_repository.list_agendas_by_track(session, meeting_id, track=track)
    lines = await meeting_line_repository.list_by_track(session, meeting_id, track=track)
    tracks = meeting_service.build_tracks(agendas, lines)
    return getattr(tracks, track)


async def _record_attempt(meeting_id: int, *, attempt: int, status: str, reason: str | None) -> None:
    """통합 시도 기록 — `phase='integration'` · `seq`=시도 번호. 배치 회차(`latestBatchSeq`)에는 세지 않는다."""
    async with session_scope() as session:
        await meeting_batch_run_repository.create_run(
            session,
            meeting_id=meeting_id,
            seq=attempt,
            phase=BatchPhase.INTEGRATION.value,
            status=status,
            from_transcript_id=None,
            to_transcript_id=None,
            reason=None if reason is None else reason[:2000],
        )


async def _commit_success(job: JobDTO, *, meeting_id: int, attempt: int, plan: MergePlanDTO) -> None:
    """**한 트랜잭션** — `merged` 안건·줄 INSERT + `ai_headline` + `ended`/`succeeded` + 통합 성공 행 + job `succeeded`(M-19 ① · SPEC-008 §4 원자성)."""
    async with session_scope() as session:
        for order_index, agenda in enumerate(plan.agendas):
            created = await meeting_child_repository.create_agenda(
                session,
                meeting_id=meeting_id,
                track=MeetingTrack.MERGED.value,
                title=agenda.title,
                order_index=order_index,
                state=agenda.state,
                source_agenda_id=agenda.source_agenda_id,
            )
            for line_index, line in enumerate(agenda.lines):
                await meeting_line_repository.create_line(
                    session,
                    meeting_id=meeting_id,
                    agenda_id=created.id,
                    track=MeetingTrack.MERGED.value,
                    kind=line.kind,
                    content=line.content,
                    order_index=line_index,
                    detail=line.detail,
                    evidence=line.evidence,
                    task_id=line.task_id,
                    pending_change=line.pending_change,
                    source_human_line_id=line.source_human_line_id,
                    source_ai_line_id=line.source_ai_line_id,
                )
        await meeting_batch_run_repository.create_run(
            session,
            meeting_id=meeting_id,
            seq=attempt,
            phase=BatchPhase.INTEGRATION.value,
            status=BatchRunStatus.SUCCEEDED.value,
            from_transcript_id=None,
            to_transcript_id=None,
        )
        # M-19 ① — 통합본과 한 줄 요약은 한 몸이다. 별도 호출이 없다
        await meeting_repository.finish_integration(
            session, meeting_id=meeting_id, succeeded=True, headline=plan.headline
        )
        await job_service.finish(session, job_id=job.id, status=JobStatus.SUCCEEDED.value)


async def _commit_failure(job: JobDTO, *, meeting_id: int, error_code: str, reason: str) -> None:
    """3회 실패 — `ended`/`failed` · `ai_headline` **NULL** · `merged` 행 0건 · job `failed(error_code)`. 사람 원본·AI 탭·트랜스크립트·녹음은 그대로다."""
    async with session_scope() as session:
        await meeting_repository.finish_integration(
            session, meeting_id=meeting_id, succeeded=False, headline=None
        )
        await job_service.finish(
            session,
            job_id=job.id,
            status=JobStatus.FAILED.value,
            error_code=error_code,
            error_message=reason,
        )


# --- 프롬프트 -----------------------------------------------------------------


def _tree_rows(agendas: list[MeetingAgendaDTO]) -> list[dict[str, object]]:
    return [
        {
            "id": agenda.id,
            "title": agenda.title,
            "orderIndex": agenda.order_index,
            "sourceAgendaId": agenda.source_agenda_id,
            "lines": [
                {
                    "id": line.id,
                    "kind": line.kind,
                    "content": line.content,
                    "detail": line.detail,
                    "evidence": line.evidence,
                    "orderIndex": line.order_index,
                }
                for line in agenda.lines
            ],
        }
        for agenda in agendas
    ]


def build_integration_prompt(
    human_agendas: list[MeetingAgendaDTO], ai_agendas: list[MeetingAgendaDTO]
) -> str:
    """② — 「짝짓기와 자리 배정, 그리고 한 문장 요약」만 시킨다(SPEC-008 §4). 본문은 요청하지 않는다 — 스키마에 자리가 없다."""
    payload = {
        "humanAgendas": _tree_rows(human_agendas),
        "aiAgendas": _tree_rows(ai_agendas),
    }
    return (
        "회의가 끝났다. 사람이 쓴 회의록 트리(humanAgendas)와 AI 요약 트리(aiAgendas)를 **통합**한다. 너는 문장을 쓰지 않는다 — "
        "**참조 id 와 자리만** 낸다. 규칙:\n"
        "1. 사람 줄은 **전부, 정확히 한 번** 계승한다(`sourceHumanLineId`). 같은 내용을 말하는 AI 줄이 있으면 그 줄의 id 를 "
        "`sourceAiLineId` 로 함께 적는다 — 서버가 사람 문장은 그대로 두고 AI 줄의 근거 타임스탬프만 가져온다. "
        "한 AI 줄은 한 통합 줄에만 붙인다.\n"
        "2. 사람 줄과 짝이 없는 AI 줄(AI 에만 있는 내용)은 `sourceHumanLineId=null`, `sourceAiLineId` 만으로 **추가**한다.\n"
        "3. 두 참조가 모두 없는 줄은 만들지 않는다.\n"
        "4. 안건은 사람 안건 전부를 `agendaRef.humanAgendaId` 로 **정확히 한 번씩** 내고, 사람 안건의 미러가 아닌 AI 안건"
        "(`sourceAgendaId` 가 null 인 것)만 필요하면 `agendaRef.aiAgendaId` 로 뒤에 추가한다. 미러 안건(`sourceAgendaId` 있음)의 "
        "줄은 그 사람 안건 안에 넣는다. 사람 줄은 **자기 사람 안건 안**에 두고 상대 순서를 바꾸지 않는다.\n"
        "5. `headline` — 이 회의를 한 문장(1~200자, 줄바꿈 없음)으로 요약한다. 이것만 네 문장이다.\n"
        "출력은 지정된 JSON 스키마 그대로다.\n\n"
        f"입력:\n{json.dumps(payload, ensure_ascii=False, indent=2)}"
    )
