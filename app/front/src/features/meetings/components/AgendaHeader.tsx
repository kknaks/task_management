"use client";

/**
 * **안건 헤더 한 벌**(SPEC-007 U-2 · 시안 L848~855 · [09] 트리 헤더).
 *
 * 완료 체크 18px(완료 `#7181F8` 채움 + ✓ · 활성 `#7181F8` 1.6px 테두리 · 그 밖 `#D9D9D9` 테두리) +
 * 「안건 n」 11/700 + 제목 15/700(완료면 `#9EA2AE` + 취소선 · 대기면 `#757575`) + **배지** + 우측 시각(첫 줄 시각).
 *
 * **배지 문구는 호출자가 정한다**(`badge`) — 회의 중 「대기」 · 종료 후 「다음 논의로」 · AI 신설 안건 「AI 안건」 캡션.
 * 이 컴포넌트는 트랙도 회의 상태도 모른다. **제목 수정·삭제 어포던스가 없다**(U-2 · DEC-003 §1 표 종료 후 편집) —
 * 종료 후 편집 모드(SPEC-008 U-7)는 `titleControl` 슬롯으로 **입력 상자를 대신 끼운다**(WORK-008). 슬롯이 없으면 WORK-007 렌더 그대로다.
 */

import type { ReactNode } from "react";
import { Check } from "lucide-react";

import type { TreeDensity } from "@/features/meetings/components/AgendaLineTree";
import { cn } from "@/lib/utils";

/** 배지 — `tone` 이 체크 박스·제목 색도 정한다. `caption` 은 배지 대신 캡션(「AI 안건」). `null` 은 아무것도 없음. */
export type AgendaBadge =
  | { tone: "active" | "done" | "next"; label: string }
  | { tone: "caption"; label: string }
  | null;

const BADGE_CLASS: Record<"active" | "done" | "next", string> = {
  active: "bg-ai-bar text-ai-bar-badge",
  done: "bg-agenda-badge text-fg-meta",
  next: "bg-agenda-badge text-fg-caption",
};

export function AgendaHeader({
  number,
  title,
  badge,
  time,
  density = "default",
  onToggleDone,
  titleControl,
}: {
  /** 「안건 n」 — `orderIndex + 1`. */
  number: number;
  title: string;
  badge: AgendaBadge;
  /** 첫 줄이 생긴 시각 `HH:MM`. 줄이 없으면 `null` 로 숨긴다. */
  time: string | null;
  /** 있으면 체크가 버튼이다(사람 트랙). 없으면 표시만(AI 트랙 · 읽기 전용). */
  onToggleDone?: () => void;
  /** 미리보기 패널은 `compact` — **글자 · 여백만** 줄인다(구조 · 배지는 같다 · FE §2 규칙 7). */
  density?: TreeDensity;
  /** 편집 모드의 안건 제목 입력 상자(SPEC-008 U-7 · 시안 L1894). 있으면 제목 텍스트 대신 이것을 그린다. */
  titleControl?: ReactNode;
}) {
  const compact = density === "compact";
  const tone = badge && badge.tone !== "caption" ? badge.tone : "none";
  const boxClass = cn(
    "flex shrink-0 items-center justify-center rounded-[5px]",
    compact ? "h-3.5 w-3.5" : "h-[18px] w-[18px]",
    tone === "done" && "bg-primary text-primary-foreground",
    tone === "active" && "border-[1.6px] border-primary",
    (tone === "next" || tone === "none") && "border-[1.6px] border-border",
  );

  return (
    <div className={cn("flex items-center px-2", compact ? "gap-2" : "gap-[11px]")}>
      {onToggleDone ? (
        <button
          type="button"
          aria-label={`안건 ${number} ${tone === "done" ? "완료 해제" : "완료"}`}
          aria-pressed={tone === "done"}
          onClick={onToggleDone}
          className={cn(boxClass, "hover:opacity-80")}
        >
          {tone === "done" ? <Check className={compact ? "h-2.5 w-2.5" : "h-[11px] w-[11px]"} strokeWidth={2.4} aria-hidden /> : null}
        </button>
      ) : (
        <span aria-hidden className={boxClass}>
          {tone === "done" ? <Check className={compact ? "h-2.5 w-2.5" : "h-[11px] w-[11px]"} strokeWidth={2.4} aria-hidden /> : null}
        </span>
      )}
      <span className={cn("shrink-0 text-fg-caption", compact ? "text-badge" : "text-row-label")}>안건 {number}</span>
      {titleControl ?? (
        <span
          className={cn(
            "min-w-0 truncate",
            compact ? "text-panel" : "text-section",
            tone === "done" ? "text-fg-caption line-through" : tone === "next" ? "text-fg-meta" : "text-foreground",
          )}
        >
          {title}
        </span>
      )}
      {badge ? (
        badge.tone === "caption" ? (
          <span className="shrink-0 text-row-label text-fg-caption">{badge.label}</span>
        ) : (
          <span className={cn("inline-flex h-5 shrink-0 items-center rounded-chip px-[7px] text-badge", BADGE_CLASS[badge.tone])}>
            {badge.label}
          </span>
        )
      ) : null}
      {time ? <span className="ml-auto shrink-0 text-caption tabular-nums text-fg-faint">{time}</span> : null}
    </div>
  );
}
