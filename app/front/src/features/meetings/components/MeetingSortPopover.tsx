"use client";

/**
 * **정렬 팝오버**(SPEC-006 U-2 · 회의록.dc.html L74) — 「최신순」(기본) · 「오래된순」.
 * 고르면 **즉시 반영**, 「적용」 버튼 없음([10]). 값은 `?sort=` 에 남으므로 열림 여부만 든다.
 * 트리거는 헤더 우측 텍스트 「최신순 ▾」 12/`#757575`.
 */

import { forwardRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { MeetingSort } from "@/features/meetings/types";
import { cn } from "@/lib/utils";

export const SORT_LABEL: Record<MeetingSort, string> = {
  latest: "최신순",
  oldest: "오래된순",
};

const Trigger = forwardRef<HTMLButtonElement, { label: string } & React.ButtonHTMLAttributes<HTMLButtonElement>>(
  function Trigger({ label, ...props }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        {...props}
        className="flex items-center gap-[7px] text-caption text-fg-meta hover:text-foreground"
      >
        {label}
        <ChevronDown className="h-[6px] w-[10px]" strokeWidth={1.6} aria-hidden />
      </button>
    );
  },
);

export function MeetingSortPopover({
  value,
  onChange,
}: {
  value: MeetingSort;
  onChange: (next: MeetingSort) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Trigger label={SORT_LABEL[value]} aria-label="정렬" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-popover-menu rounded-card border-border bg-card p-1 shadow-popover"
      >
        {(Object.keys(SORT_LABEL) as MeetingSort[]).map((sort) => {
          const selected = sort === value;
          return (
            <button
              key={sort}
              type="button"
              onClick={() => {
                setOpen(false);
                onChange(sort);
              }}
              className={cn(
                "flex h-9 w-full items-center gap-2 rounded-control px-3 text-left text-meta",
                selected ? "bg-pick font-bold text-pick-foreground" : "text-foreground hover:bg-muted",
              )}
            >
              <span className="flex-1">{SORT_LABEL[sort]}</span>
              {selected ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
