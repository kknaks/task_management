"use client";

/**
 * **U-4 설정 좌측 메뉴 카드**(SPEC-001 · `11-auth-profile.md §설정 공통 골격` · F-11).
 *
 * 카드 260 안에 항목 38px 3개 → 구분선 → 로그아웃·계정 삭제 → 구분선 → 버전 캡션.
 * 어느 설정 화면에서나 **같은 자리**에 있고 현재 항목만 강조된다.
 *
 * - 「로그아웃」 → **U-5 확인 모달**. 모달을 지나지 않고 로그아웃되는 경로는 없다
 * - 「계정 삭제」 → **U-2 v2 게이트**. 모달이 열리지 않고 토스트만 뜬다(U-6 기대 결과)
 * - 「마지막 저장」 캡션 — 이 배치에는 자동 저장이 없다. **아직 없으면 줄을 비운다**
 *   (「-」·「없음」을 쓰지 않는다 — U-4 문구)
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { V2Gate } from "@/components/shared/V2Gate";
import { env } from "@/lib/env";
import { isSessionPersistent, logout } from "@/lib/auth/session";
import { useOverlay } from "@/lib/overlay/OverlayProvider";
import { cn } from "@/lib/utils";

const MENU = [
  { label: "개인 설정", href: "/settings/" },
  { label: "업무 설정", href: "/settings/work/" },
  { label: "연동 관리", href: "/settings/integrations/" },
];

export function SettingsMenuCard() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { openConfirm } = useOverlay();

  const handleLogout = () => {
    openConfirm({
      title: "로그아웃할까요?",
      summary: "이 앱에서 로그아웃합니다. 다시 들어오려면 아이디와 비밀번호를 입력해야 합니다.",
      // **「유지」로 로그인한 경우에만** 노출한다 — 아니면 슬롯을 비운다(U-5 문구).
      warning: isSessionPersistent()
        ? "「로그인 상태 유지」로 저장된 로그인 정보도 함께 지워집니다."
        : undefined,
      // 파괴적 색을 쓰지 않는다 — 데이터가 사라지지 않는다(U-5 CTA).
      confirmLabel: "로그아웃",
      onConfirm: async () => {
        const { serverAcknowledged, storeCleared } = await logout();
        // 남은 쿼리가 무효화된 토큰으로 다시 나가지 않게 캐시를 비운다(A-7 재사용 감지 회피).
        queryClient.clear();
        // **실패해도 토큰은 지웠다.** 그 사실을 가리지 않는다(SPEC-001 §5 로그아웃).
        if (!serverAcknowledged) {
          toast.error("서버에 로그아웃을 알리지 못했지만 이 기기에서는 로그아웃되었습니다");
        } else if (!storeCleared) {
          // 키체인 삭제가 거부되면 저장된 값이 남는다 — 조용히 넘기면 다음 실행에서 되살아난다.
          toast.error("키체인에서 저장된 로그인 정보를 지우지 못했습니다 — 접근을 허용해 주세요");
        }
        router.replace("/login/");
      },
    });
  };

  return (
    /**
     * 폭은 구간에 따라 갈린다 — **1280~1439 는 240 · ≥1440 은 260**(SPEC-002 U-8).
     * 높이는 **내용만큼만** 차지하고 상단에 고정된다. 1920 규칙의 「메뉴 카드 높이를 패널과
     * 같은 값으로」는 고정 캔버스에서 나온 값이라 유동에서는 성립하지 않는다(같은 절).
     */
    <aside className="flex w-[240px] shrink-0 flex-col gap-2 self-start rounded-card border border-border bg-card p-3 wide:w-[260px]">
      <ul className="flex flex-col">
        {MENU.map((item) => {
          const current = pathname === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex h-input items-center rounded-control px-3 text-body text-muted-foreground",
                  // hover 는 **비활성 항목에만.** 현재 항목에 걸면 hover fill 이 강조 배경을 덮는다.
                  current
                    ? "bg-row-divider font-bold text-foreground"
                    : "hover:bg-muted",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="h-px bg-divider" />

      <div className="flex flex-col">
        <button
          type="button"
          onClick={handleLogout}
          className="flex h-input items-center rounded-control px-3 text-left text-body text-muted-foreground hover:bg-muted"
        >
          로그아웃
        </button>

        {/* v2 게이트 — 누르면 모달이 열리지 않고 토스트만 뜬다(U-6 기대 결과) */}
        <V2Gate reason="v2" className="block w-full">
          <button
            type="button"
            className="flex h-input w-full items-center rounded-control px-3 text-left text-body text-muted-foreground hover:text-destructive"
          >
            계정 삭제
          </button>
        </V2Gate>
      </div>

      <div className="h-px bg-divider" />

      <p className="px-3 text-caption text-fg-caption">Managment v{env.appVersion}</p>
      {/* 「마지막 저장」 — 이 화면에서 성공한 자동 저장이 아직 없으므로 **줄을 비운다**(U-4) */}
    </aside>
  );
}
