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
import { ArrowLeft, ChevronRight, Menu, X } from "lucide-react";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Sidebar } from "@/components/shared/Sidebar";
import type { AccountSummary } from "@/types/api";

/** breadcrumb 한 칸 — `href` 가 있으면 **링크**다(마지막 칸은 무시된다 · MF-7 · FE §6-3). */
export interface Crumb {
  label: string;
  href?: string;
}

/**
 * **breadcrumb 한 줄**(시안 `업무 화면 정의서.dc.html` 47~51줄) — `left 240 / top 38`.
 *
 * 13px `#9EA2AE` · 현재 항목만 `#757575` · chevron 11px `#B3B3B3` · `gap 7`.
 * **셸이 자리를 갖고 화면이 채운다** — 화면마다 다시 그리면 위치가 갈린다.
 *
 * **앞 칸은 링크다**(MF-7 · FE §6-3) — 「홈」·「회의록」을 눌러 올라갈 수 있고 키보드 `Tab` 이 닿는다.
 * **마지막 칸은 「지금 여기」라 `href` 가 있어도 `<span>`** 이다 — 자기 자신으로 가는 링크를 두지 않는다.
 */
export function Breadcrumb({ trail }: { trail: readonly Crumb[] }) {
  return (
    <nav aria-label="현재 위치" className="flex items-center gap-[7px] text-meta text-fg-caption">
      {trail.map((crumb, index) => {
        const last = index === trail.length - 1;
        return (
          <Fragment key={`${crumb.label}-${index}`}>
            {index > 0 ? (
              <ChevronRight
                aria-hidden
                strokeWidth={1.5}
                className="h-[11px] w-[11px] text-fg-placeholder"
              />
            ) : null}
            {last || !crumb.href ? (
              // 마지막이 「지금 여기」다 — 한 단계 진한 회색으로만 구분한다
              <span className={last ? "min-w-0 truncate text-fg-meta" : undefined}>{crumb.label}</span>
            ) : (
              <Link
                href={crumb.href}
                className="rounded-[4px] hover:text-fg-meta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {crumb.label}
              </Link>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}

/**
 * 부모 라우트 — 「←」와 breadcrumb 링크가 **같은 자리**를 가리키게 하는 상수(FE §6-3).
 * 홈은 아직 `/tasks/` 다(첫 화면 · SPEC-001 U-1).
 */
export const HOME_ROUTE = "/tasks/";
export const MEETINGS_ROUTE = "/meetings/";
export const TASKS_ROUTE = "/tasks/";

export const HOME_CRUMB: Crumb = { label: "홈", href: HOME_ROUTE };
export const MEETINGS_CRUMB: Crumb = { label: "회의록", href: MEETINGS_ROUTE };
export const TASKS_CRUMB: Crumb = { label: "내 업무", href: TASKS_ROUTE };

/**
 * **상세 화면의 머리 한 줄**(FE §6-3) — 「←」 + breadcrumb.
 *
 * `backTo` 는 **부모 라우트**다(회의록 상세 → `/meetings/` · 업무 상세 → `/tasks/`).
 * **`router.back()` 을 쓰지 않는다** — 새 탭에서 상세를 직접 열어 히스토리가 없어도 갈 곳이 있어야 하고,
 * 눌러 보기 전에 어디로 가는지 링크 주소로 보여야 한다(가운데 클릭 · 새 탭도 그대로 된다).
 * **목록 화면은 `backTo` 를 넘기지 않는다** — 올라갈 곳이 없다.
 */
export function DetailHeaderBar({ trail, backTo }: { trail: readonly Crumb[]; backTo?: string }) {
  return (
    <div className="flex items-center gap-2">
      {backTo ? (
        <Link
          href={backTo}
          aria-label="뒤로"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-fg-caption hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ArrowLeft className="h-[15px] w-[15px]" aria-hidden />
        </Link>
      ) : null}
      <Breadcrumb trail={trail} />
    </div>
  );
}

/**
 * 경로별 breadcrumb.
 *
 * **여기 없는 화면은 줄이 통째로 빠진다** — 빈 줄을 남기면 세로 리듬만 흐트러지고
 * 알려 주는 것이 없다. REDRAW-02 는 `/tasks` 하나만 채운다(나머지는 다음 work).
 */
const TRAIL: Readonly<Record<string, readonly Crumb[]>> = {
  "/tasks/": [HOME_CRUMB, { label: "내 업무" }],
  /* 회의록 목록(SPEC-006 U-1 · 시안 L47~51). 상세는 상태에 따라 갈려 화면이 직접 그린다 */
  "/meetings/": [HOME_CRUMB, { label: "회의록" }],
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
