"use client";

/**
 * 설정 공통 골격 — **좌 메뉴 카드 260 + 우 본문**(F-11 · `11-auth-profile.md §설정 공통 골격`).
 *
 * 메뉴 카드가 어느 설정 화면에서나 같은 자리에 있다(SPEC-001 U-4 기대 결과).
 * 본문은 각 `page.tsx` 가 채운다 — 이 배치에서 **내용이 있는 목적지는 설정뿐**이고
 * 그 안의 세 항목 본문은 다음 배치가 채운다.
 */

import { SettingsMenuCard } from "@/features/settings/components/SettingsMenuCard";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-full items-start gap-5">
      <SettingsMenuCard />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
