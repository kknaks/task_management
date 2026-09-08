"use client";

/**
 * **달력 한 벌**(REDRAW-05 F-1 ③ · REDRAW-02 E-3).
 *
 * 두 곳이 쓴다 — 기간 스테퍼의 **범위 선택**(`PeriodStepper`)과 업무 일정의 **날짜 하나**
 * 선택(`DueDateField`). **두 벌을 만들지 않는다** — 월 그리드는 여기 하나이고,
 * 「무엇을 고르는가」만 호출부가 정한다.
 *
 * 시안에 달력 UI 자체가 없다(`design-requests.md` §B-2 미설계). **디자인 시스템 [07] Popover
 * 규격 안에서만** 만든다 — 폭 200~400 · 스크림 없음 · 트리거 아래 8px · 공간 없으면 위로.
 * 「현재 값」은 선택 칩(`--tm-select-bg`)이 아니라 **`--tm-current-bg`** 축이다([02]).
 */

import { useState } from "react";

import { currentDate, monthOf, shiftDate, weekOf, formatPeriod, type DateKey } from "@/lib/datetime";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"] as const;

/** 30×30 테두리 버튼 — 달 이동 `‹`·`›`. 기간 스테퍼의 스테퍼 버튼과 같은 규격이다. */
export const STEP_CLASS =
  "flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-control border border-border bg-card text-fg-meta hover:bg-muted";

export function Chevron({ direction }: { direction: "prev" | "next" }) {
  return (
    <svg
      width="7"
      height="11"
      viewBox="0 0 8 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={direction === "prev" ? "M5.5 1.5 1.5 6l4 4.5" : "M2.5 1.5 6.5 6l-4 4.5"} />
    </svg>
  );
}

/**
 * 월 그리드. **무엇이 선택으로 보이는지는 `isSelected` 가 정한다** — 범위든 하루든
 * 이 컴포넌트는 모른다. 그래서 한 벌로 두 쓰임을 덮는다.
 */
export function CalendarGrid({
  anchorMonth,
  isSelected,
  isEdge,
  onSelect,
}: {
  /** 처음 펼칠 달. 사용자가 `‹`·`›` 로 옮기면 그 뒤로는 내부 상태가 든다. */
  anchorMonth: DateKey;
  isSelected: (day: DateKey) => boolean;
  /**
   * 범위의 **시작·끝**인가 — 있으면 그 둘만 진한 채움이고 **사이는 옅은 배경**이다
   * (REDRAW-03 §4). 안 주면 선택 전부가 끝점이라 기존 호출부의 모양이 그대로다.
   */
  isEdge?: (day: DateKey) => boolean;
  onSelect: (day: DateKey) => void;
}) {
  const [cursor, setCursor] = useState<DateKey>(anchorMonth);
  const month = monthOf(cursor);
  const monthStart = month.from;
  // 6주 × 7일이면 어떤 달이든 덮는다. 첫 칸은 그 달 1일이 속한 주의 월요일이다.
  const days = Array.from({ length: 42 }, (_, i) => shiftDate(weekOf(monthStart).from, i));
  const today = currentDate();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="이전 달"
          onClick={() => setCursor(shiftDate(monthStart, -1))}
          className={STEP_CLASS}
        >
          <Chevron direction="prev" />
        </button>
        <span className="text-control-label font-semibold text-foreground">
          {formatPeriod(month)}
        </span>
        <button
          type="button"
          aria-label="다음 달"
          onClick={() => setCursor(shiftDate(month.to, 1))}
          className={STEP_CLASS}
        >
          <Chevron direction="next" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-y-1">
        {WEEKDAYS.map((day) => (
          <span key={day} className="text-center text-caption text-fg-caption">
            {day}
          </span>
        ))}
        {days.map((day) => {
          const outside = day < monthStart || day > month.to;
          const selected = isSelected(day);
          const edge = selected && (isEdge?.(day) ?? true);
          return (
            <button
              key={day}
              type="button"
              onClick={() => onSelect(day)}
              aria-current={day === today ? "date" : undefined}
              className={cn(
                "flex h-8 items-center justify-center rounded-chip text-caption",
                outside ? "text-fg-placeholder" : "text-foreground",
                // 끝점은 **진한 채움**, 사이는 **옅은 배경**(§4)
                edge
                  ? "bg-primary font-bold text-primary-foreground"
                  : selected
                    ? "bg-pick text-pick-foreground"
                    : "hover:bg-muted",
                day === today && !selected && "font-bold text-primary",
              )}
            >
              {Number(day.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 달력 하단 바로가기 — 「오늘」·「이번 주」·「이번 달」. */
export function Shortcut({ label, onSelect }: { label: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex h-8 flex-1 items-center justify-center rounded-control border border-border text-caption text-fg-meta hover:bg-muted hover:text-foreground"
    >
      {label}
    </button>
  );
}
