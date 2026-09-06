"use client";

/**
 * **업무 상세의 블록 카드 — 규칙이 하나다**(REDRAW-03 §2-2).
 *
 * 시안 `업무 화면 정의서.dc.html` 1928~2018(드로어) · 1574~1750(확장)에서 **모든 블록이
 * 같은 껍데기**를 쓴다. 전에는 블록마다 `p-4` 에 제목 15/700 이라 시안과 어긋났다.
 *
 * | 자리 | 드로어 | 확장 |
 * |---|---|---|
 * | 카드 | border `#EBEBEB` · **r12** · `overflow:hidden` | 같음 |
 * | 헤더 | **h42** · `padding 0 16` | **h48** · `padding 0 18`(좌 1080 은 h52 · `0 20`) |
 * | 제목 | **13/700** | **14/700** |
 * | 우측 보조 | 12px `#9EA2AE` | 같음 |
 *
 * 헤더 아래 `border-bottom 1px #EBEBEB`. **본문 패딩은 블록마다 다르므로 여기서 주지 않는다** —
 * 항목 행이 카드 좌우에 꽉 차야 구분선이 끝까지 그어진다(시안 1953줄).
 */

import { cn } from "@/lib/utils";

export type BlockSize = "drawer" | "page";

const SIZE = {
  /** 드로어 — 헤더 h42 · `padding 0 16` · 제목 13/700 (폭은 `DrawerFrame` 이 갖는다) */
  drawer: { header: "h-[42px] px-4", title: "text-meta font-bold" },
  /** 확장 페이지 — 헤더 h48 · `padding 0 18` · 제목 14/700 */
  page: { header: "h-12 px-[18px]", title: "text-control-label font-bold" },
} as const;

export function DetailBlock({
  title,
  /** 헤더 우측 보조 — 개수(`2`) · 「완료 시 필수」 · 「1 · 최신순」 · 「자동 기록」. */
  hint,
  /** 헤더에 붙는 컨트롤(할일 진행률 바처럼 **제목 바로 옆**에 오는 것). */
  lead,
  size = "drawer",
  className,
  children,
}: {
  title: string;
  hint?: React.ReactNode;
  lead?: React.ReactNode;
  size?: BlockSize;
  className?: string;
  children: React.ReactNode;
}) {
  const spec = SIZE[size];
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-xl border border-divider bg-card",
        className,
      )}
    >
      <header
        className={cn("flex shrink-0 items-center gap-3 border-b border-divider", spec.header)}
      >
        <h3 className={cn("shrink-0 text-foreground", spec.title)}>{title}</h3>
        {/* `lead` 는 제목에 **붙어** 온다(할일 `2 / 5` + 진행률 바 — 시안 1932줄) */}
        {lead}
        {/* `hint` 는 우측 끝. 둘이 함께 오면 `lead` 가 남은 폭을 먹는다 */}
        {hint === undefined ? null : (
          <span className="ml-auto shrink-0 text-caption text-fg-caption">{hint}</span>
        )}
      </header>
      {children}
    </section>
  );
}

/**
 * 블록 안의 **항목 행** — 카드 좌우에 꽉 차고 아래에 `#F1F2F5` 구분선을 둔다.
 * **마지막 행은 구분선이 없다**(시안: 추가 행이 마지막이라 선이 안 그어진다).
 */
export function BlockRow({
  size = "drawer",
  muted = false,
  last = false,
  className,
  children,
  ...props
}: {
  size?: BlockSize;
  /** 입력·추가 행 — 배경 `#FAFBFC`. */
  muted?: boolean;
  last?: boolean;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn(
        "flex shrink-0 items-center text-meta",
        // 드로어 h44 · 확장 h52(`h-row`) — 시안 1953·1666줄
        size === "drawer" ? "h-todo gap-[9px] px-4" : "h-row gap-2.5 px-[18px]",
        last ? "" : "border-b border-row-divider",
        muted && "bg-row-hover",
        className,
      )}
    >
      {children}
    </div>
  );
}
