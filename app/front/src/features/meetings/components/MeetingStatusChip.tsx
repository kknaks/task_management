"use client";

/**
 * **헤더 상태 칩**(SPEC-008 U-1 · U-3 · 시안 L1441~1443) — 34px r8 · 배경 `#F1F2F5` · 테두리 `#E1E3E8` · 13/600 `#5F6470`.
 *
 * | `generating` | dot 자리에 **12px 스피너 `#7181F8`** + 「회의록 생성중」 |
 * | `ended` | dot 8px `#B3B3B3` + 「종료된 회의」 |
 *
 * 페이지 · 드로어가 같은 칩을 쓴다. 회의 상태 값만 받고 라우트·훅을 모른다.
 */

import { Loader2 } from "lucide-react";

import type { MeetingStatus } from "@/features/meetings/types";
import { cn } from "@/lib/utils";

export function MeetingStatusChip({ status, className }: { status: Extract<MeetingStatus, "generating" | "ended">; className?: string }) {
  const generating = status === "generating";
  return (
    <span
      data-meeting-status={status}
      className={cn(
        "inline-flex h-[34px] shrink-0 items-center gap-2 rounded-control border border-chip-border bg-agenda-badge px-3.5 text-meta font-semibold text-muted-foreground",
        className,
      )}
    >
      {generating ? (
        <Loader2 className="h-3 w-3 animate-spin text-primary" aria-label="생성중" />
      ) : (
        <span aria-hidden className="h-2 w-2 rounded-full bg-dot-idle" />
      )}
      {generating ? "회의록 생성중" : "종료된 회의"}
    </span>
  );
}
