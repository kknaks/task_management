"""2층 — 회의 스트림 세션(WP Phase 3 · SPEC-007 §4 「WS 메시지 계약」 · BE §5-1).

**제품에서 가장 어려운 자리.** 브라우저 WS ↔ 백엔드 ↔ Soniox 가 한 세션으로 묶이고, 녹음이 같은 경로에서 남으며,
끊김이 **가려지지 않고** 드러난다. 한 곳으로 못박는 것 —

1. **회의당 세션 레지스트리 `{meeting_id → StreamSession}` 하나.** 두 번째 연결은 `4409 meeting_stream_active`.
2. **업스트림은 클라이언트 인증 뒤에 연다**(과금·300분 한도). `ready{recordingStartedAt, latestBatchSeq, speakerCount}`.
3. 오디오 청크는 **① `storage.append` → ② Soniox 전달** 순. ①이 `OSError` 면 그 자리에서 `error{write_failed}` + close —
   원본이 남지 않는 녹음을 계속하지 않는다. 이후 청크는 Soniox 로 가지 않는다.
4. 잠정 토큰은 `transcript.partial` 로 **교체 렌더**만(저장 없음 — M-9). 확정 토큰은 **블록 경계**(화자 변경 · 300자 ·
   2초 공백)에서 닫고 **INSERT 와 `transcript.final` push 가 같은 시점**이다. 닫힐 때 배치 트리거를 평가한다.
5. `pause{user|mic}`/`resume` 은 **업스트림을 닫지 않는다**(한 세션 안에서 멈췄다 잇는다 — DEC-003 §1). 일시정지 중 오디오는
   버린다(에러 아님). `resume` 에 `ready` 를 다시 보낸다.
6. **백프레셔** — 송신 큐가 상한(`MEETING_STREAM_QUEUE_MAX`)을 넘으면 **잠정 프레임만** 버린다. 확정·AI 증분·오류는 안 버린다.
7. **종료 처리는 `finally`** — 클라이언트 끊김·업스트림 끊김·적재 실패 어느 쪽이든 업스트림을 반드시 닫고 레지스트리에서 뺀다.
8. **재연결 코드가 없다.** 재접속 루프 0건 · 광범위한 예외 포착 0건(정적 검사). 설계한 실패는
   `SttUpstreamError`(→ `upstream`) 와 `OSError`(→ `write_failed`) 둘뿐이고 그 밖은 전파한다.

service 는 `schemas/` 를 모른다 — 프레임은 `dto/meeting_stream.py` 로 주고받고, JSON 변환은 api 층의 `StreamClient` 가 한다.
`at_ms` 는 `recording_started_at` 기준 오프셋(M-11) = 업스트림 연결 시점의 벽시계 오프셋 + Soniox 토큰 ms + 일시정지 누적.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from core.db import SessionLocal
from dto.enums import BatchTriggerCause, MeetingStatus, StreamDisconnectReason
from dto.meeting import MeetingAgendaDTO, MeetingLineDTO
from dto.meeting_stream import (
    AiBatchFrame,
    AudioDeclaration,
    AudioFrame,
    ClientGone,
    InboundFrame,
    OutboundFrame,
    PartialSegment,
    PauseFrame,
    ReadyFrame,
    ResumeFrame,
    StreamErrorFrame,
    TranscriptFinalFrame,
    TranscriptPartialFrame,
)
from integrations import soniox as soniox_integration
from integrations import storage as storage_integration
from integrations.soniox import SttSession, SttToken, SttUpstreamError
from repository import (
    meeting_child_repository,
    meeting_repository,
    meeting_transcript_repository,
)
from service import meeting_batch_service, meeting_transcript_blocks

# --- close code (SPEC-007 §4) ----------------------------------------------------
CLOSE_NOT_FOUND = 4404
CLOSE_CONFLICT = 4409
# 오류 프레임 뒤 서버가 닫는 코드. 화면은 「그 밖」으로 보고 paused/stream 이 된다
CLOSE_AFTER_ERROR = 1011
REASON_INVALID_STATUS = "invalid_meeting_status"
REASON_STREAM_ACTIVE = "meeting_stream_active"
REASON_NOT_FOUND = "not_found"
REASON_DISCONNECTED = "meeting_stream_disconnected"
# `/end` 가 살아 있는 스트림을 닫는 코드(SPEC-007 §4 · SPEC-008 §4 `/end` 「WS 닫기(1000)」)
CLOSE_ENDED = 1000
REASON_ENDED = "meeting_ended"

# 발화 블록 경계는 **`meeting_transcript_blocks` 한 곳**에 있다(WORK-012) — 재전사와 같은 것을 쓴다.
# 여기서 다시 적지 않는다: 두 벌이면 재전사 뒤 근거 칩 구간이 어긋난다(M-9-a)
_DEFAULT_SPEAKER = meeting_transcript_blocks.DEFAULT_SPEAKER


class StreamClientClosed(Exception):
    """클라이언트 쪽이 이미 닫혔다 — 보낼 곳이 없다. 세션 종료 신호일 뿐 실패가 아니다."""


class StreamClient(Protocol):
    """api 층이 구현한다(WebSocket 래퍼). 테스트는 대역을 준다."""

    async def receive(self) -> InboundFrame: ...

    async def send(self, frame: OutboundFrame) -> None: ...

    async def close(self, code: int, reason: str) -> None: ...


@asynccontextmanager
async def _default_session_scope() -> AsyncIterator[AsyncSession]:
    """WS 는 요청 경계가 없다 — 단계(조회 · 블록 INSERT · 경로 기록)마다 세션을 열고 끝에 커밋한다(BE §7)."""
    async with SessionLocal() as session:
        yield session
        await session.commit()


session_scope: Callable[[], AsyncIterator[AsyncSession]] = _default_session_scope  # type: ignore[assignment]

_sessions: dict[int, StreamSession] = {}


def is_active(meeting_id: int) -> bool:
    return meeting_id in _sessions


# --- 진입점 -------------------------------------------------------------------


async def serve(
    client: StreamClient, *, account_id: int, meeting_id: int, audio: AudioDeclaration
) -> None:
    """인증(4401)은 라우터가 끝냈다. 여기서 회의 소유(4404) · 상태(4409) · 단일 세션(4409) 을 판정하고 세션을 돈다."""
    async with session_scope() as session:
        meeting = await meeting_repository.find_active(
            session, account_id=account_id, meeting_id=meeting_id
        )
    if meeting is None:
        await client.close(CLOSE_NOT_FOUND, REASON_NOT_FOUND)
        return
    if meeting.status != MeetingStatus.RECORDING.value:
        await client.close(CLOSE_CONFLICT, REASON_INVALID_STATUS)
        return
    if meeting_id in _sessions:
        # 첫 세션은 영향이 없다 — 두 번째만 닫는다
        await client.close(CLOSE_CONFLICT, REASON_STREAM_ACTIVE)
        return
    assert meeting.recording_started_at is not None  # `recording` 이면 `/start` 가 채웠다(M-1-a)

    stream = StreamSession(
        client=client,
        meeting_id=meeting_id,
        recording_started_at=meeting.recording_started_at,
        audio=audio,
    )
    _sessions[meeting_id] = stream
    try:
        await stream.run()
    finally:
        # 어느 경로로 끝나든 — 레지스트리에서 빼고 업스트림을 닫는다. 재연결은 없다: 끊김은 세션 삭제로 끝난다
        if _sessions.get(meeting_id) is stream:
            del _sessions[meeting_id]
        await stream.shutdown()


async def close_for_end(meeting_id: int) -> bool:
    """`/end` — 살아 있는 스트림이 있으면 `1000 meeting_ended` 로 닫는다(SPEC-008 §4 `/end` 순서 ①). **없으면 그냥 True 가 아니라 False** —
    `paused/stream`(WS 없음)에서도 종료는 진행된다(BE §8-2 L243). 종료는 상태 전이 + job 이지 스트림 조작이 아니다.

    닫힘 뒤 `serve()` 의 `finally` 가 업스트림(Soniox)을 닫고 레지스트리에서 뺀다 — 종료 프레임은 그 자리다.
    """
    stream = _sessions.get(meeting_id)
    if stream is None:
        return False
    await stream.end()
    return True


async def push_ai_batch(
    meeting_id: int, *, seq: int, agendas: list[MeetingAgendaDTO]
) -> bool:
    """배치 커밋 직후 **AI 트랙 전체** push(M-6-a · BE-11 · MF-53).

    `agendas` 는 줄이 중첩된 트리다 — 증분이 아니라 전량이라 화면이 통째로 갈아끼운다.
    세션이 없으면(끊김) 건너뛴다 — 다음 `ready.latestBatchSeq` 로 따라잡는다.
    """
    stream = _sessions.get(meeting_id)
    if stream is None:
        return False
    stream.enqueue(AiBatchFrame(seq=seq, agendas=agendas))
    return True


# --- 세션 -------------------------------------------------------------------


def _now_ms_since(started_at: datetime) -> int:
    return int((datetime.now(UTC) - started_at).total_seconds() * 1000)


class StreamSession:
    def __init__(
        self,
        *,
        client: StreamClient,
        meeting_id: int,
        recording_started_at: datetime,
        audio: AudioDeclaration,
    ) -> None:
        self.client = client
        self.meeting_id = meeting_id
        self.recording_started_at = recording_started_at
        self.audio = audio
        self.extension = storage_integration.extension_for(audio.format)
        self.upstream: SttSession | None = None
        self.paused = False
        self._pause_started: float | None = None
        # 업스트림 연결 시점의 벽시계 오프셋 — Soniox ms 는 이 값에 더한다. 일시정지만큼 뒤로 민다
        self._base_ms = 0
        self._outbox: asyncio.Queue[OutboundFrame] = asyncio.Queue()
        self._queue_max = get_settings().meeting_stream_queue_max
        self._blocks = meeting_transcript_blocks.BlockBuilder()
        self._speakers: set[str] = set()
        self._recording_path_saved = False
        self._failed: str | None = None
        # `/end` 가 세운다 — 펌프 셋과 함께 기다려 세션을 끝낸다(`finally` 가 업스트림을 닫는다)
        self._ended = asyncio.Event()

    # --- 실행 -------------------------------------------------------------------

    async def run(self) -> None:
        try:
            self.upstream = await soniox_integration.get_connector().connect(self.audio)
        except SttUpstreamError:
            await self._fail(StreamDisconnectReason.UPSTREAM.value)
            return
        self._base_ms = _now_ms_since(self.recording_started_at)
        await self._send_ready()

        pumps = [
            asyncio.create_task(self._pump_client(), name="stream-client"),
            asyncio.create_task(self._pump_upstream(), name="stream-upstream"),
            asyncio.create_task(self._pump_outbox(), name="stream-outbox"),
            asyncio.create_task(self._ended.wait(), name="stream-ended"),
        ]
        done, pending = await asyncio.wait(pumps, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        for task in pending:
            try:
                await task
            except asyncio.CancelledError:
                pass
        for task in done:
            # 설계 밖 예외는 여기서 그대로 올라간다
            task.result()

    async def end(self) -> None:
        """`/end` — 클라이언트를 `1000 meeting_ended` 로 닫고 세션을 끝낸다. 실패 프레임이 아니다(정상 종료)."""
        try:
            await self.client.close(CLOSE_ENDED, REASON_ENDED)
        except StreamClientClosed:
            pass
        self._ended.set()

    async def shutdown(self) -> None:
        """`finally` 에서 부른다 — 열린 블록을 적재하고 **업스트림을 반드시 닫는다**."""
        try:
            await self._close_block(push=False)
        finally:
            if self.upstream is not None:
                await self.upstream.close()
                self.upstream = None

    # --- 클라이언트 → 서버 -------------------------------------------------------------

    async def _pump_client(self) -> None:
        while True:
            frame = await self.client.receive()
            if isinstance(frame, ClientGone):
                return
            if isinstance(frame, AudioFrame):
                if not await self._feed(frame.chunk):
                    return
            elif isinstance(frame, PauseFrame):
                self._pause()
            elif isinstance(frame, ResumeFrame):
                await self._resume()

    async def _feed(self, chunk: bytes) -> bool:
        """① 녹음 append → ② Soniox 전달. 거짓을 돌려주면 세션이 끝난다(이미 오류 프레임을 보냈다)."""
        if self.upstream is None or self.paused:
            # `ready` 전·일시정지 중 프레임은 버린다(에러 아님 — SPEC-007 §4 Validation)
            return True
        try:
            path = await storage_integration.get_store().append(
                self.meeting_id, chunk, extension=self.extension
            )
        except OSError:
            await self._fail(StreamDisconnectReason.WRITE_FAILED.value)
            return False
        if not self._recording_path_saved:
            async with session_scope() as session:
                await meeting_repository.set_recording_path(
                    session, meeting_id=self.meeting_id, recording_path=path
                )
            self._recording_path_saved = True
        try:
            await self.upstream.send_audio(chunk)
        except SttUpstreamError:
            await self._fail(StreamDisconnectReason.UPSTREAM.value)
            return False
        return True

    def _pause(self) -> None:
        if self.paused:
            return
        self.paused = True
        self._pause_started = time.monotonic()
        # 잠정 발화를 비운다 — 교체 렌더라 빈 목록이 곧 지움이다
        self.enqueue(TranscriptPartialFrame(segments=[]))

    async def _resume(self) -> None:
        if self.paused and self._pause_started is not None:
            self._base_ms += int((time.monotonic() - self._pause_started) * 1000)
        self.paused = False
        self._pause_started = None
        await self._send_ready()

    # --- 업스트림 → 서버 --------------------------------------------------------------

    async def _pump_upstream(self) -> None:
        assert self.upstream is not None
        try:
            async for tokens in self.upstream.tokens():
                await self._handle_tokens(tokens)
        except SttUpstreamError:
            await self._fail(StreamDisconnectReason.UPSTREAM.value)
            return
        # 우리가 종료 프레임을 보내기 전에 업스트림이 끝났다 — 끊긴 것과 같다
        await self._fail(StreamDisconnectReason.UPSTREAM.value)

    async def _handle_tokens(self, tokens: list[SttToken]) -> None:
        partials: list[SttToken] = []
        for token in tokens:
            if token.is_final:
                await self._absorb_final(token)
            else:
                partials.append(token)
        if self.paused:
            return
        self.enqueue(TranscriptPartialFrame(segments=self._segments(partials)))

    def _segments(self, tokens: list[SttToken]) -> list[PartialSegment]:
        segments: list[PartialSegment] = []
        for token in tokens:
            speaker = token.speaker or (segments[-1].speaker_label if segments else _DEFAULT_SPEAKER)
            if segments and segments[-1].speaker_label == speaker:
                last = segments[-1]
                segments[-1] = PartialSegment(
                    speaker_label=last.speaker_label, at_ms=last.at_ms, text=last.text + token.text
                )
            else:
                segments.append(
                    PartialSegment(
                        speaker_label=speaker, at_ms=self._base_ms + token.start_ms, text=token.text
                    )
                )
        return segments

    async def _absorb_final(self, token: SttToken) -> None:
        """경계 판정은 `meeting_transcript_blocks.BlockBuilder` 가 한다 — 재전사와 **같은 것**이다."""
        self._blocks.base_ms = self._base_ms
        for block in self._blocks.add(token):
            await self._persist_block(block)

    async def _close_block(self, *, push: bool = True) -> None:
        """열린 블록을 닫는다 — 스트림 종료·일시정지 자리에서 부른다."""
        for block in self._blocks.flush():
            await self._persist_block(block, push=push)

    async def _persist_block(
        self, block: meeting_transcript_blocks.TranscriptBlock, *, push: bool = True
    ) -> None:
        """**INSERT 와 `transcript.final` push 가 같은 시점.** 닫힌 뒤 배치 트리거를 평가한다."""
        async with session_scope() as session:
            item = await meeting_transcript_repository.create_block(
                session,
                meeting_id=self.meeting_id,
                speaker_label=block.speaker_label,
                at_ms=block.at_ms,
                end_ms=block.end_ms,
                content=block.content,
            )
        self._speakers.add(block.speaker_label)
        if push:
            self.enqueue(TranscriptFinalFrame(item=item))
        meeting_batch_service.schedule(self.meeting_id, BatchTriggerCause.TRANSCRIPT.value)

    # --- 서버 → 클라이언트 -------------------------------------------------------------

    def enqueue(self, frame: OutboundFrame) -> None:
        """백프레셔 — 큐가 상한을 넘으면 **잠정만** 버린다. 나머지는 밀려도 넣는다."""
        if isinstance(frame, TranscriptPartialFrame) and self._outbox.qsize() >= self._queue_max:
            return
        self._outbox.put_nowait(frame)

    async def _pump_outbox(self) -> None:
        while True:
            frame = await self._outbox.get()
            try:
                await self.client.send(frame)
            except StreamClientClosed:
                return

    async def _send_ready(self) -> None:
        async with session_scope() as session:
            latest_batch_seq = await meeting_child_repository.max_succeeded_batch_seq(
                session, self.meeting_id
            )
            speaker_count = await meeting_transcript_repository.count_speakers(
                session, self.meeting_id
            )
        # DB 에 닫힌 블록 + 이 세션에서 본 화자(아직 열린 블록 포함) — 확정 발화의 화자 수다
        seen = set(self._speakers)
        if self._blocks.open_speaker is not None:
            seen.add(self._blocks.open_speaker)
        self.enqueue(
            ReadyFrame(
                recording_started_at=self.recording_started_at,
                latest_batch_seq=latest_batch_seq,
                speaker_count=max(speaker_count, len(seen)),
            )
        )

    async def _fail(self, reason: str) -> None:
        """설계한 실패 둘(`upstream` · `write_failed`) — 오류 프레임을 **직접** 보내고 닫는다. 재연결하지 않는다."""
        if self._failed is not None:
            return
        self._failed = reason
        try:
            await self.client.send(StreamErrorFrame(reason=reason))
            await self.client.close(CLOSE_AFTER_ERROR, REASON_DISCONNECTED)
        except StreamClientClosed:
            pass
