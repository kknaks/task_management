"""회의 스트림(WS) 의 내부 프레임 dto — 프론트 계약(`schemas/meeting_stream.py`)이 아니다(§3).

service 는 이 dto 만 만들고, **camelCase JSON 으로 바꾸는 것은 api 층의 `StreamClient` 어댑터**다 —
service 가 `schemas/` 를 import 하지 않는 규칙을 WS 에서도 지킨다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from dto.meeting import MeetingAgendaDTO, MeetingLineDTO, TranscriptItemDTO

# --- 클라이언트 → 서버 ----------------------------------------------------------


@dataclass(frozen=True)
class AudioDeclaration:
    """클라이언트가 `auth.audio` 로 선언한 오디오 형식(SPEC-007 §4 · §C-8). 서버가 업스트림 config 에 그대로 옮긴다."""

    format: str
    sample_rate: int
    channels: int


@dataclass(frozen=True)
class AudioFrame:
    chunk: bytes


@dataclass(frozen=True)
class PauseFrame:
    reason: str


@dataclass(frozen=True)
class ResumeFrame:
    pass


@dataclass(frozen=True)
class ClientGone:
    """클라이언트가 연결을 끊었다(WebSocketDisconnect). 세션은 여기서 끝난다 — 재연결 없음."""


InboundFrame = AudioFrame | PauseFrame | ResumeFrame | ClientGone


# --- 서버 → 클라이언트 (SPEC-007 §4 5종) ---------------------------------------


@dataclass(frozen=True)
class ReadyFrame:
    recording_started_at: datetime
    latest_batch_seq: int
    speaker_count: int


@dataclass(frozen=True)
class PartialSegment:
    speaker_label: str
    at_ms: int
    text: str


@dataclass(frozen=True)
class TranscriptPartialFrame:
    """**교체 렌더** — 올 때마다 이전 잠정을 통째로 바꾼다. 저장하지 않는다(M-9). 백프레셔 시 버려질 수 있다."""

    segments: list[PartialSegment] = field(default_factory=list)


@dataclass(frozen=True)
class TranscriptFinalFrame:
    """**추가 렌더** — DB 적재와 같은 시점에 나간다."""

    item: TranscriptItemDTO


@dataclass(frozen=True)
class AiBatchFrame:
    """**AI 트랙 전체**. 커밋 직후(BE-11 · M-6-a).

    증분이 아니라 전량이다(MF-53) — 매 배치가 트랙을 갈아끼우므로 화면은 통째로 교체한다.
    `agendas` 는 **줄이 안건 안에 중첩된 트리**이고 상세 응답 `agendas.ai` 와 같은 모양이다.
    """

    seq: int
    agendas: list[MeetingAgendaDTO]


@dataclass(frozen=True)
class StreamErrorFrame:
    """`error{meeting_stream_disconnected, reason}` — 이 뒤 연결을 닫는다. 재연결하지 않는다."""

    reason: str


OutboundFrame = ReadyFrame | TranscriptPartialFrame | TranscriptFinalFrame | AiBatchFrame | StreamErrorFrame
