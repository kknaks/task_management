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
    <div role="tablist" aria-label={ariaLabel} className="flex items-center gap-1 overflow-x-auto">
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
              "shrink-0 border-b-2 px-3 pb-2 pt-1 text-meta transition-colors",
              // **선택 밑줄이 Ink** — 이 화면에서 Ink 를 쓰는 유일한 자리다
              selected
                ? "border-ink font-bold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label} {tab.count}
          </button>
        );
      })}
    </div>
  );
}
