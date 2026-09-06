"""Soniox 대역 — **`integrations/` 경계에서만** 바꾼다(BE §12). 토큰 시나리오를 재생한다.

- `script` 에 넣은 응답(토큰 묶음)을 `tokens()` 가 순서대로 낸다. 각 항목은 `list[SttToken]` 이거나
  `SttUpstreamError` 인스턴스(그 자리에서 끊긴 것으로 본다)다.
- 받은 오디오는 `received` 에 쌓인다 — 「일시정지 뒤 오디오가 업스트림에 닿지 않는다」를 여기서 센다.
- `connect_count`·`close_count` 로 「대역 연결 횟수 = 1」·「finally 로 닫힘 1회」를 확인한다.
- `release()` 를 부르기 전까지 `tokens()` 는 다음 항목을 내지 않는다 — 테스트가 순서를 조종한다.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from dto.meeting_stream import AudioDeclaration
from integrations.soniox import SttToken, SttUpstreamError


class FakeSttSession:
    def __init__(self, script: list[list[SttToken] | SttUpstreamError]) -> None:
        self.received: list[bytes] = []
        self.close_count = 0
        self._script = list(script)
        self._gate = asyncio.Queue[None]()
        self._closed = asyncio.Event()

    async def send_audio(self, chunk: bytes) -> None:
        self.received.append(chunk)

    def release(self, count: int = 1) -> None:
        """다음 `count` 개 응답을 흘려보낸다."""
        for _ in range(count):
            self._gate.put_nowait(None)

    async def tokens(self) -> AsyncIterator[list[SttToken]]:
        while True:
            await self._gate.get()
            if self._closed.is_set():
                return
            if not self._script:
                # 더 낼 것이 없다 — 세션이 닫힐 때까지 조용히 기다린다(실제 Soniox 는 오디오를 기다린다)
                await self._closed.wait()
                return
            item = self._script.pop(0)
            if isinstance(item, SttUpstreamError):
                raise item
            yield item

    async def close(self) -> None:
        self.close_count += 1
        self._closed.set()
        self._gate.put_nowait(None)


class FakeSttConnector:
    def __init__(self) -> None:
        self.script: list[list[SttToken] | SttUpstreamError] = []
        self.connect_count = 0
        self.fail_connect = False
        self.sessions: list[FakeSttSession] = []
        self.declarations: list[AudioDeclaration] = []

    async def connect(self, audio: AudioDeclaration) -> FakeSttSession:
        self.connect_count += 1
        self.declarations.append(audio)
        if self.fail_connect:
            raise SttUpstreamError("대역: 연결 실패")
        session = FakeSttSession(self.script)
        self.sessions.append(session)
        return session

    @property
    def last(self) -> FakeSttSession:
        return self.sessions[-1]


def token(
    text: str, *, final: bool, speaker: str = "1", start_ms: int = 0, end_ms: int | None = None
) -> SttToken:
    return SttToken(
        text=text,
        is_final=final,
        speaker=speaker,
        start_ms=start_ms,
        end_ms=start_ms + 500 if end_ms is None else end_ms,
    )
