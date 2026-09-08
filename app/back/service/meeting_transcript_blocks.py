"""확정 발화 **블록 경계 — 한 곳**(SPEC-007 §4 · SPEC-008 §4 「같은 규칙」 · MF-37).

sub-word 토큰을 **화자 변경 · 300자 · 토큰 사이 2초 공백** 중 먼저 오는 것에서 끊어 블록으로 묶는다.
실시간 중계(`meeting_stream_service`)와 종료 후 재전사(`meeting_finalize_service`)가 **같은 것을 쓴다** —
두 벌이면 재전사 뒤에 근거 칩(`evidence`)이 가리키는 구간이 어긋난다(M-9-a).

- 실시간은 토큰이 하나씩 오므로 `BlockBuilder` 를 들고 있다가 닫힌 블록을 그때그때 적재·push 한다.
- 재전사는 토큰이 한꺼번에 오므로 `build_blocks()` 로 한 번에 묶는다. 그 함수도 같은 `BlockBuilder` 를 돈다.

여기는 **묶기만** 한다 — DB 도 push 도 모른다(그래야 두 경로가 같은 것을 쓸 수 있다).
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from dto.meeting import TranscriptBlockDTO
from integrations.soniox import SttToken

__all__ = [
    "BLOCK_GAP_MS",
    "BLOCK_MAX_CHARS",
    "DEFAULT_SPEAKER",
    "BlockBuilder",
    "TranscriptBlock",
    "build_blocks",
]

# 블록 경계 — SPEC-007 §4 가 정한 값이다. env 가 아니고 **이 파일에만 있다**(정적 검사)
BLOCK_MAX_CHARS = 300
BLOCK_GAP_MS = 2000
# 화자 라벨이 아직 없는 확정 토큰(분리 전) — 직전 블록 화자에 붙이고, 없으면 첫 화자
DEFAULT_SPEAKER = "1"


# 닫힌 블록 하나 — `meeting_transcript` 한 행이 될 값이다. 저장은 부르는 쪽이 한다.
# dto 에 사는 이유: repository 가 이 모양을 받는데, repository 가 service 를 import 하면 층이 뒤집힌다(§2)
TranscriptBlock = TranscriptBlockDTO


@dataclass
class _OpenBlock:
    speaker: str
    start_ms: int
    end_ms: int
    text: str

    def close(self) -> TranscriptBlock | None:
        """빈 블록(공백뿐)은 행이 되지 않는다 — `None` 이다."""
        content = self.text.strip()
        if not content:
            return None
        return TranscriptBlock(
            speaker_label=self.speaker,
            at_ms=self.start_ms,
            end_ms=self.end_ms,
            content=content,
        )


class BlockBuilder:
    """확정 토큰을 받아 블록을 닫아 준다. **경계 판정이 사는 유일한 자리**다.

    `base_ms` 는 파일·스트림 시작을 회의 기준(0)으로 옮기는 값이다 — 실시간은 일시정지 누적분이 들어가고,
    재전사는 파일 시작이 곧 `recording_started_at` 이라 0 이다(M-9-a — 그래서 `at_ms` 기준이 같다).
    """

    def __init__(self, *, base_ms: int = 0) -> None:
        self._base_ms = base_ms
        self._block: _OpenBlock | None = None

    @property
    def open_speaker(self) -> str | None:
        """아직 안 닫힌 블록의 화자 — `ready.speakerCount` 가 이것까지 센다."""
        return None if self._block is None else self._block.speaker

    @property
    def base_ms(self) -> int:
        return self._base_ms

    @base_ms.setter
    def base_ms(self, value: int) -> None:
        """실시간의 일시정지 보정 — 다음 토큰부터 적용된다."""
        self._base_ms = value

    def add(self, token: SttToken) -> list[TranscriptBlock]:
        """토큰 하나를 넣고 **그 결과 닫힌 블록들**을 돌려준다(0~2개).

        둘이 될 수 있다 — 화자가 바뀌어 앞 블록이 닫히고, 새 블록의 첫 토큰만으로 300자를 넘는 경우다.
        """
        closed: list[TranscriptBlock] = []
        speaker = token.speaker or (self._block.speaker if self._block else DEFAULT_SPEAKER)
        start_ms = self._base_ms + token.start_ms
        end_ms = self._base_ms + token.end_ms

        block = self._block
        if block is not None and (
            speaker != block.speaker or start_ms - block.end_ms >= BLOCK_GAP_MS
        ):
            closed.extend(self._flush())
            block = None

        if block is None:
            block = _OpenBlock(speaker=speaker, start_ms=start_ms, end_ms=end_ms, text=token.text)
            self._block = block
        else:
            block.text += token.text
            block.end_ms = max(block.end_ms, end_ms)

        if len(block.text.strip()) >= BLOCK_MAX_CHARS:
            closed.extend(self._flush())
        return closed

    def flush(self) -> list[TranscriptBlock]:
        """열린 블록을 닫는다 — 스트림 종료 · 토큰 끝."""
        return self._flush()

    def _flush(self) -> list[TranscriptBlock]:
        block = self._block
        self._block = None
        if block is None:
            return []
        closed = block.close()
        return [] if closed is None else [closed]


def build_blocks(tokens: Iterable[SttToken], *, base_ms: int = 0) -> list[TranscriptBlock]:
    """토큰 전량을 한 번에 묶는다 — 재전사(①)가 쓴다. 실시간과 **같은 경계**를 지난다."""
    builder = BlockBuilder(base_ms=base_ms)
    blocks: list[TranscriptBlock] = []
    for token in tokens:
        blocks.extend(builder.add(token))
    blocks.extend(builder.flush())
    return blocks
