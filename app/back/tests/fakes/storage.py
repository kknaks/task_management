"""녹음 적재 대역 — 메모리에 쌓고, 지정한 청크에서 `OSError` 를 던진다(BE §12)."""

from __future__ import annotations


class FakeRecordingStore:
    def __init__(self) -> None:
        self.chunks: dict[int, list[bytes]] = {}
        # 이 번호(1부터)의 append 에서 실패한다. None 이면 항상 성공
        self.fail_at: int | None = None
        self.append_count = 0

    async def append(self, meeting_id: int, chunk: bytes, *, extension: str) -> str:
        self.append_count += 1
        if self.fail_at is not None and self.append_count >= self.fail_at:
            raise OSError("대역: 디스크 쓰기 실패")
        self.chunks.setdefault(meeting_id, []).append(chunk)
        return f"/fake-storage/recordings/{meeting_id}.{extension}"

    def size(self, meeting_id: int) -> int:
        return sum(len(chunk) for chunk in self.chunks.get(meeting_id, []))
