"use client";

/**
 * **일시 3칸**(SPEC-006 U-3 · 회의록.dc.html L473~481) — 날짜 200 + 시작 130 「–」 종료 130, 전부 44px 셀렉터.
 *
 * - 날짜는 **`components/shared/Calendar` 한 벌**(기간 스테퍼·업무 일정과 같은 그리드)
 * - 시각 목록은 **30분 간격 + 「직접 입력」**([07] Selector)
 * - **종료 ≤ 시작이면** 종료 칸 실패 테두리 + 「종료 시각은 시작보다 뒤여야 합니다」 · 5~300분 밖이면 안내(§4)
 * - `saveFailed` 는 `schedule_overlap` 의 **일시 필드 실패 테두리**(Case Matrix)
 *
 * 값은 KST 날짜·시각이고 UTC 변환은 `lib/datetime` 이 한다 — 여기서 시계를 직접 읽지 않는다.
 */

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { CalendarGrid } from "@/components/shared/Calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DURATION_MESSAGE, END_BEFORE_START_MESSAGE } from "@/features/meetings/errors";
import { isEnterSubmit } from "@/lib/keyboard";
import {
  HALF_HOUR_TIMES,
  formatMeetingDate,
  isTimeKey,
  minutesBetweenTimes,
  type DateKey,
  type TimeKey,
} from "@/lib/datetime";
import { cn } from "@/lib/utils";

export interface MeetingSlot {
  date: DateKey;
  start: TimeKey;
  end: TimeKey;
}

/** 회의 길이 하한·상한(§4 Validation — 300 은 M-18, 5 는 spec). */
export const MIN_MINUTES = 5;
export const MAX_MINUTES = 300;

/** 화면이 먼저 잡는 안내. `null` 이면 보낼 수 있다. */
export function slotError(slot: MeetingSlot): string | null {
  const minutes = minutesBetweenTimes(slot.start, slot.end);
  if (minutes <= 0) {
    return END_BEFORE_START_MESSAGE;
  }
  if (minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
    return DURATION_MESSAGE;
  }
  return null;
}

const BOX =
  "flex h-11 items-center justify-between gap-2 rounded-control border bg-card px-3.5 text-control-label text-foreground";

function boxClass(invalid: boolean, open: boolean): string {
  return cn(
    BOX,
    invalid ? "border-destructive" : open ? "border-primary shadow-focus" : "border-border hover:bg-muted",
  );
}

function DateBox({
  value,
  invalid,
  onChange,
}: {
  value: DateKey;
  invalid: boolean;
  onChange: (next: DateKey) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="날짜" className={cn(boxClass(invalid, open), "w-[200px]")}>
          {formatMeetingDate(value)}
          <ChevronDown className="h-[7px] w-[11px] shrink-0 text-fg-meta" strokeWidth={1.6} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-80 rounded-card border-border bg-card p-3 shadow-popover">
        <CalendarGrid
          anchorMonth={value}
          isSelected={(day) => day === value}
          onSelect={(day) => {
            setOpen(false);
            onChange(day);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function TimeBox({
  value,
  label,
  invalid,
  onChange,
}: {
  value: TimeKey;
  label: string;
  invalid: boolean;
  onChange: (next: TimeKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");

  const submitCustom = () => {
    const next = custom.trim();
    if (isTimeKey(next)) {
      onChange(next);
      setCustom("");
      setOpen(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setCustom("");
        }
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} className={cn(boxClass(invalid, open), "w-[130px]")}>
          {value}
          <ChevronDown className="h-[7px] w-[11px] shrink-0 text-fg-meta" strokeWidth={1.6} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-[200px] rounded-card border-border bg-card p-1 shadow-popover">
        <ul role="listbox" aria-label={label} className="max-h-56 overflow-y-auto">
          {HALF_HOUR_TIMES.map((time) => {
            const selected = time === value;
            return (
              <li key={time}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(time);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex h-9 w-full items-center rounded-control px-3 text-left text-meta tabular-nums",
                    selected ? "bg-pick font-bold text-pick-foreground" : "text-foreground hover:bg-muted",
                  )}
                >
                  {time}
                </button>
              </li>
            );
          })}
        </ul>
        {/* 「직접 입력」 — 30분 경계 밖의 시각([07] Selector) */}
        <div className="mt-1 flex items-center gap-1.5 border-t border-divider p-1 pt-2">
          <input
            type="text"
            aria-label={`${label} 직접 입력`}
            placeholder="직접 입력 09:15"
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            onKeyDown={(event) => {
              if (isEnterSubmit(event)) {
                event.preventDefault();
                submitCustom();
              }
            }}
            className="h-8 min-w-0 flex-1 rounded-control border border-border px-2 text-meta focus-visible:border-primary focus-visible:outline-none"
          />
          <button
            type="button"
            onClick={submitCustom}
            disabled={!isTimeKey(custom.trim())}
            className="h-8 shrink-0 rounded-control bg-secondary px-2.5 text-caption font-semibold text-secondary-foreground disabled:opacity-50"
          >
            적용
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function MeetingDateTimeField({
  value,
  onChange,
  saveFailed = false,
}: {
  value: MeetingSlot;
  onChange: (next: MeetingSlot) => void;
  /** `schedule_overlap` — 일시 필드 실패 테두리(Case Matrix). */
  saveFailed?: boolean;
}) {
  const error = slotError(value);
  const endInvalid = error !== null;

  return (
    <div className="flex flex-col gap-1.5" data-save-failed={saveFailed || undefined}>
      <div className="flex flex-wrap items-center gap-2.5">
        <DateBox value={value.date} invalid={saveFailed} onChange={(date) => onChange({ ...value, date })} />
        <TimeBox
          value={value.start}
          label="시작 시각"
          invalid={saveFailed}
          onChange={(start) => onChange({ ...value, start })}
        />
        <span className="text-meta text-fg-caption">–</span>
        <TimeBox
          value={value.end}
          label="종료 시각"
          invalid={saveFailed || endInvalid}
          onChange={(end) => onChange({ ...value, end })}
        />
      </div>
      {error ? (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
