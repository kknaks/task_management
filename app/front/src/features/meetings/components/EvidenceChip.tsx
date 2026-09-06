"use client";

/**
 * **근거 타임칩**(SPEC-007 U-6 · [09] L693~696 · 시안 L1693~1695).
 *
 * h24 r6 · `#EEF1FE`/`#C9D1FB`/`#4A55B8` 12/600 · 시계 글리프 + 「HH:MM – HH:MM」. hover `#E4E9FD`.
 * 시각은 **`recordingStartedAt + fromMs/toMs`** 벽시계다(M-11 · `lib/datetime.msToWallClock`).
 *
 * 클릭 → `onClick(fromMs, toMs)` 가 **대상이 있었는지** 돌려준다. 없으면 칩 옆에
 * 「해당 구간의 발화가 없습니다」 를 2초 보인다(U-6 *대상 없음*). 스크롤·하이라이트는 `TranscriptPanel` 의 몫이다.
 * 회의 중 AI 탭 · WORK-008 상세의 근거 칩이 **같은 컴포넌트**다.
 */

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

import type { LineEvidence } from "@/features/meetings/types";
import { formatWallClockRange } from "@/lib/datetime";

const MISS_CAPTION = "해당 구간의 발화가 없습니다";
const MISS_CAPTION_MS = 2000;

export function EvidenceChip({
  evidence,
  recordingStartedAt,
  onClick,
}: {
  evidence: LineEvidence;
  recordingStartedAt: string;
  /** `true` 면 스크립트가 그 구간으로 갔다. `false` 면 캡션만 2초. 없으면 칩은 표시 전용이다. */
  onClick?: (fromMs: number, toMs: number) => boolean;
}) {
  const [missed, setMissed] = useState(false);
  const label = formatWallClockRange(recordingStartedAt, evidence.fromMs, evidence.toMs);

  useEffect(() => {
    if (!missed) {
      return;
    }
    // 캡션 2초 — 표시용 타이머다. 재요청·재연결과 무관하다.
    const id = window.setTimeout(() => setMissed(false), MISS_CAPTION_MS);
    return () => window.clearTimeout(id);
  }, [missed]);

  const chipClass =
    "inline-flex h-6 shrink-0 items-center gap-[5px] rounded-md border border-ai-bar-border bg-ai-bar px-2 text-caption font-semibold tabular-nums text-ai-bar-badge";

  if (!onClick) {
    return (
      <span className={chipClass}>
        <Clock className="h-2.5 w-2.5" aria-hidden />
        {label}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        aria-label={`근거 구간 ${label}`}
        onClick={() => setMissed(!onClick(evidence.fromMs, evidence.toMs))}
        className={`${chipClass} hover:bg-evidence-hover`}
      >
        <Clock className="h-2.5 w-2.5" aria-hidden />
        {label}
      </button>
      {missed ? (
        <span role="status" className="text-caption text-fg-caption">
          {MISS_CAPTION}
        </span>
      ) : null}
    </span>
  );
}
