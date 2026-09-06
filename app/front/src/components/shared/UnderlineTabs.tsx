"use client";

/**
 * **밑줄 탭 — 화면의 「위치」 축**(`09-design-tokens.md` [10] · FE §5-2).
 *
 * > `--tm-ink` 를 쓰는 컴포넌트는 셋뿐이다 … **화면당 Ink 는 하나**다.
 *
 * 내 업무 화면에서는 **유형 탭이 그 하나**다 — 같은 화면의 뷰 토글은 Ink 를 쓰지 않고
 * 「현재 값」 배경으로 그린다(SPEC-004 §2 · S004-OQ-2).
 *
 * 두 영역 이상이 쓴다 — 회의록 목록도 같은 축을 갖는다(WP Code Surface).
 */

import { cn } from "@/lib/utils";

export interface UnderlineTab {
  /** `null` 은 「전체」다 — 값이 없는 것과 값이 `null` 인 것을 구분한다. */
  id: number | null;
  label: string;
  /** 탭에 붙는 수. **0 이어도 탭을 감추지 않는다**(집계에 행이 없을 뿐이다). */
  count: number;
  /**
   * 라벨 앞 8×8 색칩의 팔레트 토큰명(시안 84~87줄).
   *
   * **시안의 고정 4색을 하드코딩하지 않는다** — 유형 색은 사용자가 고른 런타임 값이고
   * `data-color-token` 이 CSS 에서 쌍을 고른다(§A-1 · SPEC-002 §4 · `TypeBadge` 와 같은 축).
   * 「전체」처럼 유형이 아닌 탭은 **칩이 없다** — 그래서 optional 이다.
   */
  colorToken?: string;
}

export function UnderlineTabs({
  tabs,
  value,
  onChange,
  ariaLabel,
}: {
  tabs: readonly UnderlineTab[];
  value: number | null;
  onChange: (next: number | null) => void;
  ariaLabel: string;
}) {
  return (
    /**
     * 시안 82~88줄 — 컨테이너에 `border-bottom 1px #D9D9D9`, 탭은 **h42 · 15px** ·
     * 탭 간 `gap 22` · `align-items: flex-end`(밑줄이 한 선에 맞는다).
     */
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex items-end gap-[22px] overflow-x-auto border-b border-border"
    >
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id ?? "all"}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={cn(
              "flex h-[42px] shrink-0 items-center gap-[7px] border-b-2 text-section transition-colors",
              // **선택 밑줄이 Ink** — 이 화면에서 Ink 를 쓰는 유일한 자리다
              selected
                ? "border-ink font-bold text-foreground"
                : "border-transparent font-normal text-fg-caption hover:text-foreground",
            )}
          >
            {/* 8×8 r2 색칩 — 색은 유형의 `colorToken` 이 고른다. 「전체」에는 없다 */}
            {tab.colorToken === undefined ? null : (
              <span
                aria-hidden
                data-color-token={tab.colorToken}
                className="h-2 w-2 shrink-0 rounded-[2px] bg-palette-fg"
              />
            )}
            {tab.label} {tab.count}
          </button>
        );
      })}
    </div>
  );
}
