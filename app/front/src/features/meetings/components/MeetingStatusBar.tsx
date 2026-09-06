"use client";

/**
 * **상단 바 슬롯 하나**(top 150 · 본문 폭 · 56) — 회의 생애 전체에서 **한 자리**([09] L733 · SPEC-007 Placement).
 *
 * > 상세 화면 상단에 **한 개만.** 진행 중 화면에서는 회색 상태 바가 같은 자리를 쓴다.
 *
 * WORK-006 의 `MeetingTopBar`(`waiting` · `headline`)를 **이 파일이 흡수했다** — 두 파일이 같은 자리를 다투지 않는다.
 * 변형은 `variant` 로 갈린다.
 *
 * | variant | 색 | 문구 | 근거 |
 * |---|---|---|---|
 * | `waiting` | 회색 | 「기록 대기 00:00:00」 + 캡션 | SPEC-006 U-4 · 회의록 L587~593 |
 * | `connecting` | 회색 | 「연결 중」 + 경과 | SPEC-007 U-1 |
 * | `live` | `#EEF1FE`/`#C9D1FB` · dot 광륜 | 「기록 중」 + 경과 | L809~812 |
 * | `paused` | 회색 | 「일시정지」 + 사유 + 경과 · 「다른 창에서 기록 중입니다」 | U-1 · Case Matrix |
 * | `headline` | `#EEF1FE`/`#C9D1FB` | AI 한 줄 요약 | SPEC-008 · [09] L727~733 |
 *
 * **회의 중 상태 바에 없는 것**(SPEC-007 §7-B): 파형 15개 막대(L813~829) · 「자동 저장 · 09:42」(L830) · AI 한 줄 요약.
 * 경과 시간은 **`now − recordingStartedAt`** 이고 일시정지 중에도 멈추지 않는다(U-1 기대 결과).
 * **`generating` · `failed` 는 WORK-008 이 이 파일에 더한다.** 회의 상태·라우트를 import 하지 않는다 — prop 만 받는다.
 */

import type { MergedSummary, PauseReason } from "@/features/meetings/types";
import { formatElapsed } from "@/lib/datetime";
import { useNow } from "@/lib/hooks/useNow";
import { cn } from "@/lib/utils";

export type MeetingStatusBarProps =
  | { variant: "waiting" }
  | { variant: "connecting"; elapsedFrom: string | null }
  | { variant: "live"; elapsedFrom: string }
  | { variant: "paused"; pauseReason: PauseReason; elapsedFrom: string | null }
  | {
      variant: "headline";
      /** `null` 이면 호출자가 **바를 그리지 않는다** — 빈 바를 두지 않는다(SPEC-006 U-8). */
      headline: string;
      summary: MergedSummary | null;
    };

/** 사유별 문구(U-1 · Case Matrix). **별도 배너 컴포넌트가 아니라 이 바가 사유를 말한다**(DEC-003 §1). */
export const PAUSE_LABEL: Record<PauseReason, string> = {
  user: "일시정지",
  mic: "일시정지 · 마이크 연결이 끊겼습니다",
  "stream:upstream": "일시정지 · 서버 연결이 끊겼습니다",
  "stream:write_failed": "일시정지 · 녹음 파일을 저장하지 못했습니다",
  "stream:elsewhere": "다른 창에서 기록 중입니다",
};

/** 경과 시간 — 1초 시계. 기준점은 `recordingStartedAt`(`start_at` 아님 — M-1-a). */
function Elapsed({ from, className }: { from: string | null; className?: string }) {
  const now = useNow(1000);
  return (
    <span data-elapsed className={cn("text-control-label font-bold tabular-nums", className)}>
      {from ? formatElapsed(from, now) : "00:00:00"}
    </span>
  );
}

const GRAY_BAR = "flex h-14 w-full items-center gap-3.5 rounded-xl border border-chip-border bg-chip-bg px-5";
const LIVE_BAR = "flex h-14 w-full items-center gap-3.5 rounded-xl border border-ai-bar-border bg-ai-bar px-5";

export function MeetingStatusBar(props: MeetingStatusBarProps) {
  switch (props.variant) {
    case "waiting":
      return (
        <div role="status" aria-label="기록 대기" className={GRAY_BAR}>
          <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-dot-idle" />
          <span className="text-control-label font-bold text-muted-foreground">기록 대기</span>
          {/* 시작 전이라 **0 고정** — 파형·경과 시간 진행은 없다(SPEC-006 U-4) */}
          <span className="text-control-label font-bold tabular-nums text-fg-caption">00:00:00</span>
          <span className="ml-auto text-caption text-fg-meta">회의 시작을 누르면 녹음과 스크립트가 함께 켜집니다</span>
        </div>
      );

    case "connecting":
      return (
        <div role="status" aria-label="연결 중" className={GRAY_BAR}>
          <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-dot-idle" />
          <span className="text-control-label font-bold text-muted-foreground">연결 중</span>
          <Elapsed from={props.elapsedFrom} className="text-fg-caption" />
        </div>
      );

    case "live":
      return (
        <div role="status" aria-label="기록 중" className={LIVE_BAR}>
          {/* dot 10px + 광륜([09] L723). 파형·「자동 저장」은 **없다**(§7-B) */}
          <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary shadow-halo" />
          <span className="text-control-label font-bold text-ai-bar-foreground">기록 중</span>
          <Elapsed from={props.elapsedFrom} className="text-ai-bar-foreground" />
        </div>
      );

    case "paused": {
      const label = PAUSE_LABEL[props.pauseReason];
      return (
        <div role="status" aria-label={label} data-pause-reason={props.pauseReason} className={GRAY_BAR}>
          <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-dot-idle" />
          <span className="text-control-label font-bold text-muted-foreground">{label}</span>
          <Elapsed from={props.elapsedFrom} className="text-fg-caption" />
        </div>
      );
    }

    case "headline":
      return (
        <div role="note" aria-label="AI 한 줄 요약" className={cn(LIVE_BAR, "gap-3")}>
          <span className="inline-flex h-[22px] shrink-0 items-center rounded-chip border border-ai-bar-border bg-card px-2 text-row-label text-ai-bar-badge">
            AI 한 줄 요약
          </span>
          {/* **한 문장 · 넘치면 말줄임**, 줄바꿈 없음([09] L731) */}
          <span className="min-w-0 flex-1 truncate text-control-label font-semibold text-ai-bar-foreground">
            {props.headline}
          </span>
          {props.summary ? (
            <span className="shrink-0 text-caption text-muted-foreground">
              안건 {props.summary.agendaCount} · 결정 {props.summary.decisionCount} · 액션 {props.summary.actionCount}
            </span>
          ) : null}
        </div>
      );
  }
}
