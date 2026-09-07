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
 * | `headline` | `#EEF1FE`/`#C9D1FB` | AI 한 줄 요약 — 페이지 56 한 줄 / 드로어 72 두 줄(`layout`) | SPEC-008 U-3 · U-4 · [09] L727~733 |
 * | `generating` | 회색 · 16px 스피너 | 「녹음을 다시 받아쓰고 있습니다」 / 「회의록을 정리하고 있습니다 · 다시 시도 중 (n/2)」 + 「경과 mm:ss」 · 폴링 실패면 「상태를 확인하지 못했습니다 · 다시 확인」 | SPEC-008 U-1 |
 * | `failed` | `#FCEEEC`/`#E2685B` 배너 | 「회의록 생성 실패 · 회의록 탭에 회의 중 작성한 원본을 보여 드립니다」 + 「다시 시도」(사유는 툴팁으로만) | SPEC-008 U-2 |
 *
 * **회의 중 상태 바에 없는 것**(SPEC-007 §7-B): 파형 15개 막대(L813~829) · 「자동 저장 · 09:42」(L830) · AI 한 줄 요약.
 * 경과 시간은 **`now − recordingStartedAt`** 이고 일시정지 중에도 멈추지 않는다(U-1 기대 결과).
 * **`generating` · `failed` 는 WORK-008 이 이 파일에 더했다** — 두 번째 상단 바 파일을 만들지 않는다(정적 검사 ⑥).
 * 한 줄 요약 바의 「MM.DD HH:mm 생성」(시안 L1453)은 **그리지 않는다**(SPEC-008 §7). 회의 상태·라우트를 import 하지 않는다 — prop 만 받는다.
 */

import { Loader2 } from "lucide-react";

import type { JobErrorCode, JobPhase, MergedSummary, PauseReason } from "@/features/meetings/types";
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
      /**
       * `single`(기본) = 페이지 56 한 줄 · `stacked` = 드로어 안 72 두 줄(SPEC-008 U-4).
       * **값 · 색은 하나**이고 다른 것은 줄 나눔뿐이다. 문장 전체는 `title` 툴팁으로 본다.
       */
      layout?: "single" | "stacked";
    }
  | {
      variant: "generating";
      /** `transcription` → 「녹음을 다시 받아쓰고 있습니다」 · `final` → 「회의록을 정리하고 있습니다」. 모르면(첫 폴링 전) ① 문구. */
      phase: JobPhase | null;
      /** ② 시도 회차(1~3 · ① 동안 0). 2 이상이면 「· 다시 시도 중 (n−1/2)」 — 재시도 2회(DEC-003 §7). */
      attempt: number;
      /** 「경과 mm:ss」의 기준 — 종료 요청 응답 시각(ms). 재진입이면 폴링을 처음 붙인 시각이다. `null` 이면 숨긴다. */
      elapsedFromMs: number | null;
      /** 폴링 조회 실패(5xx · 네트워크) 또는 1230회 상한 — 스피너는 그대로, 우측에 「상태를 확인하지 못했습니다 · 다시 확인」. */
      pollFailed: boolean;
      onRecheck: () => void;
    }
  | {
      variant: "failed";
      /** 「다시 시도」 — `POST …/finalize`(①부터). 요청 중이면 비활성 + 스피너. */
      onRetry: () => void;
      retrying: boolean;
      /**
       * 실패 사유(U-2) — **배너는 하나**이고 사유는 **툴팁으로만** 갈린다.
       * `null`(새로고침으로 들어와 볼 job 이 없다)이면 툴팁 없이 배너만.
       */
      errorCode: JobErrorCode | null;
      /** 드로어(U-4)에서도 되지만 편집 잠금 등 부모 사정으로 막을 때. */
      disabled?: boolean;
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

/** 「경과 mm:ss」 — 생성중 바 우측(U-1). 기준은 **종료 요청 응답 시각**이고 화면이 센다(표시 전용). */
function ElapsedSince({ fromMs }: { fromMs: number }) {
  const now = useNow(1000);
  const total = Math.max(0, Math.floor((now - fromMs) / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return (
    <span data-elapsed className="text-caption tabular-nums text-fg-caption">
      경과 {mm}:{ss}
    </span>
  );
}

export const TRANSCRIBING_LABEL = "녹음을 다시 받아쓰고 있습니다";
export const FINALIZING_LABEL = "회의록을 정리하고 있습니다";

/**
 * 단계 문구(U-1) — `progress.phase` · `attempt` 파생. **처리 시간을 적지 않는다**(MF-37).
 * 시도 회차는 재시도 횟수(n−1)/2 로 적는다 — ② 는 자동 재시도 2회다(DEC-003 §7).
 */
export function generatingLabel(phase: JobPhase | null, attempt: number): string {
  if (phase !== "final") {
    return TRANSCRIBING_LABEL;
  }
  const retry = Math.max(0, attempt - 1);
  return retry > 0 ? `${FINALIZING_LABEL} · 다시 시도 중 (${retry}/2)` : FINALIZING_LABEL;
}

export const POLL_FAILED_LABEL = "상태를 확인하지 못했습니다";
export const FAILED_BANNER_TITLE = "회의록 생성 실패";
export const FAILED_BANNER_BODY = "회의록 탭에 회의 중 작성한 원본을 보여 드립니다";
export const RETRY_TOOLTIP = "녹음을 다시 받아쓰고 회의록을 다시 정리합니다 · 원본은 바뀌지 않습니다";

/** 사유 툴팁(U-2) — ①에서 떨어졌나 ②에서 떨어졌나 둘뿐이다. `job_timeout` 은 ② 쪽으로 읽는다. */
export function failedReasonTooltip(errorCode: JobErrorCode | null): string | undefined {
  if (errorCode === null) {
    return undefined;
  }
  return errorCode.startsWith("transcription_") ? "녹음을 다시 받아쓰지 못했습니다" : "회의록을 정리하지 못했습니다";
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

    case "headline": {
      const badge = (
        <span className="inline-flex h-[22px] shrink-0 items-center rounded-chip border border-ai-bar-border bg-card px-2 text-row-label text-ai-bar-badge">
          AI 한 줄 요약
        </span>
      );
      // **다섯**(MF-25) — 최종 회의록 기준. 화면이 세지 않는다(서버가 그리는 그것을 센다).
      const counts = props.summary ? (
        <span className="shrink-0 text-caption text-muted-foreground">
          안건 {props.summary.agendaCount} · 논의 {props.summary.discussionCount} · 결정 {props.summary.decisionCount} · 액션{" "}
          {props.summary.actionCount} · 업무 {props.summary.taskCount}
        </span>
      ) : null;
      if (props.layout === "stacked") {
        // 드로어 — 첫 줄 배지 + 문장(말줄임) / 둘째 줄 카운트(U-4). 값 · 색은 페이지와 같다.
        return (
          <div
            role="note"
            aria-label="AI 한 줄 요약"
            data-layout="stacked"
            className="flex h-[72px] w-full flex-col justify-center gap-1.5 rounded-xl border border-ai-bar-border bg-ai-bar px-5"
          >
            <div className="flex min-w-0 items-center gap-3">
              {badge}
              <span title={props.headline} className="min-w-0 flex-1 truncate text-control-label font-semibold text-ai-bar-foreground">
                {props.headline}
              </span>
            </div>
            {counts}
          </div>
        );
      }
      return (
        <div role="note" aria-label="AI 한 줄 요약" className={cn(LIVE_BAR, "gap-3")}>
          {badge}
          {/* **한 문장 · 넘치면 말줄임**, 줄바꿈 없음([09] L731) */}
          <span title={props.headline} className="min-w-0 flex-1 truncate text-control-label font-semibold text-ai-bar-foreground">
            {props.headline}
          </span>
          {counts}
        </div>
      );
    }

    case "generating": {
      const label = generatingLabel(props.phase, props.attempt);
      return (
        <div role="status" aria-label="회의록 생성중" data-phase={props.phase ?? undefined} className={GRAY_BAR}>
          {/* 16px 스피너 `#7181F8` + 단계 문구 14/600(U-1) — 실패로 꾸미지 않는다 */}
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
          <span className="text-control-label font-semibold text-muted-foreground">{label}</span>
          <span className="ml-auto flex shrink-0 items-center gap-3">
            {props.pollFailed ? (
              <span className="flex items-center gap-2 text-caption text-fg-meta">
                {POLL_FAILED_LABEL}
                <span aria-hidden>·</span>
                <button type="button" onClick={props.onRecheck} className="font-semibold text-foreground underline underline-offset-2 hover:text-primary">
                  다시 확인
                </button>
              </span>
            ) : null}
            {props.elapsedFromMs !== null ? <ElapsedSince fromMs={props.elapsedFromMs} /> : null}
          </span>
        </div>
      );
    }

    case "failed":
      return (
        <div
          role="alert"
          aria-label={FAILED_BANNER_TITLE}
          data-error-code={props.errorCode ?? undefined}
          className="flex h-14 w-full items-center gap-3 rounded-xl border border-status-overdue bg-banner-fail px-5"
        >
          {/* 배너는 **하나**다 — ①(재전사)이든 ②(최종 회의록)든 같은 문구, 사유는 툴팁으로만(U-2) */}
          <span title={failedReasonTooltip(props.errorCode)} className="min-w-0 flex-1 truncate text-control-label text-status-overdue">
            <span className="font-semibold">{FAILED_BANNER_TITLE}</span>
            <span aria-hidden> · </span>
            {FAILED_BANNER_BODY}
          </span>
          <button
            type="button"
            onClick={props.onRetry}
            disabled={props.retrying || props.disabled}
            title={RETRY_TOOLTIP}
            className="flex h-[30px] shrink-0 items-center gap-1.5 rounded-control bg-primary px-3 text-caption font-semibold text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {props.retrying ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
            다시 시도
          </button>
        </div>
      );
  }
}
