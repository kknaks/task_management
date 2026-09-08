"use client";

/**
 * **기간 스테퍼 — 「‹ 2026년 8월 ›」**(SPEC-004 U-12 · REDRAW-02 #15·E-3).
 *
 * > 항상 노출한다([10] 「스코프 표시 필수」).
 *
 * 지금 무엇을 보고 있는지가 화면에서 사라지면, 빈 목록이 「업무가 없다」인지
 * 「다른 기간을 보고 있다」인지 구분되지 않는다.
 *
 * ## 규격 — 시안 `업무 화면 정의서.dc.html` 57~59줄
 *
 * **세 요소가 각자 테두리를 가진 개별 버튼**이다. 하나로 이어붙인 세그먼트가 아니다.
 * - `‹`·`›` — 30×30 · r8 · border `#D9D9D9` · 흰 배경 · 글리프 7×11 `#757575` · hover `#F5F6F8`
 * - 라벨 — h30 · r8 · border `#D9D9D9` · 흰 배경 · padding 0 12 · 14/600 · `#1E1E1E`
 * - 셋 사이 `gap 6`
 *
 * ## 라벨을 누르면 기간을 고른다(E-3)
 *
 * `‹`·`›` 는 **기간 이동**이다 — 달 경계면 달 단위, 아니면 고른 범위와 같은 길이만큼
 * (`shiftPeriod` 가 가른다). **기본 진입이 오늘 하루라 기본은 하루씩** 움직인다.
 * 라벨은 달력 팝오버를 열어 **시작일–종료일**을 받는다.
 *
 * **닫힌 상태의 모양은 위 그대로**다. 열렸을 때만 Selector 규격(테두리 `--tm-primary` +
 * 포커스 글로우)을 얹는다.
 *
 * 두 영역 이상이 쓴다 — 회의록 목록이 이걸 재사용한다(WP Code Surface).
 */

import { useState } from "react";

import { CalendarGrid, Chevron, Shortcut, STEP_CLASS } from "@/components/shared/Calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  currentDate,
  formatPeriod,
  monthOf,
  weekOf,
  type DateKey,
  type Period,
} from "@/lib/datetime";
import { cn } from "@/lib/utils";

export function PeriodStepper({
  period,
  onPrev,
  onNext,
  onPick,
}: {
  period: Period;
  onPrev: () => void;
  onNext: () => void;
  /** 달력에서 고른 기간. 「이번 달」·「이번 주」 바로가기도 이걸로 돌아온다. */
  onPick: (next: Period) => void;
}) {
  const [open, setOpen] = useState(false);

  const pick = (next: Period) => {
    setOpen(false);
    onPick(next);
  };

  return (
    <div className="flex items-center gap-1.5">
      <button type="button" className={STEP_CLASS} aria-label="이전 기간" onClick={onPrev}>
        <Chevron direction="prev" />
      </button>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="기간 고르기"
            className={cn(
              "flex h-[30px] items-center rounded-control border bg-card px-3 text-control-label font-semibold text-foreground",
              // **닫힌 모양은 시안 그대로.** 열렸을 때만 「고르는 중」 표시를 얹는다([07])
              open ? "border-primary shadow-focus" : "border-border hover:bg-muted",
            )}
          >
            {formatPeriod(period)}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={8}
          className="w-80 rounded-card border-border bg-card p-3 shadow-popover"
        >
          <RangeCalendar period={period} onPick={pick} />
        </PopoverContent>
      </Popover>

      <button type="button" className={STEP_CLASS} aria-label="다음 기간" onClick={onNext}>
        <Chevron direction="next" />
      </button>
    </div>
  );
}

/**
 * **범위 달력** — 월 그리드는 `components/shared/Calendar` 하나를 쓴다(두 벌 금지).
 * 여기서 정하는 것은 「두 번 눌러 범위가 된다」는 규칙뿐이다.
 *
 * 첫 클릭이 시작, 두 번째가 끝. 끝을 시작보다 앞에 찍으면 뒤집어 받는다.
 */
function RangeCalendar({ period, onPick }: { period: Period; onPick: (next: Period) => void }) {
  /** 첫 클릭만 한 상태 — `null` 이면 다음 클릭이 시작일이다. */
  const [anchor, setAnchor] = useState<DateKey | null>(null);
  const today = currentDate();

  return (
    <div className="flex flex-col gap-2">
      <CalendarGrid
        anchorMonth={period.from}
        isSelected={(day) =>
          anchor === null ? day >= period.from && day <= period.to : day === anchor
        }
        onSelect={(day) => {
          if (anchor === null) {
            setAnchor(day);
            return;
          }
          setAnchor(null);
          onPick(anchor <= day ? { from: anchor, to: day } : { from: day, to: anchor });
        }}
      />

      {/* 바로가기 — 「오늘」이 맨 앞이다. 기본 진입이 오늘 하루이기 때문이다 */}
      <div className="flex items-center gap-1.5 border-t border-divider pt-2">
        <Shortcut label="오늘" onSelect={() => onPick({ from: today, to: today })} />
        <Shortcut label="이번 주" onSelect={() => onPick(weekOf(today))} />
        <Shortcut label="이번 달" onSelect={() => onPick(monthOf(today))} />
      </div>
    </div>
  );
}
