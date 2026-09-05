"use client";

/**
 * **S-01 앱 셸** — 사이드바 + 본문(SPEC-001 U-3 · frontend/README.md §7-1).
 *
 * 반응형 두 구간(1280 미만은 `MinWidthGuard` 가 덮는다).
 * - **≥1440** — 사이드바 200 고정, 본문 좌우 여백 `gutter`(80→240 보간)
 * - **1280~1439** — 사이드바 **숨김 + 좌상단 햄버거 오버레이**(P-03), 여백 48
 *
 * 여백 값은 `--tm-gutter` 하나가 정본이다 — 구간 전환은 그 변수가 한다(§7-1 · 검수 W-2).
 * `position:absolute` 로 배치하지 않는다(FE-C4).
 */

import { useState } from "react";
import { Menu, X } from "lucide-react";

import { Sidebar } from "@/components/shared/Sidebar";
import type { AccountSummary } from "@/types/api";

export function AppShell({
  account,
  children,
}: {
  account?: AccountSummary;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

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

        <main className="flex-1 px-gutter py-8">{children}</main>
      </div>
    </div>
  );
}
