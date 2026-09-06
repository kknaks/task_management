"use client";

/**
 * **일정 — 계획 시작 – 계획 종료 두 칸**(SPEC-003 U-1 · REDRAW-05 F-1 ②③).
 *
 * 일정이 `due_date` 하나에서 **4필드로 돌아왔다**(A-4 번복 · DEC-002). 그중 화면이 **입력하는
 * 것은 둘**이고 실적 3개(`startedAt`·`completedAt`·`cancelledAt`)는 읽기 전용이라 여기 없다.
 *
 * ## 시안(`업무 화면 정의서.dc.html` 585~596줄)
 *
 * 각 칸 **h38 · r8 · border `#D9D9D9` · padding 0 10 · 13/600 · 좌측 달력 아이콘 14px** ·
 * 아이콘↔글자 `gap 8`, 두 칸 사이에 **`–` 13px `#9EA2AE`**, 칸 사이 `gap 8`.
 *
 * ## 브라우저 기본 `<input type="date">` 를 쓰지 않는다
 *
 * 네이티브는 「연도. 월. 일.」과 자체 달력 아이콘을 그려 **시안의 모양이 아니다.**
 * 표시는 `MM.DD` 이고 고르기는 팝오버다 — 달력은 `components/shared/Calendar` **한 벌**을
 * 기간 스테퍼와 함께 쓴다(두 벌 금지).
 *
 * ## 시각 입력이 없다
 *
 * 「시간 지정」 토글과 `dueStartTime`·`dueEndTime` 은 **제거됐다**(DEC-002 §「업무의 시간 지정
 * 제거」 · 계약 리비전 0004 — 보내면 422). **업무는 날짜 단위**이고, 시각을 갖는 것은 회의다
 * (`meeting.start_at`·`end_at`).
 *
 * **`startDate > dueDate` 는 저장하지 않고 그 자리에서 막는다** — 서버도 422 로 막지만
 * 화면이 먼저 잡아야 왕복 없이 고칠 수 있다.
 */

import { useState } from "react";

import { CalendarGrid } from "@/components/shared/Calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { currentDate, formatDueDate, type DateKey } from "@/lib/datetime";
import { cn } from "@/lib/utils";

export interface DueValue {
  startDate: string | null;
  dueDate: string | null;
}

/** 시작이 종료보다 뒤면 안 된다(§4 Validation · 서버도 422). */
export const SCHEDULE_ERROR = "시작일이 종료일보다 뒤일 수 없습니다";

export function isScheduleValid({ startDate, dueDate }: DueValue): boolean {
  return !(startDate && dueDate) || startDate <= dueDate;
}

function CalendarIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden
      className="shrink-0"
    >
      <rect x="2.5" y="3.5" width="11" height="10" rx="2" />
      <path d="M2.5 6.5h11M5.5 2.5v2M10.5 2.5v2" />
    </svg>
  );
}

/** 날짜 한 칸 — 닫힌 모양은 시안 그대로이고 열렸을 때만 「고르는 중」 표시를 얹는다([07]). */
function DateBox({
  value,
  placeholder,
  ariaLabel,
  invalid,
  disabled,
  onChange,
}: {
  value: string | null;
  placeholder: string;
  ariaLabel: string;
  invalid: boolean;
  disabled: boolean;
  onChange: (next: DateKey | null) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            "flex h-[38px] flex-1 items-center gap-2 rounded-control border bg-card px-2.5 text-meta font-semibold",
            value === null ? "text-fg-caption" : "text-foreground",
            invalid
              ? "border-destructive"
              : open
                ? "border-primary shadow-focus"
                : "border-border hover:bg-muted",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          <span className="text-fg-meta">
            <CalendarIcon />
          </span>
          {value === null ? placeholder : formatDueDate(value)}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-80 rounded-card border-border bg-card p-3 shadow-popover"
      >
        <div className="flex flex-col gap-2">
          <CalendarGrid
            anchorMonth={value ?? currentDate()}
            isSelected={(day) => day === value}
            onSelect={(day) => {
              setOpen(false);
              onChange(day);
            }}
          />
          {/* **비울 수 있어야 한다** — 둘 다 선택 입력이고 비우면 「미정」이다(F-3) */}
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

export function DueDateField({
  value,
  onChange,
  saveFailed = false,
  disabled = false,
}: {
  value: DueValue;
  onChange: (next: DueValue) => void;
  saveFailed?: boolean;
  disabled?: boolean;
}) {
  const invalid = !isScheduleValid(value);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2" data-save-failed={saveFailed || undefined}>
        <DateBox
          value={value.startDate}
          placeholder="계획 시작"
          ariaLabel="계획 시작일"
          invalid={invalid || saveFailed}
          disabled={disabled}
          onChange={(next) => onChange({ ...value, startDate: next })}
        />
        <span className="shrink-0 text-meta text-fg-caption">–</span>
        <DateBox
          value={value.dueDate}
          placeholder="계획 종료"
          ariaLabel="계획 종료일"
          invalid={invalid || saveFailed}
          disabled={disabled}
          onChange={(next) => onChange({ ...value, dueDate: next })}
        />
      </div>

      {/* 저장 전에 화면이 먼저 잡는다 — 서버 왕복 없이 그 자리에서 고칠 수 있다 */}
      {invalid ? (
        <p role="alert" className="text-caption text-destructive">
          {SCHEDULE_ERROR}
        </p>
      ) : null}
    </div>
  );
}
