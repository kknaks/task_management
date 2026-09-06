"use client";

/**
 * **패널 탭 — dot 붙는 밑줄 탭**(디자인 시스템 [09] MEETING NOTE 「탭 dot」 · 회의록.dc.html L137~140 · L596~599 · L633~636).
 *
 * 패널(r16 카드) **안쪽 상단**의 탭이다. `UnderlineTabs`(S-13, 화면 본문의 유형 탭 — h42 · 15px ·
 * 색칩 + 수)와 **같은 축(위치)** 이지만 규격이 다르다 — h44/48 · 13/14px · 7px 원 dot ·
 * 선택은 `border-bottom 2px Ink` + 700. 회의록 미리보기 패널 · 시작 전 좌/우 패널이 쓰고
 * SPEC-007·008 의 회의 중·종료 후 패널이 **같은 것을 쓴다**(dot 색만 prop 으로 갈린다).
 *
 * Ink 는 「위치」 축이다(FE §5-2). 패널 안의 탭도 「지금 어느 면을 보고 있나」라 같은 축이고,
 * 시안 [09] 가 좌·우 패널 둘 다 Ink 밑줄로 그렸다 — 그래서 여기서 `border-ink` 를 쓴다.
 * **패널 밖에서는 쓰지 않는다** — 그건 `UnderlineTabs` 의 자리다.
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface PanelTab<K extends string> {
  key: K;
  label: ReactNode;
  /**
   * 라벨 앞 7px dot 의 **색 클래스**(`bg-dot-idle` · `bg-dot-fixed` · `bg-primary` …).
   * 없으면 dot 을 그리지 않는다 — 미리보기 패널의 「회의록 / 원문」 탭이 그렇다(시안 L138).
   */
  dotClassName?: string;
  /** 진행 중 dot 의 3px 광륜([09] L723). */
  halo?: boolean;
}

export function PanelTabs<K extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
  size = "sm",
  trailing,
  className,
}: {
  tabs: readonly PanelTab<K>[];
  value: K;
  onChange: (next: K) => void;
  ariaLabel: string;
  /** `sm` = h44 · 13px(미리보기 · 우 패널) / `md` = h48 · 14px(시작 전 좌 패널). */
  size?: "sm" | "md";
  /** 탭 줄 우측 끝 — 「추가」 텍스트 버튼(첨부 탭, 시안 L1164). */
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "flex shrink-0 items-stretch gap-4 border-b border-border px-[18px]",
        size === "md" ? "h-12 gap-5 px-6" : "h-11",
        className,
      )}
    >
      {tabs.map((tab) => {
        const selected = tab.key === value;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.key)}
            className={cn(
              "flex items-center gap-2 border-b-2 transition-colors",
              size === "md" ? "text-control-label" : "text-meta",
              // **선택 밑줄이 Ink** — 「위치」 축이다(§5-2)
              selected
                ? "border-ink font-bold text-foreground"
                : "border-transparent text-fg-caption hover:text-foreground",
            )}
          >
            {tab.dotClassName ? (
              <span
                aria-hidden
                className={cn(
                  "h-[7px] w-[7px] shrink-0 rounded-full",
                  tab.dotClassName,
                  tab.halo && "shadow-halo",
                )}
              />
            ) : null}
            {tab.label}
          </button>
        );
      })}
      {trailing ? <span className="ml-auto flex items-center">{trailing}</span> : null}
    </div>
  );
}
