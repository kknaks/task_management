"""SPEC-007 §4 「WS 메시지 계약」 — `WS /api/meetings/{id}/stream` 의 프레임 모델.

클라이언트 → 서버 텍스트 프레임 3종(`auth` · `pause` · `resume`) · 서버 → 클라이언트 5종
(`ready` · `transcript.partial` · `transcript.final` · `ai.batch` · `error`). 키는 camelCase.
**STT 제공자의 이름·주소·키가 이 파일에 없다** — 오디오 형식 선언은 서버가 업스트림 config 에 옮길 뿐 프론트는 상대를 모른다.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import ConfigDict, Field, StringConstraints, TypeAdapter

from dto.meeting_stream import (
    AiBatchFrame,
    OutboundFrame,
    ReadyFrame,
    StreamErrorFrame,
    TranscriptFinalFrame,
    TranscriptPartialFrame,
)
from schemas.base import CamelModel
from schemas.meeting import AgendaItem, LineItem, TranscriptItem

AudioFormat = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]


class _Frame(CamelModel):
    """클라이언트 프레임 공통 — 모르는 키를 조용히 무시하지 않는다(REST 요청과 같은 규칙)."""

    model_config = ConfigDict(extra="forbid")


# --- 클라이언트 → 서버 ----------------------------------------------------------


class StreamAudioDeclaration(_Frame):
    """`auth.audio` — 업스트림 STT 가 받는 형식 중 구현 시점에 고른 값을 클라이언트가 선언한다(§C-8)."""

    format: AudioFormat
    sample_rate: int = Field(ge=8000, le=48000)
    channels: int = Field(ge=1, le=2)


class StreamAuth(_Frame):
    """연결 후 **첫 프레임**, 5초 안에. `accessToken` 은 REST 와 같은 access 토큰."""

    type: Literal["auth"]
    access_token: str = Field(min_length=1)
    audio: StreamAudioDeclaration


class StreamPause(_Frame):
    type: Literal["pause"]
    reason: Literal["user", "mic"]


class StreamResume(_Frame):
    type: Literal["resume"]


ClientControlFrame = Annotated[StreamPause | StreamResume, Field(discriminator="type")]
client_control_adapter: TypeAdapter[StreamPause | StreamResume] = TypeAdapter(ClientControlFrame)


# --- 서버 → 클라이언트 ----------------------------------------------------------


class ReadyMessage(CamelModel):
    type: Literal["ready"] = "ready"
    recording_started_at: datetime
    latest_batch_seq: int
    speaker_count: int


class PartialSegmentMessage(CamelModel):
    speaker_label: str
    at_ms: int
    text: str


class TranscriptPartialMessage(CamelModel):
    type: Literal["transcript.partial"] = "transcript.partial"
    segments: list[PartialSegmentMessage]


class TranscriptFinalMessage(CamelModel):
    type: Literal["transcript.final"] = "transcript.final"
    item: TranscriptItem


class AiBatchMessage(CamelModel):
    type: Literal["ai.batch"] = "ai.batch"
    seq: int
    agendas: list[AgendaItem]
    lines: list[LineItem]


class StreamErrorMessage(CamelModel):
    type: Literal["error"] = "error"
    code: Literal["meeting_stream_disconnected"] = "meeting_stream_disconnected"
    reason: Literal["upstream", "write_failed"]


ServerMessage = ReadyMessage | TranscriptPartialMessage | TranscriptFinalMessage | AiBatchMessage | StreamErrorMessage


def to_message(frame: OutboundFrame) -> ServerMessage:
    """내부 프레임 dto → 계약 모델. **여기가 dto 와 schema 의 유일한 접점**이다(api 층)."""
    if isinstance(frame, ReadyFrame):
        return ReadyMessage(
            recording_started_at=frame.recording_started_at,
            latest_batch_seq=frame.latest_batch_seq,
            speaker_count=frame.speaker_count,
        )
    if isinstance(frame, TranscriptPartialFrame):
        return TranscriptPartialMessage(
            segments=[
                PartialSegmentMessage(
                    speaker_label=segment.speaker_label, at_ms=segment.at_ms, text=segment.text
                )
                for segment in frame.segments
            ]
        )
    if isinstance(frame, TranscriptFinalFrame):
        return TranscriptFinalMessage(item=TranscriptItem.from_dto(frame.item))
    if isinstance(frame, AiBatchFrame):
        return AiBatchMessage(
            seq=frame.seq,
            agendas=[AgendaItem.from_dto(agenda) for agenda in frame.agendas],
            lines=[LineItem.from_dto(line) for line in frame.lines],
        )
    if isinstance(frame, StreamErrorFrame):
        return StreamErrorMessage(reason=frame.reason)  # type: ignore[arg-type]
    raise TypeError(f"알 수 없는 프레임: {type(frame).__name__}")
