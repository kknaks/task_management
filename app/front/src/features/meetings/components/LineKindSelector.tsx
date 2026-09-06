"use client";

/**
 * **편집 모드의 줄 종류 셀렉터**(SPEC-008 U-7 · 시안 L1898 · 디자인 시스템 [07] L500~516).
 *
 * 라벨 자리가 **64×26 r6 테두리 `#E1E3E8`** 트리거가 되고, 현재 종류 색 11/700 으로 이름을 적는다.
 * 팝오버 항목 4 — 논의 / 결정 / 업무 / 액션. 현재 값은 배경 `#F4F5FF` + `#4B52A8` + 체크. **고르면 즉시 저장**([07] L516).
 *
 * **「업무」는 이 줄에 `taskId` 가 있을 때만 활성**이고, 비활성이면 캡션 「연관 업무는 「+ 연관 업무」로 추가합니다」(U-7 문구).
 * 실패 표시는 prop(`saveFailed`) — 트리거 테두리만 실패색이 된다(SPEC-002 U-7).
 */

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LINE_KIND_LABEL, LINE_KINDS, LINE_LABEL_CLASS } from "@/features/meetings/lineKinds";
import type { LineKind } from "@/features/meetings/types";
import { cn } from "@/lib/utils";

export const TASK_KIND_LOCKED_CAPTION = "연관 업무는 「+ 연관 업무」로 추가합니다";

export function LineKindSelector({
  value,
  taskLinked,
  onSelect,
  saveFailed = false,
  disabled = false,
}: {
  value: LineKind;
  /** 이 줄에 `taskId` 가 있는가 — 「업무」 항목의 활성 조건. */
  taskLinked: boolean;
  onSelect: (kind: LineKind) => void;
  saveFailed?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="줄 종류"
          disabled={disabled}
          data-save-failed={saveFailed || undefined}
          className={cn(
            "flex h-[26px] w-[64px] shrink-0 items-center justify-between rounded-md border bg-card px-2 text-row-label hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50",
            saveFailed ? "border-destructive" : "border-chip-border",
            LINE_LABEL_CLASS[value],
          )}
        >
          {LINE_KIND_LABEL[value]}
          <ChevronDown className="h-2.5 w-2.5 text-fg-caption" strokeWidth={2} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[200px] rounded-card border-border bg-card p-1 shadow-popover">
        <ul role="listbox" aria-label="줄 종류">
          {LINE_KINDS.map((kind) => {
            const selected = kind === value;
            const locked = kind === "task" && !taskLinked;
            return (
              <li key={kind}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={locked}
                  onClick={() => {
                    setOpen(false);
                    if (!selected) {
                      onSelect(kind);
                    }
                  }}
                  className={cn(
                    "flex h-9 w-full items-center gap-2 rounded-control px-2.5 text-left text-meta",
                    selected ? "bg-pick font-bold text-pick-foreground" : "text-foreground hover:bg-muted",
                    "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
                  )}
                >
                  <span className={cn("w-[34px] shrink-0 text-row-label", LINE_LABEL_CLASS[kind])}>{LINE_KIND_LABEL[kind]}</span>
                  <span className="flex-1" />
                  {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden /> : null}
                </button>
                {locked ? <p className="px-2.5 pb-1.5 text-caption text-fg-caption">{TASK_KIND_LOCKED_CAPTION}</p> : null}
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
