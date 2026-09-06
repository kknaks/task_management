"""WS 클라이언트 대역 — service 의 `StreamClient` 포트를 메모리로 구현한다.

라우터(`WebSocketStreamClient`)를 대신해 테스트가 프레임을 밀어 넣고(`audio` · `pause` · `resume` · `disconnect`)
서버가 보낸 프레임(`sent`)과 close(`closed`)를 본다. 세션 테스트가 같은 이벤트 루프·같은 DB 세션에서 돈다.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable

from dto.meeting_stream import (
    AudioFrame,
    ClientGone,
    InboundFrame,
    OutboundFrame,
    PauseFrame,
    ResumeFrame,
)
from service.meeting_stream_service import StreamClientClosed


class FakeStreamClient:
    def __init__(self) -> None:
        self._inbound: asyncio.Queue[InboundFrame] = asyncio.Queue()
        self.sent: list[OutboundFrame] = []
        self.closed: tuple[int, str] | None = None

    # --- 포트 -------------------------------------------------------------------

    async def receive(self) -> InboundFrame:
        return await self._inbound.get()

    async def send(self, frame: OutboundFrame) -> None:
        if self.closed is not None:
            raise StreamClientClosed()
        self.sent.append(frame)

    async def close(self, code: int, reason: str) -> None:
        if self.closed is None:
            self.closed = (code, reason)

    # --- 테스트 조작 ---------------------------------------------------------------

    def audio(self, chunk: bytes) -> None:
        self._inbound.put_nowait(AudioFrame(chunk=chunk))

    def pause(self, reason: str = "user") -> None:
        self._inbound.put_nowait(PauseFrame(reason=reason))

    def resume(self) -> None:
        self._inbound.put_nowait(ResumeFrame())

    def disconnect(self) -> None:
        self._inbound.put_nowait(ClientGone())

    def frames(self, kind: type) -> list:
        return [frame for frame in self.sent if isinstance(frame, kind)]

    async def wait_for(self, predicate: Callable[[], bool], *, timeout: float = 3.0) -> None:
        """조건이 참이 될 때까지 기다린다 — 스트림은 태스크로 돌고 테스트는 결과만 본다."""

        async def _poll() -> None:
            while not predicate():
                await asyncio.sleep(0.005)

        await asyncio.wait_for(_poll(), timeout=timeout)
