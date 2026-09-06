"""Soniox 실시간 STT 어댑터 — **`SONIOX_API_KEY` 를 읽는 유일한 코드**(WP Phase 1 · BE §11).

- 프론트는 Soniox 주소도 키도 모른다(DEC-003 §STT · SYS-4). 이 모듈은 `service/` 만 부른다 —
  `schemas/`·`api/` 에 `soniox` 라는 글자가 없어야 한다(정적 검사).
- 옵션은 고정이다 — `stt-rt-v5` · `language_hints:["ko"]` · `enable_speaker_diarization:true` ·
  **endpoint detection 미사용**(조기 파이널라이즈가 화자 분리를 깎는다 — DEC-003 §STT L162).
  옵션 자체를 config 에 싣지 않는 것이 「미사용」이다.
- 프로토콜(soniox-study): 최초 JSON config → 오디오 바이트 → 빈 문자열로 종료. 응답은
  `{tokens:[{text, is_final, speaker, start_ms, end_ms}], error_code, error_message, finished}` 다.
  `is_final:false` 토큰은 응답마다 리셋 렌더, `is_final:true` 는 불변 append.
- **연결 실패·끊김은 `SttUpstreamError` 하나로 낸다** — SPEC-007 §4 `error{reason:"upstream"}` 이 설계한 실패다.
  그 밖(형식 오류 등)은 그대로 전파한다(BE §8-1). **재연결하지 않는다.**

테스트는 `install_connector()` 로 이 경계에서 대역을 끼운다(BE §12) — service 를 목으로 바꾸지 않는다.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Protocol

import websockets
from websockets.exceptions import ConnectionClosed, WebSocketException

from config import get_settings
from dto.meeting_stream import AudioDeclaration

__all__ = ["AudioDeclaration", "SttConnector", "SttSession", "SttToken", "SttUpstreamError"]

SONIOX_URL = "wss://stt-rt.soniox.com/transcribe-websocket"
_MODEL = "stt-rt-v5"
_LANGUAGE_HINTS = ["ko"]
# 형식이 `auto` 면 sample_rate·num_channels 를 보내지 않는다(컨테이너 포맷은 헤더가 말한다).
_AUTO_FORMAT = "auto"


@dataclass(frozen=True)
class SttToken:
    text: str
    is_final: bool
    # 익명 라벨 번호 문자열(`"1"`·`"2"`). 화자 분리 결과가 아직 없으면 None
    speaker: str | None
    start_ms: int
    end_ms: int


class SttUpstreamError(Exception):
    """업스트림 연결 실패·끊김·Soniox 오류 응답 — **설계한 실패 하나**(SPEC-007 §4 `reason: upstream`)."""


class SttSession(Protocol):
    async def send_audio(self, chunk: bytes) -> None: ...

    def tokens(self) -> AsyncIterator[list[SttToken]]: ...

    async def close(self) -> None: ...


class SttConnector(Protocol):
    async def connect(self, audio: AudioDeclaration) -> SttSession: ...


def build_config(api_key: str, audio: AudioDeclaration) -> dict[str, object]:
    """Soniox 최초 JSON config. **endpoint detection 키가 없다** — 그것이 「미사용」이다."""
    config: dict[str, object] = {
        "api_key": api_key,
        "model": _MODEL,
        "audio_format": audio.format,
        "language_hints": list(_LANGUAGE_HINTS),
        "enable_speaker_diarization": True,
    }
    if audio.format != _AUTO_FORMAT:
        config["sample_rate"] = audio.sample_rate
        config["num_channels"] = audio.channels
    return config


class SonioxSession:
    def __init__(self, socket: websockets.ClientConnection) -> None:
        self._socket = socket
        self._closed = False

    async def send_audio(self, chunk: bytes) -> None:
        try:
            await self._socket.send(chunk)
        except ConnectionClosed as exc:
            raise SttUpstreamError("업스트림 연결이 끊겼습니다") from exc

    async def tokens(self) -> AsyncIterator[list[SttToken]]:
        while True:
            try:
                raw = await self._socket.recv()
            except ConnectionClosed as exc:
                raise SttUpstreamError("업스트림 연결이 끊겼습니다") from exc
            message = json.loads(raw)
            if message.get("error_code") is not None:
                raise SttUpstreamError(
                    f"Soniox 오류 {message['error_code']}: {message.get('error_message')}"
                )
            yield [_to_token(token) for token in message.get("tokens", [])]
            if message.get("finished"):
                return

    async def close(self) -> None:
        """종료 프레임(빈 문자열) 뒤 소켓을 닫는다. 이미 끊긴 소켓은 그냥 닫는다 — 끊김은 `tokens()` 가 이미 알렸다."""
        if self._closed:
            return
        self._closed = True
        try:
            await self._socket.send("")
        except ConnectionClosed:
            pass
        await self._socket.close()


def _to_token(raw: dict) -> SttToken:
    speaker = raw.get("speaker")
    return SttToken(
        text=raw["text"],
        is_final=bool(raw.get("is_final", False)),
        speaker=None if speaker is None else str(speaker),
        start_ms=int(raw.get("start_ms", 0)),
        end_ms=int(raw.get("end_ms", 0)),
    )


class SonioxConnector:
    """실제 Soniox. 키는 생성 시 한 번 받는다 — 로그·응답·프레임 어디에도 싣지 않는다."""

    def __init__(self, api_key: str, *, url: str = SONIOX_URL) -> None:
        self._api_key = api_key
        self._url = url

    async def connect(self, audio: AudioDeclaration) -> SttSession:
        try:
            socket = await websockets.connect(self._url)
        except (OSError, WebSocketException) as exc:
            raise SttUpstreamError("업스트림에 연결하지 못했습니다") from exc
        try:
            await socket.send(json.dumps(build_config(self._api_key, audio)))
        except ConnectionClosed as exc:
            raise SttUpstreamError("업스트림 연결이 끊겼습니다") from exc
        return SonioxSession(socket)


_connector: SttConnector | None = None


def get_connector() -> SttConnector:
    global _connector
    if _connector is None:
        _connector = SonioxConnector(get_settings().soniox_api_key)
    return _connector


def install_connector(connector: SttConnector | None) -> None:
    """테스트 대역 교체 지점(BE §12). `None` 이면 실제 어댑터로 돌아간다."""
    global _connector
    _connector = connector
