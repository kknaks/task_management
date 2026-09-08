"use client";

/**
 * **날짜 한 칸 — 기한 셀렉터**(SPEC-008 U-9 「기한 날짜 셀렉터(44px)」 · U-10 「기한 날짜 셀렉터」).
 *
 * 업무의 `DueDateField` 는 **두 칸**(계획 시작 – 종료)이고 여기는 **계획 종료 하나**뿐이라 칸 하나를 둔다 — 달력은
 * `components/shared/Calendar` **한 벌**을 그대로 쓴다(두 벌 금지 · 브라우저 기본 `<input type="date">` 를 쓰지 않는다 — 같은 이유).
 * 표시는 `MM.DD` · 비우면 「변경 없음」(U-9) / 「미정」(U-10) 이고, 캡션(「현재 MM.DD」 등)은 호출자가 아래에 적는다.
 */

import { useState } from "react";

import { CalendarGrid } from "@/components/shared/Calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { currentDate, formatDueDate, type DateKey } from "@/lib/datetime";
import { cn } from "@/lib/utils";

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden className="shrink-0">
      <rect x="2.5" y="3.5" width="11" height="10" rx="2" />
      <path d="M2.5 6.5h11M5.5 2.5v2M10.5 2.5v2" />
    </svg>
  );
}

export function TaskDateField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  invalid = false,
  disabled = false,
}: {
  value: DateKey | null;
  onChange: (next: DateKey | null) => void;
  placeholder: string;
  ariaLabel: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          aria-invalid={invalid}
          disabled={disabled}
          className={cn(
            "flex h-11 w-full items-center gap-2 rounded-control border bg-card px-3.5 text-control-label",
            value === null ? "text-fg-caption" : "text-foreground",
            invalid ? "border-destructive" : open ? "border-primary shadow-focus" : "border-border hover:bg-muted",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          <span className="text-fg-meta">
            <CalendarIcon />
          </span>
          {value === null ? placeholder : formatDueDate(value)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-80 rounded-card border-border bg-card p-3 shadow-popover">
        <div className="flex flex-col gap-2">
          <CalendarGrid
            anchorMonth={value ?? currentDate()}
            isSelected={(day) => day === value}
            onSelect={(day) => {
              setOpen(false);
              onChange(day);
            }}
          />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onChange(null);
            }}
            className="flex h-8 items-center justify-center rounded-control border border-border text-caption text-fg-meta hover:bg-muted hover:text-foreground"
          >
            비우기
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
