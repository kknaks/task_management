"""WORK-007 Phase 3 — WS 2단 중계 · 녹음 적재 · 일시정지 · 실패 경로(대역 Soniox 로 토큰 시나리오 재생).

세션 본체(`meeting_stream_service.serve`)는 **대역 클라이언트**로, 첫 프레임 인증(`4401`)은 **Starlette TestClient** 로 닫는다.
`wscat` 대신 테스트 클라이언트다(WP §7). 정본: SPEC-007 §4 WS 계약 · BE §5-1.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Iterator

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from api import meeting_stream_router
from dto.meeting_stream import (
    AiBatchFrame,
    ReadyFrame,
    StreamErrorFrame,
    TranscriptFinalFrame,
    TranscriptPartialFrame,
)
from integrations.soniox import SttUpstreamError
from models.meeting import Meeting, MeetingTranscript
from service import meeting_stream_service
from tests.fakes.soniox import FakeSttConnector, token
from tests.fakes.storage import FakeRecordingStore
from tests.fakes.stream_client import FakeStreamClient
from tests.meeting_fixtures import MeetingOwner, create_meeting, owner, stranger  # noqa: F401
from tests.meeting_live_fixtures import (  # noqa: F401
    AUDIO,
    ScheduleRecorder,
    live_scope,
    schedule_calls,
    start_meeting,
)

pytestmark = pytest.mark.usefixtures("live_scope", "schedule_calls")


async def _open(
    owner: MeetingOwner, meeting_id: int, *, account_id: int | None = None
) -> tuple[FakeStreamClient, asyncio.Task]:
    client = FakeStreamClient()
    task = asyncio.create_task(
        meeting_stream_service.serve(
            client,
            account_id=owner.id if account_id is None else account_id,
            meeting_id=meeting_id,
            audio=AUDIO,
        )
    )
    return client, task


async def _open_ready(owner: MeetingOwner, meeting_id: int) -> tuple[FakeStreamClient, asyncio.Task]:
    client, task = await _open(owner, meeting_id)
    await client.wait_for(lambda: bool(client.frames(ReadyFrame)))
    return client, task


async def _finish(client: FakeStreamClient, task: asyncio.Task) -> None:
    if not task.done():
        client.disconnect()
    await asyncio.wait_for(task, timeout=3)


async def _count_blocks(session: AsyncSession, meeting_id: int) -> int:
    return int(
        await session.scalar(
            select(func.count()).select_from(MeetingTranscript).where(MeetingTranscript.meeting_id == meeting_id)
        )
        or 0
    )


# --- 연결 조건 (4404 · 4409) ------------------------------------------------------


async def test_strangers_meeting_closes_4404(
    client: AsyncClient, owner: MeetingOwner, stranger: MeetingOwner, fake_stt: FakeSttConnector
) -> None:
    detail = await start_meeting(client, owner)
    fake, task = await _open(owner, detail["id"], account_id=stranger.id)
    await asyncio.wait_for(task, timeout=3)
    assert fake.closed == (4404, "not_found")
    assert fake_stt.connect_count == 0  # 업스트림은 인증 뒤에만 연다


async def test_scheduled_meeting_closes_4409_invalid_status(
    client: AsyncClient, owner: MeetingOwner, fake_stt: FakeSttConnector
) -> None:
    created = await create_meeting(client, owner)
    fake, task = await _open(owner, created["id"])
    await asyncio.wait_for(task, timeout=3)
    assert fake.closed == (4409, "invalid_meeting_status")
    assert fake_stt.connect_count == 0


async def test_second_client_closes_4409_and_the_first_is_untouched(
    client: AsyncClient, owner: MeetingOwner
) -> None:
    detail = await start_meeting(client, owner)
    first, first_task = await _open_ready(owner, detail["id"])

    second, second_task = await _open(owner, detail["id"])
    await asyncio.wait_for(second_task, timeout=3)
    assert second.closed == (4409, "meeting_stream_active")

    assert first.closed is None and not first_task.done()
    ready = first.frames(ReadyFrame)[0]
    assert ready.latest_batch_seq == 0 and ready.speaker_count == 0
    await _finish(first, first_task)
    assert not meeting_stream_service.is_active(detail["id"])


# --- 잠정 · 확정 ---------------------------------------------------------------------


async def test_partials_are_pushed_as_replacements_and_never_stored(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_stt: FakeSttConnector
) -> None:
    """`is_final:false` 3번 → `transcript.partial` 3개(내용 교체) · DB 행 0."""
    fake_stt.script = [
        [token("좋습", final=False)],
        [token("좋습니다", final=False)],
        [token("좋습니다 그러면", final=False, speaker="2", start_ms=1200)],
    ]
    detail = await start_meeting(client, owner)
    fake, task = await _open_ready(owner, detail["id"])

    fake_stt.last.release(3)
    await fake.wait_for(lambda: len(fake.frames(TranscriptPartialFrame)) == 3)
    partials = fake.frames(TranscriptPartialFrame)
    assert [segment.text for frame in partials for segment in frame.segments] == ["좋습", "좋습니다", "좋습니다 그러면"]
    assert partials[-1].segments[0].speaker_label == "2"
    assert await _count_blocks(db_session, detail["id"]) == 0
    await _finish(fake, task)


async def test_final_tokens_close_blocks_on_speaker_change_length_and_gap(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_stt: FakeSttConnector
) -> None:
    """블록 경계 3종. **`meeting_transcript` 행 수 = `transcript.final` 프레임 수.**"""
    long_text = "가" * 150
    fake_stt.script = [
        # 화자 1 두 토큰 → 화자 2 로 바뀌며 첫 블록이 닫힌다
        [token("안녕하세요 ", final=True, speaker="1", start_ms=0, end_ms=400),
         token("반갑습니다", final=True, speaker="1", start_ms=400, end_ms=900),
         token("네", final=True, speaker="2", start_ms=1000, end_ms=1300)],
        # 화자 2 — 2초 넘는 공백 → 둘째 블록 닫힘
        [token("다시", final=True, speaker="2", start_ms=4000, end_ms=4300)],
        # 화자 2 — 300자 도달 → 셋째(다시) 블록에 이어 붙다가 300자에서 닫힘
        [token(long_text, final=True, speaker="2", start_ms=4300, end_ms=5000),
         token(long_text, final=True, speaker="2", start_ms=5000, end_ms=6000)],
    ]
    detail = await start_meeting(client, owner)
    fake, task = await _open_ready(owner, detail["id"])

    fake_stt.last.release(3)
    await fake.wait_for(lambda: len(fake.frames(TranscriptFinalFrame)) == 3)
    finals = fake.frames(TranscriptFinalFrame)
    assert [frame.item.speaker_label for frame in finals] == ["1", "2", "2"]
    assert finals[0].item.content == "안녕하세요 반갑습니다"
    assert finals[1].item.content == "네"
    assert len(finals[2].item.content) == 302  # 「다시」 + 300자 — 300자에 이른 순간 닫힌다
    assert await _count_blocks(db_session, detail["id"]) == 3
    assert finals[0].item.at_ms <= finals[1].item.at_ms <= finals[2].item.at_ms

    await _finish(fake, task)


async def test_speaker_count_and_ready_follow_the_blocks(
    client: AsyncClient, owner: MeetingOwner, fake_stt: FakeSttConnector
) -> None:
    fake_stt.script = [
        [token("하나", final=True, speaker="1"), token("둘", final=True, speaker="2", start_ms=600)],
    ]
    detail = await start_meeting(client, owner)
    fake, task = await _open_ready(owner, detail["id"])
    fake_stt.last.release(1)
    await fake.wait_for(lambda: len(fake.frames(TranscriptFinalFrame)) == 1)

    fake.pause()
    fake.resume()
    await fake.wait_for(lambda: len(fake.frames(ReadyFrame)) == 2)
    assert fake.frames(ReadyFrame)[1].speaker_count == 2
    await _finish(fake, task)


# --- 녹음 적재 -----------------------------------------------------------------------


async def test_audio_chunks_are_appended_and_the_path_is_recorded(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession,
    fake_store: FakeRecordingStore, fake_stt: FakeSttConnector,
) -> None:
    """청크 3개 → 파일 크기가 **정확히 그 합** · `recording_path` 채움 · Soniox 에도 같은 순서로."""
    detail = await start_meeting(client, owner)
    fake, task = await _open_ready(owner, detail["id"])

    chunks = [b"a" * 100, b"b" * 250, b"c" * 7]
    for chunk in chunks:
        fake.audio(chunk)
    await fake.wait_for(lambda: len(fake_stt.last.received) == 3)

    assert fake_store.size(detail["id"]) == 357
    assert fake_stt.last.received == chunks
    row = (await db_session.scalars(select(Meeting).where(Meeting.id == detail["id"]))).one()
    assert row.recording_path == f"/fake-storage/recordings/{detail['id']}.pcm"
    await _finish(fake, task)


async def test_append_failure_closes_with_write_failed_before_reaching_upstream(
    client: AsyncClient, owner: MeetingOwner, fake_store: FakeRecordingStore, fake_stt: FakeSttConnector
) -> None:
    """②번째 append 가 던지면 **그 청크에서** `error{write_failed}` + close. 이후 청크는 Soniox 로 가지 않는다."""
    fake_store.fail_at = 2
    detail = await start_meeting(client, owner)
    fake, task = await _open_ready(owner, detail["id"])

    fake.audio(b"one")
    fake.audio(b"two")
    fake.audio(b"three")
    await asyncio.wait_for(task, timeout=3)

    errors = fake.frames(StreamErrorFrame)
    assert [frame.reason for frame in errors] == ["write_failed"]
    assert fake.closed == (1011, "meeting_stream_disconnected")
    assert fake_stt.last.received == [b"one"]
    assert fake_stt.last.close_count == 1  # finally 로 업스트림을 닫았다
    assert not meeting_stream_service.is_active(detail["id"])


# --- 일시정지 · 재개 ---------------------------------------------------------------------


async def test_pause_holds_audio_and_keeps_the_upstream_open(
    client: AsyncClient, owner: MeetingOwner, fake_stt: FakeSttConnector, fake_store: FakeRecordingStore
) -> None:
    """`pause` 뒤 오디오는 Soniox 대역에 도달하지 않고, `resume` 뒤 `ready` 가 다시 온다. 업스트림은 닫히지 않았다."""
    detail = await start_meeting(client, owner)
    fake, task = await _open_ready(owner, detail["id"])

    fake.audio(b"before")
    await fake.wait_for(lambda: len(fake_stt.last.received) == 1)

    fake.pause("mic")
    fake.audio(b"while-paused")
    fake.resume()
    await fake.wait_for(lambda: len(fake.frames(ReadyFrame)) == 2)

    assert fake_stt.last.received == [b"before"]
    assert fake_store.size(detail["id"]) == len(b"before")  # 일시정지 구간은 파일에도 없다
    assert fake_stt.last.close_count == 0
    assert fake_stt.connect_count == 1
    # 일시정지가 잠정 발화를 비운다 — 빈 교체 프레임
    assert any(not frame.segments for frame in fake.frames(TranscriptPartialFrame))

    fake.audio(b"after")
    await fake.wait_for(lambda: len(fake_stt.last.received) == 2)
    await _finish(fake, task)


# --- 업스트림 끊김 · 클라이언트 끊김 -----------------------------------------------------


async def test_upstream_drop_closes_with_upstream_and_never_reconnects(
    client: AsyncClient, owner: MeetingOwner, fake_stt: FakeSttConnector
) -> None:
    fake_stt.script = [[token("하나", final=False)], SttUpstreamError("대역: 끊김")]
    detail = await start_meeting(client, owner)
    fake, task = await _open_ready(owner, detail["id"])

    fake_stt.last.release(2)
    await asyncio.wait_for(task, timeout=3)

    assert [frame.reason for frame in fake.frames(StreamErrorFrame)] == ["upstream"]
    assert fake.closed == (1011, "meeting_stream_disconnected")
    assert fake_stt.connect_count == 1  # 서버가 다시 붙지 않는다
    assert fake_stt.last.close_count == 1
    assert not meeting_stream_service.is_active(detail["id"])


async def test_upstream_connect_failure_is_reported_not_retried(
    client: AsyncClient, owner: MeetingOwner, fake_stt: FakeSttConnector
) -> None:
    fake_stt.fail_connect = True
    detail = await start_meeting(client, owner)
    fake, task = await _open(owner, detail["id"])
    await asyncio.wait_for(task, timeout=3)
    assert [frame.reason for frame in fake.frames(StreamErrorFrame)] == ["upstream"]
    assert fake_stt.connect_count == 1


async def test_client_disconnect_closes_the_upstream_in_finally(
    client: AsyncClient, owner: MeetingOwner, fake_stt: FakeSttConnector
) -> None:
    detail = await start_meeting(client, owner)
    fake, task = await _open_ready(owner, detail["id"])
    fake.disconnect()
    await asyncio.wait_for(task, timeout=3)
    assert fake_stt.last.close_count == 1
    assert fake_stt.connect_count == 1
    assert not meeting_stream_service.is_active(detail["id"])


async def test_open_block_is_stored_when_the_client_leaves(
    client: AsyncClient, owner: MeetingOwner, db_session: AsyncSession, fake_stt: FakeSttConnector
) -> None:
    """확정 토큰은 잃지 않는다 — 열린 블록은 세션이 끝날 때 적재된다(M-9). push 는 없다(보낼 곳이 없다)."""
    fake_stt.script = [[token("끊기기 전 확정", final=True, speaker="1")]]
    detail = await start_meeting(client, owner)
    fake, task = await _open_ready(owner, detail["id"])
    fake_stt.last.release(1)
    await asyncio.sleep(0.05)
    fake.disconnect()
    await asyncio.wait_for(task, timeout=3)
    assert await _count_blocks(db_session, detail["id"]) == 1
    assert fake.frames(TranscriptFinalFrame) == []


# --- 배치 트리거 · AI 증분 push ----------------------------------------------------------


async def test_closed_blocks_schedule_the_transcript_trigger(
    client: AsyncClient, owner: MeetingOwner, fake_stt: FakeSttConnector, schedule_calls: ScheduleRecorder
) -> None:
    fake_stt.script = [[token("하나", final=True, speaker="1"), token("둘", final=True, speaker="2", start_ms=600)]]
    detail = await start_meeting(client, owner)
    fake, task = await _open_ready(owner, detail["id"])
    fake_stt.last.release(1)
    await fake.wait_for(lambda: len(fake.frames(TranscriptFinalFrame)) == 1)
    assert (detail["id"], "transcript") in schedule_calls.calls
    await _finish(fake, task)


async def test_push_ai_batch_reaches_the_live_client_and_skips_when_absent(
    client: AsyncClient, owner: MeetingOwner
) -> None:
    detail = await start_meeting(client, owner)
    assert await meeting_stream_service.push_ai_batch(detail["id"], seq=1, agendas=[], lines=[]) is False

    fake, task = await _open_ready(owner, detail["id"])
    assert await meeting_stream_service.push_ai_batch(detail["id"], seq=1, agendas=[], lines=[]) is True
    await fake.wait_for(lambda: bool(fake.frames(AiBatchFrame)))
    assert fake.frames(AiBatchFrame)[0].seq == 1
    await _finish(fake, task)


async def test_backpressure_drops_only_partials(
    client: AsyncClient, owner: MeetingOwner, monkeypatch: pytest.MonkeyPatch
) -> None:
    """큐가 상한을 넘으면 잠정만 버린다 — 확정·AI 증분은 남는다."""
    detail = await start_meeting(client, owner)
    fake, task = await _open_ready(owner, detail["id"])
    session = meeting_stream_service._sessions[detail["id"]]
    session._queue_max = 1
    # 송신 펌프를 잠시 막는다 — 큐를 채우기 위해서다
    blocked = asyncio.Event()
    original_send = fake.send

    async def slow_send(frame):  # type: ignore[no-untyped-def]
        await blocked.wait()
        await original_send(frame)

    monkeypatch.setattr(fake, "send", slow_send)
    session.enqueue(AiBatchFrame(seq=1, agendas=[], lines=[]))
    session.enqueue(TranscriptPartialFrame(segments=[]))
    session.enqueue(TranscriptPartialFrame(segments=[]))
    session.enqueue(AiBatchFrame(seq=2, agendas=[], lines=[]))
    blocked.set()
    await fake.wait_for(lambda: len(fake.frames(AiBatchFrame)) == 2)
    assert len(fake.frames(TranscriptPartialFrame)) <= 1
    await _finish(fake, task)


# --- 첫 프레임 인증 (라우터 · TestClient) ------------------------------------------------


@pytest.fixture
def ws_app(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """DB 를 건드리지 않는 4401 경로만 — 5초 대기를 짧게 줄인다."""
    from main import app

    monkeypatch.setattr(meeting_stream_router, "_AUTH_TIMEOUT_SEC", 0.2)
    with TestClient(app) as test_client:
        yield test_client


def _expect_close(websocket, code: int) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(WebSocketDisconnect) as info:
        websocket.receive_text()
    assert info.value.code == code


def test_no_first_frame_closes_4401(ws_app: TestClient) -> None:
    with ws_app.websocket_connect("/api/meetings/1/stream") as websocket:
        _expect_close(websocket, 4401)


def test_invalid_token_closes_4401(ws_app: TestClient) -> None:
    with ws_app.websocket_connect("/api/meetings/1/stream") as websocket:
        websocket.send_text(json.dumps({
            "type": "auth", "accessToken": "expired.or.forged",
            "audio": {"format": "pcm_s16le", "sampleRate": 16000, "channels": 1},
        }))
        _expect_close(websocket, 4401)


def test_malformed_auth_frame_closes_4401(ws_app: TestClient) -> None:
    with ws_app.websocket_connect("/api/meetings/1/stream") as websocket:
        websocket.send_text(json.dumps({"type": "pause", "reason": "user"}))
        _expect_close(websocket, 4401)
