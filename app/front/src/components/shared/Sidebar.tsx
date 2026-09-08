"use client";

/**
 * **사이드바 8메뉴**(P-01 · SPEC-001 U-3 · frontend/README.md §10).
 *
 * 사이드바는 **200 고정 아니면 숨김**이다 — 아이콘만 남기는 축소형을 만들지 않는다
 * (`08-responsive.md` L16 · C-27). 1280~1439 구간의 오버레이 노출은 `AppShell` 이 맡는다.
 *
 * **메뉴를 지우지 않는다**(§C-9). 정책서가 없는 **홈·채팅은 라우트를 만들지 않고**
 * `V2Gate` 의 「곧 제공됩니다」로 그린다(FE §10 · FE-OQ-1 해소).
 *
 * 활성 항목만 `--tm-ink` 를 쓴다 — 「검정은 위치」를 쓰는 컴포넌트 셋 중 하나다(§5-2).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

import { BrandMark } from "@/features/auth/components/BrandMark";
import { V2Gate } from "@/components/shared/V2Gate";
import { cn } from "@/lib/utils";
import type { AccountSummary } from "@/types/api";

interface MenuItem {
  label: string;
  /** `null` 이면 **라우트가 없다** — 정책서가 없어 화면을 발명하지 않는다(FE §10). */
  href: string | null;
}

/** 순서는 디자인 원본 그대로다(SPEC-001 U-3). */
const MENU: readonly MenuItem[] = [
  { label: "홈", href: null },
  { label: "채팅", href: null },
  { label: "캘린더", href: "/calendar/" },
  { label: "내 업무", href: "/tasks/" },
  { label: "회의록", href: "/meetings/" },
  { label: "자료함", href: "/library/" },
  { label: "메시지", href: "/messages/" },
  { label: "설정", href: "/settings/" },
];

/**
 * 항목 규격 — 시안 `업무 화면 정의서.dc.html` 36~43줄: **h35 · r8 · padding 0 14 · 14px**.
 * 활성만 `#1E1E1E` 배경 + 흰 글씨 **700**이다.
 *
 * hover 는 **여기 넣지 않는다.** 활성 항목은 `--tm-ink` 위에 흰 글씨라, hover 배경을 함께
 * 걸면 밝은 fill 이 Ink 를 덮어써 글자가 사라진다. hover 는 **비활성 항목에만** 붙인다.
 */
const ITEM_CLASS =
  "flex h-[35px] items-center rounded-control px-[14px] text-control-label text-fg-meta";

/**
 * **알림 벨** — 시안 32~34줄. v1 에 알림 도메인이 **없다.**
 * 시안대로 그리되 **누르는 자리로 만들지 않는다** — 핸들러도 `V2Gate` 도 붙이지 않는다
 * (「곧」인지 「v2」인지 정한 적이 없어 문구를 발명하게 된다). 정적 표시 하나다.
 */
function NotificationBell() {
  return (
    <span
      aria-hidden
      className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-control border border-divider text-foreground"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 6.6a4 4 0 0 1 8 0c0 2.9 1 4.4 1 4.4H3s1-1.5 1-4.4Z" />
        <path d="M6.4 13a1.8 1.8 0 0 0 3.2 0" />
      </svg>
    </span>
  );
}

export function Sidebar({
  account,
  onNavigate,
}: {
  account?: AccountSummary;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    /**
     * 세로 리듬은 시안 좌표 그대로다(27~43줄) — 로고 `top 23.5`(25px) · 프로필 `top 80`(32px) ·
     * 메뉴 `top 143`. `absolute` 로 박지 않고(FE-C4) 위 여백과 묶음 간격으로 수렴시킨다.
     *
     * 두 묶음의 **높이를 못박아야** 안쪽 글자 크기가 리듬을 밀지 않는다:
     * 23.5 + 25 + 31.5 = **80** · 80 + 32 + 31 = **143**.
     */
    <nav
      aria-label="주 메뉴"
      className="flex h-full w-sidebar shrink-0 flex-col border-r border-sidebar-border bg-card px-3 pt-[23.5px]"
    >
      <BrandMark size="sm" className="h-[25px] px-[1px]" />

      {/* 사이드바 프로필은 「사람 표기 없음」 규칙의 **유일한 예외**다(디자인 시스템 [10] RULES) */}
      <div className="mt-[31.5px] flex h-8 items-center gap-2 px-[1px]">
        <span aria-hidden className="h-8 w-8 shrink-0 rounded-full bg-avatar" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-control-label font-bold text-foreground">
            {account?.name ?? ""}
          </span>
          {/* 소속은 「현재」 경력에서 파생된다 — **없으면 캡션을 비운다**(U-3) */}
          {account?.department ? (
            <span className="truncate text-[11px] text-fg-caption">{account.department}</span>
          ) : null}
        </span>
        <NotificationBell />
      </div>

      {/* 항목은 **서로 붙어 있다** — 시안 35줄의 컬럼에 gap 이 없다 */}
      <ul className="mt-[31px] flex flex-col">
        {MENU.map((item) => {
          if (item.href === null) {
            return (
              <li key={item.label}>
                <V2Gate reason="soon" className="block w-full">
                  <span className={cn(ITEM_CLASS, "w-full hover:bg-muted hover:text-foreground")}>
                    {item.label}
                  </span>
                </V2Gate>
              </li>
            );
          }

          const active = pathname === item.href || pathname.startsWith(item.href);
          return (
            <li key={item.label}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  ITEM_CLASS,
                  active
                    ? "bg-ink font-bold text-primary-foreground"
                    : "hover:bg-muted hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
