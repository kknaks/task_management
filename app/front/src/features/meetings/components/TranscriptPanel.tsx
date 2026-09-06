"use client";

/**
 * **실시간 스크립트 패널**(SPEC-007 U-5 · U-6 · 시안 L975~1044 · 하이라이트 L1782~1789).
 *
 * - 발화 블록: 화자 dot 6px + 「화자 n」 12/700 + 시각(`recordingStartedAt + atMs` 벽시계) + 본문 13/1.6
 * - 화자 색은 **라벨 번호 홀짝** 한 곳(`speakerTone`) — 홀수 `#7181F8`/`#4A55B8` · 짝수 `#338BF6`/`#1663B5`. 이름 없음(M-10)
 * - 잠정 발화: 마지막 블록 뒤 회색 본문 + 캐럿 2px. **시각을 그리지 않는다**(§7-B L1036). 올 때마다 통째로 교체
 * - 따라가기: 맨 아래에 붙어 있으면 새 블록마다 내려간다. 사용자가 올리면 멈추고, 근거 칩 이동도 끈다
 * - `ref.scrollToRange(fromMs, toMs)`: `[fromMs, toMs]` 와 **겹치는 블록 전부** `#F4F5FF` + 「근거 구간」, 첫 블록으로 스크롤.
 *   대상이 없으면 `false`(스크롤·하이라이트 변경 없음). `Esc` 또는 다음 호출로 해제
 * - 푸터 44: 「받아쓰기 중 · 확정된 발화는 바로 저장됩니다」 / 일시정지 「일시정지 중 · 받아쓰기가 멈춰 있습니다」.
 *   종료 후(SPEC-008 U-3)는 호출자가 `footer` 로 「전체 스크립트 n분 · 화자 n명」을 끼운다 — 잠정 발화 · 자동 따라가기가 없다
 *
 * 회의 중 화면 · WORK-008 상세의 근거 칩이 **같은 패널**을 쓴다. 회의 상태·라우트를 import 하지 않는다.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { Mic } from "lucide-react";

import type { PartialSegment, TranscriptItem } from "@/features/meetings/types";
import { msToWallClock } from "@/lib/datetime";
import { cn } from "@/lib/utils";

export interface TranscriptPanelHandle {
  /** 겹치는 블록을 하이라이트하고 첫 블록으로 스크롤. 대상이 없으면 `false`. */
  scrollToRange: (fromMs: number, toMs: number) => boolean;
  clearHighlight: () => void;
}

interface Range {
  fromMs: number;
  toMs: number;
}

/** 화자 색 규칙 **한 곳** — 라벨 번호 홀짝(최대 15명 — M-10). */
export function speakerTone(label: string): { dot: string; text: string } {
  const even = Number.parseInt(label, 10) % 2 === 0;
  return even
    ? { dot: "bg-dot-ai", text: "text-line-decision" }
    : { dot: "bg-primary", text: "text-ai-bar-badge" };
}

function overlaps(item: TranscriptItem, range: Range): boolean {
  return item.atMs <= range.toMs && item.endMs >= range.fromMs;
}

/** 스크롤 위치가 바닥에서 이 안이면 「붙어 있다」로 본다. */
const BOTTOM_SLACK_PX = 8;

export const TranscriptPanel = forwardRef<
  TranscriptPanelHandle,
  {
    items: readonly TranscriptItem[];
    /** `null` 이면 잠정 발화 없음(일시정지·끊김·아직 없음). */
    partial: readonly PartialSegment[] | null;
    recordingStartedAt: string | null;
    /** 푸터 문구가 갈린다. */
    paused: boolean;
    /** 종료 후 푸터(SPEC-008 U-3 「전체 스크립트 n분 · 화자 n명」). 있으면 받아쓰기 푸터 대신 이것을 그린다. */
    footer?: ReactNode;
    className?: string;
  }
>(function TranscriptPanel({ items, partial, recordingStartedAt, paused, footer, className }, ref) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const blockRefs = useRef(new Map<number, HTMLDivElement>());
  const followRef = useRef(true);
  const [highlight, setHighlight] = useState<Range | null>(null);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) {
      return;
    }
    followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX;
  }, []);

  // 새 블록·잠정이 오면 붙어 있을 때만 따라 내려간다(U-5 *스크롤*).
  useEffect(() => {
    const el = scrollerRef.current;
    if (el && followRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [items.length, partial]);

  // `Esc` 로 하이라이트 해제(U-6).
  useEffect(() => {
    if (!highlight) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHighlight(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [highlight]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToRange(fromMs, toMs) {
        const range = { fromMs, toMs };
        const first = items.find((item) => overlaps(item, range));
        if (!first) {
          return false;
        }
        followRef.current = false;
        setHighlight(range);
        const el = blockRefs.current.get(first.id);
        // jsdom 에는 없다 — 실물 브라우저에서만 스크롤한다.
        if (el && typeof el.scrollIntoView === "function") {
          el.scrollIntoView({ block: "center" });
        }
        return true;
      },
      clearHighlight() {
        setHighlight(null);
      },
    }),
    [items],
  );

  const clock = (atMs: number) => (recordingStartedAt ? msToWallClock(recordingStartedAt, atMs) : "");

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div ref={scrollerRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto p-[18px]" aria-live="polite">
        {items.length === 0 && !partial ? (
          <p className="my-auto py-10 text-center text-meta text-fg-faint">아직 발화가 없습니다</p>
        ) : (
          <div className="flex flex-col gap-3.5">
            {items.map((item) => {
              const tone = speakerTone(item.speakerLabel);
              const marked = highlight !== null && overlaps(item, highlight);
              return (
                <div
                  key={item.id}
                  ref={(el) => {
                    if (el) {
                      blockRefs.current.set(item.id, el);
                    } else {
                      blockRefs.current.delete(item.id);
                    }
                  }}
                  data-transcript-id={item.id}
                  data-highlighted={marked || undefined}
                  className={cn(
                    "flex flex-col gap-1 rounded-control border px-2.5 py-2",
                    marked ? "border-ai-bar-border bg-pick" : "border-transparent",
                  )}
                >
                  <div className="flex items-center gap-[7px]">
                    <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tone.dot)} />
                    <span className={cn("text-caption font-bold", tone.text)}>화자 {item.speakerLabel}</span>
                    <span
                      className={cn(
                        "text-time-mark tabular-nums",
                        marked ? "font-semibold text-ai-bar-badge" : "text-fg-placeholder",
                      )}
                    >
                      {clock(item.atMs)}
                    </span>
                    {marked ? <span className="ml-auto text-row-label text-ai-bar-badge">근거 구간</span> : null}
                  </div>
                  <p className="pl-[13px] text-meta leading-relaxed text-foreground">{item.content}</p>
                </div>
              );
            })}

            {partial && partial.length > 0
              ? partial.map((segment, index) => {
                  const tone = speakerTone(segment.speakerLabel);
                  return (
                    <div
                      key={`partial-${index}`}
                      data-partial
                      className="flex flex-col gap-1 rounded-control border border-transparent px-2.5 py-2"
                    >
                      <div className="flex items-center gap-[7px]">
                        <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tone.dot)} />
                        <span className={cn("text-caption font-bold", tone.text)}>화자 {segment.speakerLabel}</span>
                      </div>
                      <p className="pl-[13px] text-meta leading-relaxed text-fg-meta">
                        {segment.text}
                        <span aria-hidden className="ml-0.5 inline-block h-[13px] w-0.5 translate-y-0.5 bg-primary" />
                      </p>
                    </div>
                  );
                })
              : null}
          </div>
        )}
      </div>

      <div className="flex h-11 shrink-0 items-center gap-2 border-t border-divider px-[18px]">
        {footer ?? (
          <>
            <Mic className="h-[13px] w-[13px] text-fg-placeholder" aria-hidden />
            <span className="text-caption text-fg-caption">
              {paused ? "일시정지 중 · 받아쓰기가 멈춰 있습니다" : "받아쓰기 중 · 확정된 발화는 바로 저장됩니다"}
            </span>
          </>
        )}
      </div>
    </div>
  );
});
