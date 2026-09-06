"use client";

/**
 * **상단 바 슬롯 하나**(top 150 · 본문 폭 · 56) — SPEC-006 U-4 상태 바 · U-8 요약 바 · 디자인 시스템 [09] L727~733.
 *
 * > 상세 화면 상단에 **한 개만.** 진행 중 화면에서는 회색 상태 바가 **같은 자리**를 쓴다.
 *
 * 변형은 `variant` 로 갈린다. 이 work 는 둘 —
 * - `waiting` — 회색 `#F4F5F7` · 10px dot `#B3B3B3` · 「기록 대기 00:00:00」 · 캡션(회의록.dc.html L587~593)
 * - `headline` — AI 한 줄 요약 바(배지 + 문장 말줄임 + 「안건 n · 결정 n · 액션 n」)
 *
 * **`recording` · `paused` · `generating` · `failed` 는 WORK-007·008 이 이 파일에 더한다.**
 * 바를 두 개 그리지 않는다 — 파일도 하나, 렌더도 하나다.
 *
 * 회의 상태·라우트를 **import 하지 않는다** — prop 만 받는다(WORK-007·008 재사용의 조건).
 */

import type { MergedSummary } from "@/features/meetings/types";

export type MeetingTopBarProps =
  | { variant: "waiting" }
  | {
      variant: "headline";
      /** `null` 이면 호출자가 **바를 그리지 않는다** — 빈 바를 두지 않는다(U-8). */
      headline: string;
      summary: MergedSummary | null;
    };

export function MeetingTopBar(props: MeetingTopBarProps) {
  if (props.variant === "waiting") {
    return (
      <div
        role="status"
        aria-label="기록 대기"
        className="flex h-14 w-full items-center gap-3.5 rounded-xl border border-chip-border bg-chip-bg px-5"
      >
        <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-dot-idle" />
        <span className="text-control-label font-bold text-muted-foreground">기록 대기</span>
        {/* 시작 전이라 **0 고정** — 파형·경과 시간 진행은 없다(U-4) */}
        <span className="text-control-label font-bold tabular-nums text-fg-caption">00:00:00</span>
        <span className="ml-auto text-caption text-fg-meta">
          회의 시작을 누르면 녹음과 스크립트가 함께 켜집니다
        </span>
      </div>
    );
  }

  return (
    <div
      role="note"
      aria-label="AI 한 줄 요약"
      className="flex h-14 w-full items-center gap-3 rounded-xl border border-ai-bar-border bg-ai-bar px-5"
    >
      <span className="inline-flex h-[22px] shrink-0 items-center rounded-chip border border-ai-bar-border bg-card px-2 text-row-label text-ai-bar-badge">
        AI 한 줄 요약
      </span>
      {/* **한 문장 · 넘치면 말줄임**, 줄바꿈 없음([09] L731) */}
      <span className="min-w-0 flex-1 truncate text-control-label font-semibold text-ai-bar-foreground">
        {props.headline}
      </span>
      {props.summary ? (
        <span className="shrink-0 text-caption text-muted-foreground">
          안건 {props.summary.agendaCount} · 결정 {props.summary.decisionCount} · 액션{" "}
          {props.summary.actionCount}
        </span>
      ) : null}
    </div>
  );
}
