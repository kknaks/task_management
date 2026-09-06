"""1층 — `WS /api/meetings/{id}/stream` **하나**(SPEC-007 §4 · BE §5-1). WS 전용 라우터라 `meeting_router` 와 분리한다.

여기서 하는 것은 **첫 프레임 인증뿐**이다 — 연결 → 첫 텍스트 프레임 5초 대기 → 토큰 검증. 실패면 `4401`.
회의 소유(4404) · 상태·단일 세션(4409) · 중계 · 적재 · 일시정지는 전부 `meeting_stream_service` 다.

브라우저 WebSocket 은 헤더를 못 붙이므로 토큰을 `auth` 프레임에 싣는다(FE §4-2). `require_account` 의존성을 쓰지 않는다 —
Bearer 헤더가 없다. 토큰 판정 함수(`decode_access_token`)는 같은 것이다.
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError as PydanticValidationError
from starlette.websockets import WebSocketState

from config import get_settings
from core.exceptions import UnauthorizedError
from core.security import decode_access_token
from dto.meeting_stream import (
    AudioDeclaration,
    AudioFrame,
    ClientGone,
    InboundFrame,
    OutboundFrame,
    PauseFrame,
    ResumeFrame,
)
from schemas.meeting_stream import StreamAuth, StreamPause, client_control_adapter, to_message
from service import meeting_stream_service
from service.meeting_stream_service import StreamClientClosed

router = APIRouter(prefix="/api/meetings", tags=["meeting-stream"])

# SPEC-007 §4 — 첫 프레임 5초. 없거나 무효면 `4401`
CLOSE_UNAUTHORIZED = 4401
_AUTH_TIMEOUT_SEC = 5.0
_REASON_UNAUTHORIZED = "unauthorized"


class WebSocketStreamClient:
    """service 의 `StreamClient` 포트를 Starlette WebSocket 으로 구현한다 — **dto ↔ JSON 변환은 여기서만**."""

    def __init__(self, websocket: WebSocket) -> None:
        self._websocket = websocket

    async def receive(self) -> InboundFrame:
        try:
            message: dict[str, Any] = await self._websocket.receive()
        except WebSocketDisconnect:
            return ClientGone()
        if message["type"] == "websocket.disconnect":
            return ClientGone()
        if message.get("bytes") is not None:
            return AudioFrame(chunk=message["bytes"])
        control = client_control_adapter.validate_json(message.get("text") or "")
        if isinstance(control, StreamPause):
            return PauseFrame(reason=control.reason)
        return ResumeFrame()

    async def send(self, frame: OutboundFrame) -> None:
        if self._websocket.application_state != WebSocketState.CONNECTED:
            raise StreamClientClosed()
        try:
            await self._websocket.send_text(to_message(frame).model_dump_json(by_alias=True))
        except WebSocketDisconnect as exc:
            raise StreamClientClosed() from exc

    async def close(self, code: int, reason: str) -> None:
        if self._websocket.application_state != WebSocketState.CONNECTED:
            return
        await self._websocket.close(code=code, reason=reason)


@router.websocket("/{meeting_id}/stream")
async def meeting_stream(websocket: WebSocket, meeting_id: int) -> None:
    await websocket.accept()

    # 첫 프레임 인증 — 5초 안에 `auth` 텍스트 프레임. 그 밖은 전부 4401 (사유를 흘리지 않는다)
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=_AUTH_TIMEOUT_SEC)
        auth = StreamAuth.model_validate_json(raw)
        account_id = decode_access_token(auth.access_token, secret=get_settings().jwt_secret)
    except (TimeoutError, PydanticValidationError, UnauthorizedError, WebSocketDisconnect):
        if websocket.application_state == WebSocketState.CONNECTED:
            await websocket.close(code=CLOSE_UNAUTHORIZED, reason=_REASON_UNAUTHORIZED)
        return

    await meeting_stream_service.serve(
        WebSocketStreamClient(websocket),
        account_id=account_id,
        meeting_id=meeting_id,
        audio=AudioDeclaration(
            format=auth.audio.format,
            sample_rate=auth.audio.sample_rate,
            channels=auth.audio.channels,
        ),
    )
