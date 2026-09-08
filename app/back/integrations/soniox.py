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

import asyncio
import json
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import httpx
import websockets
from websockets.exceptions import ConnectionClosed, WebSocketException

from config import get_settings
from dto.meeting_stream import AudioDeclaration

__all__ = [
    "AudioDeclaration",
    "SttAsyncConnector",
    "SttConnector",
    "SttSession",
    "SttToken",
    "SttUpstreamError",
    "TranscribeContext",
]

SONIOX_URL = "wss://stt-rt.soniox.com/transcribe-websocket"
# 종료 후 재전사 — 같은 키를 쓰는 REST(system/README §External Integrations · SPEC-008 §4 ①)
SONIOX_API_URL = "https://api.soniox.com"
_MODEL = "stt-rt-v5"
_ASYNC_MODEL = "stt-async-v5"
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


# --- 종료 후 재전사 (async · MF-37 · SPEC-008 §4 ①) --------------------------------
#
# 실시간 갈래(위)와 **완전히 따로** 산다 — 프로토콜도 모델도 다르다. 공유하는 것은 키와 `SttToken` 뿐이다.
# 흐름 — `POST /v1/files`(멀티파트) → `POST /v1/transcriptions` → 상태 폴링 → `GET …/transcript`.


@dataclass(frozen=True)
class TranscribeContext:
    """Soniox `context`(MF-54 ① · SPEC-008 §4 「② 의 `context`」). 상한 8000 토큰.

    `general` 은 `[{key, value}]` 목록, `text` 는 직전 회의 요약(없으면 **키를 싣지 않는다**).
    `terms` 는 **비운다** — 사내 고유명사 목록이 v1 어디에도 없다(DEC-003 OQ-10). 자리를 지우지 않고 비운 채 둔다.
    """

    general: list[dict[str, str]]
    text: str | None = None

    def to_json(self) -> dict[str, object]:
        context: dict[str, object] = {"general": list(self.general)}
        if self.text:
            context["text"] = self.text
        return context


class SttAsyncConnector(Protocol):
    async def transcribe(
        self,
        path: Path,
        context: TranscribeContext,
        *,
        poll_sec: int,
        timeout_sec: int,
    ) -> list[SttToken]: ...


class SonioxAsyncClient:
    """`stt-async-v5` REST. 실패는 전부 `SttUpstreamError` 하나다(fallback 없음 — MF-58).

    **폴링 사이에 아무것도 붙들지 않는다** — 여기는 DB 를 모르고, 부르는 쪽이 트랜잭션을 닫고 온다(BE §7).
    """

    def __init__(self, api_key: str, *, base_url: str = SONIOX_API_URL) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")

    @property
    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._api_key}"}

    async def transcribe(
        self,
        path: Path,
        context: TranscribeContext,
        *,
        poll_sec: int,
        timeout_sec: int,
    ) -> list[SttToken]:
        deadline = time.monotonic() + timeout_sec
        async with httpx.AsyncClient(base_url=self._base_url, timeout=60.0) as client:
            file_id = await self._upload(client, path)
            transcription_id = await self._request(client, file_id, context)
            await self._wait(client, transcription_id, poll_sec=poll_sec, deadline=deadline)
            return await self._fetch(client, transcription_id)

    async def _upload(self, client: httpx.AsyncClient, path: Path) -> str:
        try:
            with path.open("rb") as handle:
                response = await client.post(
                    "/v1/files", headers=self._headers, files={"file": (path.name, handle)}
                )
        except OSError as exc:
            # 녹음 원본을 못 읽는다 — 설계한 실패다(재전사가 시작될 수 없다)
            raise SttUpstreamError(f"녹음 원본을 읽지 못했습니다: {path.name}") from exc
        except httpx.HTTPError as exc:
            raise SttUpstreamError("업스트림에 파일을 올리지 못했습니다") from exc
        return str(_ok(response, "파일 업로드")["id"])

    async def _request(
        self, client: httpx.AsyncClient, file_id: str, context: TranscribeContext
    ) -> str:
        payload = {
            "file_id": file_id,
            "model": _ASYNC_MODEL,
            "language_hints": list(_LANGUAGE_HINTS),
            "enable_speaker_diarization": True,
            "context": context.to_json(),
        }
        try:
            response = await client.post(
                "/v1/transcriptions", headers=self._headers, json=payload
            )
        except httpx.HTTPError as exc:
            raise SttUpstreamError("재전사를 요청하지 못했습니다") from exc
        return str(_ok(response, "재전사 요청")["id"])

    async def _wait(
        self, client: httpx.AsyncClient, transcription_id: str, *, poll_sec: int, deadline: float
    ) -> None:
        """상태가 `completed` 가 될 때까지 `poll_sec` 마다 본다. 상한을 넘기면 `TimeoutError`.

        상한과 실패를 **다른 예외**로 낸다 — 부르는 쪽이 `transcription_timeout` 과 `transcription_failed` 를 가른다.
        """
        while True:
            try:
                response = await client.get(
                    f"/v1/transcriptions/{transcription_id}", headers=self._headers
                )
            except httpx.HTTPError as exc:
                raise SttUpstreamError("재전사 상태를 확인하지 못했습니다") from exc
            body = _ok(response, "재전사 상태")
            status = body.get("status")
            if status == "completed":
                return
            if status == "error":
                raise SttUpstreamError(
                    f"재전사가 실패했습니다: {body.get('error_message') or 'unknown'}"
                )
            if time.monotonic() + poll_sec > deadline:
                raise TimeoutError("재전사가 상한 안에 끝나지 않았습니다")
            await asyncio.sleep(poll_sec)

    async def _fetch(self, client: httpx.AsyncClient, transcription_id: str) -> list[SttToken]:
        try:
            response = await client.get(
                f"/v1/transcriptions/{transcription_id}/transcript", headers=self._headers
            )
        except httpx.HTTPError as exc:
            raise SttUpstreamError("재전사 결과를 받지 못했습니다") from exc
        body = _ok(response, "재전사 결과")
        return [_to_async_token(raw) for raw in body.get("tokens", [])]


def _ok(response: httpx.Response, what: str) -> dict:
    """2xx 가 아니면 **본문째** 실패로 올린다 — 응답 코드를 삼키지 않는다(SYS-OQ-5 실물 확인의 근거가 된다)."""
    if response.status_code >= 400:
        raise SttUpstreamError(f"{what} 실패 {response.status_code}: {response.text[:500]}")
    return response.json()


def _to_async_token(raw: dict) -> SttToken:
    """async 결과 토큰. 전량이 확정이라 `is_final=True` 다(잠정 개념이 없다)."""
    speaker = raw.get("speaker")
    return SttToken(
        text=raw["text"],
        is_final=True,
        speaker=None if speaker is None else str(speaker),
        start_ms=int(raw.get("start_ms", 0)),
        end_ms=int(raw.get("end_ms", 0)),
    )


_async_connector: SttAsyncConnector | None = None


def get_async_connector() -> SttAsyncConnector:
    global _async_connector
    if _async_connector is None:
        _async_connector = SonioxAsyncClient(get_settings().soniox_api_key)
    return _async_connector


def install_async_connector(connector: SttAsyncConnector | None) -> None:
    """테스트 대역 교체 지점(BE §12). `None` 이면 실제 어댑터로 돌아간다."""
    global _async_connector
    _async_connector = connector
