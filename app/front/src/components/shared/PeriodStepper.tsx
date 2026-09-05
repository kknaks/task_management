"use client";

/**
 * **기간 스테퍼 — 「‹ 2026년 8월 ›」 + 「오늘」**(SPEC-004 U-12).
 *
 * > 항상 노출한다([10] 「스코프 표시 필수」).
 *
 * 지금 무엇을 보고 있는지가 화면에서 사라지면, 빈 목록이 「업무가 없다」인지
 * 「다른 달을 보고 있다」인지 구분되지 않는다.
 *
 * 두 영역 이상이 쓴다 — 회의록 목록이 이걸 재사용한다(WP Code Surface).
 */

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

export function PeriodStepper({
  label,
  onPrev,
  onNext,
  onToday,
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  /** 「오늘」 — 이번 달로 돌아온다. */
  onToday: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button type="button" variant="ghost" size="icon" aria-label="이전 달" onClick={onPrev}>
        <ChevronLeft aria-hidden />
      </Button>
      <span className="w-28 text-center text-section text-foreground">{label}</span>
      <Button type="button" variant="ghost" size="icon" aria-label="다음 달" onClick={onNext}>
        <ChevronRight aria-hidden />
      </Button>
      <Button type="button" variant="ghost" size="sm" className="text-meta" onClick={onToday}>
        오늘
      </Button>
    </div>
  );
}
