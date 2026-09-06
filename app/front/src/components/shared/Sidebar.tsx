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
 * hover 는 **여기 넣지 않는다.** 활성 항목은 `--tm-ink` 위에 흰 글씨라, hover 배경을 함께
 * 걸면 밝은 fill 이 Ink 를 덮어써 글자가 사라진다. hover 는 **비활성 항목에만** 붙인다.
 */
const ITEM_CLASS = "flex h-todo items-center rounded-control px-3 text-body text-muted-foreground";

export function Sidebar({
  account,
  onNavigate,
}: {
  account?: AccountSummary;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="주 메뉴"
      className="flex h-full w-sidebar shrink-0 flex-col gap-6 border-r border-sidebar-border bg-card px-3 py-6"
    >
      <BrandMark className="px-3" />

      {/* 사이드바 프로필은 「사람 표기 없음」 규칙의 **유일한 예외**다(09-design-tokens §그 외) */}
      <div className="flex flex-col gap-0.5 px-3">
        <span className="text-section text-foreground">{account?.name ?? ""}</span>
        {/* 소속은 「현재」 경력에서 파생된다 — **없으면 캡션을 비운다**(U-3) */}
        {account?.department ? (
          <span className="text-caption text-fg-caption">{account.department}</span>
        ) : null}
      </div>

      <ul className="flex flex-col gap-1">
        {MENU.map((item) => {
          if (item.href === null) {
            return (
              <li key={item.label}>
                <V2Gate reason="soon" className="block w-full">
                  <span className={cn(ITEM_CLASS, "w-full hover:bg-muted")}>{item.label}</span>
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
                  active ? "bg-ink font-bold text-primary-foreground" : "hover:bg-muted",
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
