"use client";

/**
 * **S-01 앱 셸** — 사이드바 + 본문(SPEC-001 U-3 · frontend/README.md §7-1).
 *
 * 반응형 두 구간(1280 미만은 `MinWidthGuard` 가 덮는다).
 * - **≥1440** — 사이드바 200 고정, 본문 좌우 여백 `gutter`(1440 에서 80 → 1920 에서 40)
 * - **1280~1439** — 사이드바 **숨김 + 좌상단 햄버거 오버레이**(P-03), 여백 48
 *
 * 여백 값은 `--tm-gutter` 하나가 정본이다 — 구간 전환은 그 변수가 한다(§7-1 · 검수 W-2).
 * `position:absolute` 로 배치하지 않는다(FE-C4).
 */

import { Fragment, useState } from "react";
import { ChevronRight, Menu, X } from "lucide-react";

import { usePathname } from "next/navigation";

import { Sidebar } from "@/components/shared/Sidebar";
import type { AccountSummary } from "@/types/api";

/**
 * **breadcrumb 한 줄**(시안 `업무 화면 정의서.dc.html` 47~51줄) — `left 240 / top 38`.
 *
 * 13px `#9EA2AE` · 현재 항목만 `#757575` · chevron 11px `#B3B3B3` · `gap 7`.
 * **셸이 자리를 갖고 화면이 채운다** — 화면마다 다시 그리면 위치가 갈린다.
 */
export function Breadcrumb({ trail }: { trail: readonly string[] }) {
  return (
    <nav aria-label="현재 위치" className="flex items-center gap-[7px] text-meta text-fg-caption">
      {trail.map((label, index) => (
        <Fragment key={label}>
          {index > 0 ? (
            <ChevronRight
              aria-hidden
              strokeWidth={1.5}
              className="h-[11px] w-[11px] text-fg-placeholder"
            />
          ) : null}
          {/* 마지막이 「지금 여기」다 — 한 단계 진한 회색으로만 구분한다 */}
          <span className={index === trail.length - 1 ? "text-fg-meta" : undefined}>{label}</span>
        </Fragment>
      ))}
    </nav>
  );
}

/**
 * 경로별 breadcrumb.
 *
 * **여기 없는 화면은 줄이 통째로 빠진다** — 빈 줄을 남기면 세로 리듬만 흐트러지고
 * 알려 주는 것이 없다. REDRAW-02 는 `/tasks` 하나만 채운다(나머지는 다음 work).
 */
const TRAIL: Readonly<Record<string, readonly string[]>> = {
  "/tasks/": ["홈", "내 업무"],
};

export function AppShell({
  account,
  breadcrumb,
  children,
}: {
  account?: AccountSummary;
  /**
   * breadcrumb 슬롯. **셸이 자리를 갖고 화면이 채운다** — 화면마다 다시 그리면 위치가 갈린다.
   * 넘기지 않으면 위 `TRAIL` 이 경로로 찾고, 그것도 없으면 줄이 빠진다.
   */
  breadcrumb?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const trail = TRAIL[pathname];
  const crumb = breadcrumb ?? (trail === undefined ? null : <Breadcrumb trail={trail} />);

  return (
    <div className="flex min-h-screen w-full">
      {/* ≥1440 — 200 고정 */}
      <div className="hidden wide:block">
        <Sidebar account={account} />
      </div>

      {/* 1280~1439 — 햄버거로 여는 오버레이. 사이드바 자체는 같은 컴포넌트를 쓴다 */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-40 flex wide:hidden">
          <div
            className="absolute inset-0 bg-scrim-drawer"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <div className="relative h-full">
            <Sidebar account={account} onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-h-screen flex-1 flex-col">
        <div className="flex items-center gap-3 px-gutter pt-6 wide:hidden">
          <button
            type="button"
            aria-label={drawerOpen ? "메뉴 닫기" : "메뉴 열기"}
            onClick={() => setDrawerOpen((open) => !open)}
            className="flex h-control w-control items-center justify-center rounded-control border border-border bg-card text-foreground"
          >
            {drawerOpen ? <X aria-hidden /> : <Menu aria-hidden />}
          </button>
        </div>

        {/**
         * 세로 리듬은 시안 좌표다 — breadcrumb `top 38` · 타이틀 `top 66`.
         * breadcrumb 줄(13px, lh 1.5 ≈ 20)이 38 에서 시작해 58 에서 끝나고 타이틀까지 8 이
         * 남는다. `absolute` 로 박지 않고 위 여백 + 묶음 간격으로 같은 자리에 수렴시킨다.
         *
         * 좌우는 `--tm-gutter` 하나가 정본이다 — **사이드바 다음** 여백이고 값은
         * 1920 에서 40 · 1440 에서 80 · 1280 에서 48 이다(`tokens.css` 실측 표).
         */}
        <main className="flex flex-1 flex-col px-gutter pb-12 pt-[38px]">
          {crumb === null ? null : <div className="mb-2">{crumb}</div>}
          {children}
        </main>
      </div>
    </div>
  );
}
