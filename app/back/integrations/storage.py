"""녹음 원본 적재 어댑터(WP Phase 1 · BE §5-1 · M-13).

- `STORAGE_ROOT/recordings/{meeting_id}.{ext}` 에 **append** 한다. 별도 업로드 경로가 없다(SYS 불변식 2).
- 파일 I/O 는 동기라 `anyio.to_thread` 로 밀어낸다 — 이벤트 루프를 잡으면 오디오가 밀린다(BE §5).
- **실패는 예외(`OSError`)를 그대로 전파한다.** 스트림 서비스가 그 자리에서 `error{write_failed}` 로 끊는다 —
  원본이 남지 않는 녹음을 계속하지 않는다. 조용한 재시도·대체 경로가 없다.
- 일시정지 구간은 기록되지 않는다(파일 타임라인 ≠ `at_ms` — v1 에 재생이 없다).

테스트는 `install_store()` 로 이 경계에서 대역을 끼운다.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Protocol

import anyio

from config import get_settings

_RECORDINGS_DIR = "recordings"
# 선언된 오디오 형식 → 파일 확장자. 없는 형식은 영숫자만 남겨 그대로 쓴다
_EXTENSIONS = {"pcm_s16le": "pcm", "auto": "bin"}


def extension_for(audio_format: str) -> str:
    known = _EXTENSIONS.get(audio_format)
    if known is not None:
        return known
    return re.sub(r"[^a-z0-9]", "", audio_format.lower()) or "bin"


class RecordingStore(Protocol):
    async def append(self, meeting_id: int, chunk: bytes, *, extension: str) -> str:
        """청크를 끝에 붙이고 **`meeting.recording_path` 에 적을 경로**를 돌려준다. 실패는 예외."""
        ...


class FileRecordingStore:
    def __init__(self, root: Path) -> None:
        self._root = root / _RECORDINGS_DIR

    def path_for(self, meeting_id: int, extension: str) -> Path:
        return self._root / f"{meeting_id}.{extension}"

    async def append(self, meeting_id: int, chunk: bytes, *, extension: str) -> str:
        path = self.path_for(meeting_id, extension)
        await anyio.to_thread.run_sync(_append_sync, path, chunk)
        return str(path)


def _append_sync(path: Path, chunk: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("ab") as handle:
        handle.write(chunk)


_store: RecordingStore | None = None


def get_store() -> RecordingStore:
    global _store
    if _store is None:
        _store = FileRecordingStore(Path(get_settings().storage_root))
    return _store


def install_store(store: RecordingStore | None) -> None:
    """테스트 대역 교체 지점(BE §12)."""
    global _store
    _store = store
