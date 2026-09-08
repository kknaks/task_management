"""2층 — **종료 파이프라인**(SPEC-008 §4 「종료 파이프라인 — 검증 가능한 정의」 · DEC-003 §4 · §7 · BE §6 · §7 · §8-3).

```
/end ─┐
      ├→ job ─→ ① async 재전사(Soniox stt-async-v5 · 1200초 · 폴링 5초)
/finalize ┘          │  실패 → ended/failed · transcription_failed|timeout · **② 로 가지 않는다**
                     ↓
                  ② 최종 회의록 호출 한 번(300초 × 3회 · 즉시 재시도)
                     ├ 성공: merged + ai_headline + term_corrections + auto 치환 + ended/succeeded + batch_run(final) + job — **한 트랜잭션**
                     └ 3회 실패: ended/failed · final_failed|final_timeout. 재전사 결과는 남는다
```

한 곳으로 못박는 것 —

1. **`run_pipeline` 에 스위치가 없다**(MF-58). `/end` 도 `/finalize` 도 **①부터** 돈다 — 「② 만 다시」가 없다.
2. **① 에 fallback 이 없다**(MF-58). 재전사가 실패하면 실시간 블록 그대로 `ended`+`failed` 다.
   이 파일에 「① 실패 → ② 호출」로 가는 분기가 **없다**(정적 검사).
3. **검증 함수는 `meeting_batch_service` 것 하나**(MF-52) — `_parse_output(fill_final=True)` · `_demote_if_needed` · `_persist(track='merged')`.
   여기서 두 번째 파서·두 번째 persist 를 만들지 않는다. 최종만 더하는 검증 다섯이 아래 `_validate_final` 이다.
4. **`ai_headline` · `term_corrections` 를 쓰는 코드는 이 파일 하나**(`meeting_repository.finish_integration` 호출 · M-19).
5. **설계한 실패만 잡는다** — `SttUpstreamError`·`TimeoutError`(①) · `AgentRunFailed`·`AgentRunTimeout`·`FinalAttemptFailed`(②).
   그 밖은 전파한다 — job 태스크의 완료 콜백이 스택째 로그로 드러낸다(BE §8-1).
6. 단계마다 `session_scope()` — **외부 호출(Soniox 폴링 · codex 대기) 중에는 트랜잭션을 열지 않는다**(BE §7).
   이 파일은 `commit()` 을 부르지 않는다.
7. **토큰 폐기는 ② 가 종결될 때**(성공·실패 무관) best-effort 다(MF-4) — 실패해도 job 결과를 뒤집지 않는다.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from core.db import SessionLocal, register_after_commit
from dto.enums import (
    PAYLOAD_STATUSES,
    BatchPhase,
    BatchRunStatus,
    JobErrorCode,
    JobKind,
    JobStatus,
    JobTargetType,
    LineKind,
    MeetingStatus,
    MeetingTrack,
)
from dto.job import JobDTO
from dto.meeting import TranscriptItemDTO
from integrations import agent as agent_integration
from integrations import soniox
from integrations.agent import AgentRunFailed, AgentRunTimeout
from integrations.soniox import SttUpstreamError, TranscribeContext
from repository import (
    meeting_batch_run_repository,
    meeting_child_repository,
    meeting_repository,
    meeting_transcript_repository,
    project_repository,
    task_repository,
    work_type_repository,
)
from service import (
    auth_service,
    job_service,
    meeting_batch_service,
    meeting_service,
    meeting_stream_service,
    meeting_transcript_blocks,
)

logger = logging.getLogger(__name__)

# `payload.status` 허용값의 정본은 `dto.enums.PAYLOAD_STATUSES` 다 — 사람이 쓰는 표면(스키마 층 422)과 **같은 집합**이다.
# AI 가 `done`·`cancelled` 를 실어 오면 시도를 죽이지 않고 **그 키만 뗀다**(MF-59)
# 용어 보정 등급 — `auto` 만 스크립트 본문에 적용한다(M-9-b)
_GRADE_AUTO = "auto"
_GRADES = frozenset({_GRADE_AUTO, "guess"})
_HEADLINE_MAX = 200


# --- 세션 경계 --------------------------------------------------------------


@asynccontextmanager
async def _default_session_scope() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
        await session.commit()


session_scope: Callable[[], AsyncIterator[AsyncSession]] = _default_session_scope  # type: ignore[assignment]


class FinalAttemptFailed(Exception):
    """② 한 시도의 검증 실패 — **그 시도만** 실패다(재시도 2회). 이 모듈 안에서만 쓴다."""


# --- 요청 표면: /end · /finalize (요청 트랜잭션 안 · 태스크는 커밋 뒤) -----------------------


async def end(session: AsyncSession, *, account_id: int, meeting_id: int) -> int:
    """`POST …/end` → job id. 순서(SPEC-008 §4) — WS 닫기 요청 → `active→done` → `generating`/`running` → job INSERT → (커밋 뒤) 태스크.

    사전 조건은 허용 표의 `end` 행(`recording`) **하나**다. 스트림 레지스트리를 조건으로 보지 않는다.
    """
    meeting = await meeting_service.require_meeting(session, account_id=account_id, meeting_id=meeting_id)
    meeting_service.assert_allowed(meeting, "end")

    closed = await meeting_stream_service.close_for_end(meeting_id)
    logger.info("회의 %s 종료 — 스트림 %s", meeting_id, "닫기 요청" if closed else "없음(paused/stream 또는 미연결)")

    await meeting_child_repository.mark_active_agendas_done(session, meeting_id=meeting_id)
    return await _start_job(session, account_id=account_id, meeting_id=meeting_id)


async def finalize(session: AsyncSession, *, account_id: int, meeting_id: int) -> int:
    """`POST …/finalize`(「다시 시도」) → job id. `ended`+`failed` 에서만(허용 표 `finalize` 행 + `integration_state`).

    **①부터 다시 돈다**(MF-58) — 「② 만」이 없다. 그 시점의 사람 트랙(실패 상태에서 편집 반영분)을 AI 가 도구로 본다.
    """
    meeting = await meeting_service.require_meeting(session, account_id=account_id, meeting_id=meeting_id)
    meeting_service.assert_allowed(meeting, "finalize")
    # 회의별 단명 토큰을 **다시 발급**한다(2026-09-08 코디 확정 · A-13 · MF-4).
    # ② 종결이 행을 지웠는데 재시도 ② 도 MCP 도구를 불러야 하고, 토큰 TTL 이 분 단위라
    # 「실패 때는 안 지운다」로는 늦은 재시도가 어차피 죽는다.
    # **먼저 지우고 낸다** — 폐기가 best-effort 라 실패해 남아 있을 수 있고, 그러면 두 행이 된다.
    # 발급은 `/start` 와 **같은 함수**다(두 번째 발급 코드를 만들지 않는다).
    await auth_service.revoke_meeting_token(session, meeting_id=meeting_id)
    await auth_service.issue_meeting_token(session, account_id=account_id, meeting_id=meeting_id)
    return await _start_job(session, account_id=account_id, meeting_id=meeting_id)


async def _start_job(session: AsyncSession, *, account_id: int, meeting_id: int) -> int:
    """`generating` 전이 + job INSERT + 커밋 뒤 태스크. **두 표면이 같은 것을 부른다** — 계획이 하나뿐이라서다."""
    await meeting_repository.begin_generating(session, meeting_id=meeting_id)
    job = await job_service.create(
        session,
        account_id=account_id,
        kind=JobKind.MEETING_FINALIZE.value,
        target_type=JobTargetType.MEETING.value,
        target_id=meeting_id,
    )
    register_after_commit(session, _launcher(job.id))
    return job.id


def _launcher(job_id: int):
    async def _launch() -> None:
        job_service.launch(job_id)

    return _launch


# --- job handler ----------------------------------------------------------------


class MeetingFinalizeHandler:
    """`job_service` 가 부르는 실행 계약 — `run` 이 파이프라인, `on_timeout` 이 상한 초과 시 회의 마감."""

    async def run(self, job: JobDTO) -> None:
        await run_pipeline(job)

    async def on_timeout(self, job: JobDTO) -> None:
        """job 상한 초과 · 기동 스윕 — 회의를 `ended`+`failed` 로. `ai_headline` 은 NULL 그대로(M-19 ②). 이미 `ended` 면 건드리지 않는다."""
        async with session_scope() as session:
            context = await meeting_repository.find_ai_context(session, meeting_id=job.target_id)
            if context is None or context.status != MeetingStatus.GENERATING.value:
                return
            await meeting_repository.finish_integration(
                session, meeting_id=job.target_id, succeeded=False, headline=None
            )
        await _revoke_token(job.target_id)


job_service.register_handler(JobKind.MEETING_FINALIZE.value, MeetingFinalizeHandler())


# --- 파이프라인 — ① → ② (스위치 없음 · MF-58) --------------------------------------


async def run_pipeline(job: JobDTO) -> None:
    """**① → ②.** ① 이 실패하면 **여기서 끝난다** — 아래 ② 코드에 닿지 않는다.

    각 단계가 자기 세션·자기 커밋이다(BE §7).
    """
    settings = get_settings()
    meeting_id = job.target_id

    try:
        await _transcribe(meeting_id)
    except TimeoutError as exc:
        await _commit_failure(
            job, meeting_id=meeting_id, error_code=JobErrorCode.TRANSCRIPTION_TIMEOUT.value, reason=str(exc)
        )
        return
    except SttUpstreamError as exc:
        await _commit_failure(
            job, meeting_id=meeting_id, error_code=JobErrorCode.TRANSCRIPTION_FAILED.value, reason=str(exc)
        )
        return

    last_reason = ""
    timeouts = 0
    attempts = settings.meeting_final_attempts
    for attempt in range(1, attempts + 1):
        await job_service.set_attempt(job.id, attempt)
        try:
            plan = await _attempt_final(meeting_id, timeout_sec=settings.meeting_final_timeout_sec)
        except AgentRunTimeout as exc:
            timeouts += 1
            last_reason = str(exc)
            await _record_attempt(meeting_id, attempt=attempt, reason=last_reason)
            logger.warning("회의 %s 최종 회의록 시도 %s/%s 상한 초과: %s", meeting_id, attempt, attempts, last_reason)
            continue
        except (AgentRunFailed, FinalAttemptFailed) as exc:
            last_reason = str(exc)
            await _record_attempt(meeting_id, attempt=attempt, reason=last_reason)
            logger.warning("회의 %s 최종 회의록 시도 %s/%s 실패: %s", meeting_id, attempt, attempts, last_reason)
            continue

        await _commit_success(job, meeting_id=meeting_id, attempt=attempt, plan=plan)
        return

    error_code = (
        JobErrorCode.FINAL_TIMEOUT.value if timeouts == attempts else JobErrorCode.FINAL_FAILED.value
    )
    await _commit_failure(job, meeting_id=meeting_id, error_code=error_code, reason=last_reason)


# --- ① async 재전사 (MF-37 · SPEC-008 §4 ①) ---------------------------------------


async def _transcribe(meeting_id: int) -> None:
    """읽기 → 커밋 → **Soniox(트랜잭션 없음)** → 새 세션에서 `meeting_transcript` DELETE + INSERT.

    `at_ms` 기준이 실시간과 같다 — 파일 시작이 곧 `recording_started_at` 이라 `base_ms=0` 이다(M-9-a).
    블록 경계는 `meeting_transcript_blocks` **한 함수**를 지난다(실시간과 같은 규칙).
    """
    settings = get_settings()

    async with session_scope() as session:
        context = await meeting_repository.find_ai_context(session, meeting_id=meeting_id)
        if context is None:
            raise RuntimeError(f"회의 {meeting_id} 가 없습니다")
        if not context.recording_path:
            # 녹음이 없으면 다시 전사할 것이 없다 — 설계한 실패다(fallback 을 두지 않는다)
            raise SttUpstreamError(f"회의 {meeting_id} 에 녹음 원본이 없습니다")
        speaker_count = await meeting_transcript_repository.count_speakers(session, meeting_id)
        previous = await meeting_repository.find_previous_headline(
            session,
            account_id=context.account_id,
            project_id=context.project_id,
            before=context.start_at,
        )
    recording_path = context.recording_path

    transcribe_context = _build_context(
        title=context.title, project_name=context.project_name,
        speaker_count=speaker_count, previous_headline=previous,
    )
    logger.info(
        "회의 %s 재전사 — stt-async-v5 · general=%s · text=%s · terms=비움",
        meeting_id,
        transcribe_context.general,
        "있음" if transcribe_context.text else "없음",
    )

    tokens = await soniox.get_async_connector().transcribe(
        Path(recording_path),
        transcribe_context,
        poll_sec=settings.meeting_transcribe_poll_sec,
        timeout_sec=settings.meeting_transcribe_timeout_sec,
    )
    blocks = meeting_transcript_blocks.build_blocks(tokens)

    async with session_scope() as session:
        await meeting_transcript_repository.delete_by_meeting(session, meeting_id=meeting_id)
        await meeting_transcript_repository.bulk_create(
            session, meeting_id=meeting_id, blocks=blocks
        )
    logger.info("회의 %s 재전사 완료 — 블록 %s개", meeting_id, len(blocks))


def _build_context(
    *, title: str, project_name: str | None, speaker_count: int, previous_headline: str | None
) -> TranscribeContext:
    """SPEC-008 §4 「② 의 `context`」 — `general` 셋 · `text` 는 있을 때만 · **`terms` 는 비운다**(DEC-003 OQ-10).

    참석자 이름은 없다(DEC-003 §2 익명).
    """
    return TranscribeContext(
        general=[
            {"key": "회의 제목", "value": title},
            {"key": "프로젝트", "value": project_name or "무소속"},
            {"key": "화자 수", "value": str(speaker_count)},
        ],
        text=previous_headline,
    )


# --- ② 최종 회의록 (MF-52 · 56 · 57 · 59) ------------------------------------------


@dataclass(frozen=True)
class _FinalPlan:
    """검증을 통과한 한 시도의 결과. **적재는 `_commit_success` 가 한 트랜잭션으로** 한다."""

    headline: str
    term_corrections: list[dict[str, str]]
    agendas: list


async def _attempt_final(meeting_id: int, *, timeout_sec: int) -> _FinalPlan:
    """읽기 → 커밋 → codex(트랜잭션 없음) → 검증. **적재하지 않는다.**

    `ai_session_id` 가 `NULL` 이면 **그 시도 실패**다(MF-70 — 재웜스타트 갈래를 만들지 않는다).
    """
    async with session_scope() as session:
        context = await meeting_repository.find_ai_context(session, meeting_id=meeting_id)
        if context is None:
            raise RuntimeError(f"회의 {meeting_id} 가 없습니다")
        meeting_token = await auth_service.get_meeting_token(session, meeting_id=meeting_id)
        script = await meeting_transcript_repository.list_blocks(session, meeting_id)
        human_agenda_ids = {
            agenda.id
            for agenda in await meeting_child_repository.list_agendas_by_track(
                session, meeting_id, track=MeetingTrack.HUMAN.value
            )
        }

    if context.ai_session_id is None:
        raise FinalAttemptFailed(f"회의 {meeting_id} 에 AI 세션이 없습니다")
    if meeting_token is None:
        raise FinalAttemptFailed(f"회의 {meeting_id} 에 회의 토큰이 없습니다")

    result = await agent_integration.get_gateway().run(
        prompt=build_final_notes_prompt(script),
        session_id=context.ai_session_id,
        output_schema=meeting_batch_service.OUTPUT_SCHEMA,
        timeout_sec=timeout_sec,
        # ② 최종 회의록은 일곱을 다 연다 — 사람 안건·사람 줄을 읽고 한 벌로 합친다(MF-71 은 중간만 좁힌다)
        phase="final",
        meeting_token=meeting_token,
    )

    try:
        notes = meeting_batch_service.parse_output(
            result.output,
            human_agenda_ids=human_agenda_ids,
            last_end_ms=max((block.end_ms for block in script), default=0),
            fill_final=True,
        )
    except meeting_batch_service.SchemaViolation as exc:
        raise FinalAttemptFailed(str(exc)) from exc

    _validate_final(notes, human_agenda_ids=human_agenda_ids)
    await _apply_reference_checks(meeting_id, context=context, notes=notes)
    return _FinalPlan(
        headline=notes.headline,  # type: ignore[arg-type]
        term_corrections=notes.term_corrections,
        agendas=notes.agendas,
    )


def _validate_final(notes, *, human_agenda_ids: set[int]) -> None:
    """최종만 더하는 검증 — 스키마·evidence·안건 소속은 WORK-011 함수가 이미 봤다(SPEC-008 §4 「서버 검증」).

    ① **모든 사람 안건이 정확히 한 번** 나온다(AI 가 빠뜨리거나 합치지 않는다 — MF-62 의 AI 쪽)
    ② `headline` 1~200자 **한 문장**(줄바꿈 없음) 필수
    ③ `termCorrections` 는 배열이고 `grade ∈ {auto, guess}`
    어기면 **그 시도 실패**다(재시도 2회).
    """
    referenced = [agenda.human_agenda_id for agenda in notes.agendas if agenda.human_agenda_id is not None]
    if sorted(referenced) != sorted(human_agenda_ids):
        raise FinalAttemptFailed(
            f"사람 안건을 정확히 한 번씩 덮지 않았다: 기대 {sorted(human_agenda_ids)} · 실제 {sorted(referenced)}"
        )

    headline = notes.headline
    if not isinstance(headline, str) or not headline.strip():
        raise FinalAttemptFailed("headline 이 비어 있다")
    if len(headline) > _HEADLINE_MAX or "\n" in headline:
        raise FinalAttemptFailed("headline 은 1~200자 한 문장이어야 한다")

    for row in notes.term_corrections:
        if set(row) != {"stt", "correct", "grade"} or row["grade"] not in _GRADES:
            raise FinalAttemptFailed(f"termCorrections 항목이 계약과 다르다: {row}")


async def _apply_reference_checks(meeting_id: int, *, context, notes) -> None:
    """업무 참조 사후 검사(WORK-011 함수) + **페이로드 참조**(SPEC-008 §4).

    업무 참조가 틀리면 **그 줄만 `action` 강등**, 페이로드 참조가 틀리면 **그 키만 `null`/제거** —
    둘 다 시도 실패가 아니다. 사람이 드로어에서 고른다.
    """
    async with session_scope() as session:
        allowed_task_ids = {
            task.id
            for task in await task_repository.list_meeting_context(
                session, account_id=context.account_id, project_id=context.project_id
            )
        }
        work_type_ids = {
            work_type.id
            for work_type in await work_type_repository.list_active(session, context.account_id)
            if work_type.kind == "task"
        }
        project_ids = {
            project.id for project in await project_repository.list_active(session, context.account_id)
        }

    for agenda in notes.agendas:
        checked = []
        for line in agenda.lines:
            line = meeting_batch_service.demote_if_needed(
                line, allowed_task_ids, meeting_id=meeting_id
            )
            if line.kind not in (LineKind.ACTION.value, LineKind.TASK.value):
                # 강등으로 `action` 이 아닌 종류가 되는 일은 없지만, `payload` 자리 규칙은 여기서도 지킨다
                line.payload = None
            elif line.payload is not None:
                line.payload = _clean_payload(
                    line.payload,
                    work_type_ids=work_type_ids,
                    project_ids=project_ids,
                    task_ids=allowed_task_ids,
                )
            checked.append(line)
        agenda.lines = checked


def _clean_payload(
    payload: dict, *, work_type_ids: set[int], project_ids: set[int], task_ids: set[int]
) -> dict:
    """**참조가 틀리면 그 키만 손본다** — 줄도 시도도 산다(SPEC-008 §4 「페이로드 참조」).

    `workTypeId` · `projectId` 가 본인의 삭제 안 된 것이 아니면 `null`,
    `relatedTaskIds` 는 본인의 삭제 안 된 업무만 남기고,
    `status` 가 `done` · `cancelled` 면 **그 키를 뗀다**(MF-59 — 완료는 업무 화면에서 사람이 누른다).
    """
    cleaned = dict(payload)
    if cleaned.get("workTypeId") is not None and cleaned["workTypeId"] not in work_type_ids:
        cleaned["workTypeId"] = None
    if cleaned.get("projectId") is not None and cleaned["projectId"] not in project_ids:
        cleaned["projectId"] = None
    related = cleaned.get("relatedTaskIds")
    if isinstance(related, list):
        cleaned["relatedTaskIds"] = [task_id for task_id in related if task_id in task_ids]
    status = cleaned.get("status")
    if status is not None and status not in PAYLOAD_STATUSES:
        cleaned.pop("status")
    return cleaned


# --- 종결 ---------------------------------------------------------------------


async def _record_attempt(meeting_id: int, *, attempt: int, reason: str | None) -> None:
    """실패한 시도 기록 — `phase='final'` · `seq`=시도 번호. 성공 행은 `_commit_success` 가 같은 트랜잭션에서 넣는다."""
    async with session_scope() as session:
        await meeting_batch_run_repository.create_run(
            session,
            meeting_id=meeting_id,
            seq=attempt,
            phase=BatchPhase.FINAL.value,
            status=BatchRunStatus.FAILED.value,
            from_transcript_id=None,
            to_transcript_id=None,
            reason=None if reason is None else reason[:2000],
        )


async def _commit_success(job: JobDTO, *, meeting_id: int, attempt: int, plan: _FinalPlan) -> None:
    """**한 트랜잭션**(SPEC-008 §4 원자성 · M-19 ①) —

    `merged` 안건·줄 INSERT → `ai_headline`·`term_corrections` → **`grade='auto'` 치환** →
    `ended`/`succeeded` → `meeting_batch_run(phase='final', succeeded)` → job `succeeded`.
    **하나라도 실패하면 전부 없다.**
    """
    async with session_scope() as session:
        await meeting_batch_service.persist(
            session,
            meeting_id=meeting_id,
            agendas=plan.agendas,
            track=MeetingTrack.MERGED.value,
            mirror_human_agendas=True,
        )
        for row in plan.term_corrections:
            if row["grade"] != _GRADE_AUTO:
                continue  # `guess` 는 표에만 남는다 — 본문 불변(M-9-b)
            await meeting_transcript_repository.replace_content(
                session, meeting_id=meeting_id, stt=row["stt"], correct=row["correct"]
            )
        await meeting_batch_run_repository.create_run(
            session,
            meeting_id=meeting_id,
            seq=attempt,
            phase=BatchPhase.FINAL.value,
            status=BatchRunStatus.SUCCEEDED.value,
            from_transcript_id=None,
            to_transcript_id=None,
        )
        await meeting_repository.finish_integration(
            session,
            meeting_id=meeting_id,
            succeeded=True,
            headline=plan.headline,
            term_corrections=plan.term_corrections,
        )
        await job_service.finish(session, job_id=job.id, status=JobStatus.SUCCEEDED.value)
    await _revoke_token(meeting_id)


async def _commit_failure(job: JobDTO, *, meeting_id: int, error_code: str, reason: str) -> None:
    """실패 종결 — `ended`/`failed` · `ai_headline`·`term_corrections` **NULL** · `merged` 0건 · job `failed(error_code)`.

    사람 원본·AI 탭·트랜스크립트·녹음은 그대로다.
    """
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
    await _revoke_token(meeting_id)


async def _revoke_token(meeting_id: int) -> None:
    """회의별 단명 토큰 폐기(MF-4 · A-13) — **종결될 때 성공·실패 무관**. **best-effort** 다.

    실패해도 job 결과를 뒤집지 않는다 — 남은 토큰은 자연 만료가 거둔다. 로그만 남긴다.

    포착은 **`SQLAlchemyError` 하나**다(BE §8-1 — 넓은 포착을 쓰지 않는다. 구체 타입만).
    이 블록이 하는 일은 `DELETE … WHERE kind='meeting'` 한 줄이라 여기서 날 수 있는 것은 DB 오류뿐이고,
    그 밖의 예외(설계 밖)는 **전파해서** 태스크 콜백이 스택째 드러내는 편이 맞다.
    """
    try:
        async with session_scope() as session:
            await auth_service.revoke_meeting_token(session, meeting_id=meeting_id)
    except SQLAlchemyError:
        logger.warning("회의 %s 토큰 폐기 실패 — 자연 만료로 흡수한다", meeting_id, exc_info=True)


# --- 프롬프트 -----------------------------------------------------------------


_FINAL_INSTRUCTIONS = """회의가 끝났다. 아래는 녹음을 다시 받아쓴 **회의 전체 스크립트**다.

**처음부터 다시 읽고 최종 회의록 한 벌을 써라.**
회의 중에 네가 낸 AI 요약은 참고만 하고, 이 스크립트를 근거로 다시 정리한다.

정리하기 전에 이 순서로 조회해라.

  1. list_agendas   사람이 적은 안건과 네가 만든 안건을 본다
  2. get_agenda     각 안건에 달린 줄을 본다 — 사람이 이미 적은 것을 빠뜨리지 않으려고
  3. 업무를 가리킬 때만 — list_tasks 로 찾고, get_task 로 확인하고, list_work_types 로 유형을 고른다

이번에만 지키는 것 —

- **사람 안건은 전부, 정확히 한 번씩** humanAgendaId 로 낸다. 빠뜨리거나 둘을 합치지 마라.
  어디에도 맞지 않는 새 주제만 humanAgendaId 를 비우고 제목을 직접 지어 뒤에 붙인다.
- headline — 이 회의를 **한 문장**(1~200자 · 줄바꿈 없음)으로 요약한다. 필수다.
- termCorrections — 받아쓰기가 잘못 옮긴 말을 표로 낸다. 없으면 빈 배열이다.
    grade=auto  제품명 · 시스템명처럼 문맥이 확실한 것. 서버가 스크립트 본문을 바꾼다
    grade=guess 인명 · 숫자 · 금액 · 일정 · 한 번만 나온 말. 표에만 남기고 본문은 그대로 둔다
- payload — 액션 줄과 업무 줄에만 담는다. 액션은 새로 만들 업무의 초안(제목 · 유형 · 프로젝트 · 일정 · 설명 · 할일),
  업무는 이미 있는 업무의 변경안(기한 · 상태 · 메모 · 할일 · 연관 · 프로젝트 · 완료 결과)이다.
  **status 에 done · cancelled 를 쓰지 마라** — 완료는 사람이 업무 화면에서 누른다.
  참조하는 유형 · 프로젝트 · 업무는 도구로 확인한 실제 id 만 쓴다.

전체 스크립트:
"""


def build_final_notes_prompt(script: list[TranscriptItemDTO]) -> str:
    """② — **재전사 스크립트 전체 하나**를 싣는다(SPEC-008 §4 ②).

    안건 · 사람 줄 · AI 줄 · 업무 · 유형은 **AI 가 도구로 조회한다**(MF-50 · 51) — 여기 싣지 않는다.
    역할 · 용어 다섯 · 도구 목록은 웜스타트가 이미 심었다(WORK-010).
    """
    rows = [
        {
            "speakerLabel": block.speaker_label,
            "atMs": block.at_ms,
            "endMs": block.end_ms,
            "content": block.content,
        }
        for block in script
    ]
    return f"{_FINAL_INSTRUCTIONS}{meeting_batch_service.dumps(rows)}"
