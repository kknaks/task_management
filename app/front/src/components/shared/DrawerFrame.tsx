"use client";

/**
 * **S-04 드로어 프레임 — 이 파일이 드로어 규격의 주인이다**(frontend/README.md §6-2, 2026-09-06 확정).
 *
 * > `DrawerFrame` 을 만드는 work 가 이 규격의 주인이다. 첫 드로어를 만드는 work 가 이것을 세우고,
 * > 이후 회의·캘린더는 **그것을 쓰기만 한다.**
 *
 * ## 폭은 840 고정 — **prop 으로 받지 않는다**
 *
 * `width`·`size`·`className` 으로 폭을 넘기는 길을 두지 않는다. 화면마다 다른 폭이 필요해 보이면
 * 그건 **드로어가 아니라 다른 표면**이다 — 규격을 늘리지 말고 표면을 다시 고르라.
 * **유일한 예외는 좁은 화면 전체화면 전환**이고, 그 판정도 **이 파일 안**에 있다.
 *
 * | 규격 | 값 | 근거 |
 * |---|---|---|
 * | 폭 | **840**(`--tm-drawer-width`) | §6 오버레이 3종 |
 * | 스크림 | `rgba(30,30,30,0.32)`(`--tm-scrim-drawer`) | 뒤 화면이 보인다(F-3) |
 * | 헤더 / 푸터 | 72 / 76 | §6-2 |
 * | 닫기 | **`Esc` · × · 스크림 클릭 셋 다** | §1-1 「닫는 길을 항상 열어 둔다」 |
 * | ⤢ | `expandTo` 라우트로 **승격**(드로어가 닫히고 이동) | F-5 |
 * | 1280~1439 | **전체 화면** — 스크림 없음 · 헤더 74 한 줄 · 좌측 `←` | §7-1 · SPEC-003 U-11 |
 *
 * 드로어는 **동시에 하나**다. 드로어 위에 모달을 겹치는 것은 `OverlayProvider` 가 막는다(§6-2).
 * 이 컴포넌트가 `Sheet` 를 import 하는 **유일한 자리**다.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ArrowLeft, Maximize2, X } from "lucide-react";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/** §7-1 세 구간의 경계. 이 아래에서 드로어는 전체 화면이 된다(SPEC-003 U-11). */
const FULLSCREEN_BELOW = 1440;

/**
 * 지금 폭이 전체화면 구간인가. **판정이 이 파일 안에 있다** — 화면이 「좁으니까 넓게」를
 * 스스로 정하면 폭 규격이 다시 갈린다(§6-2 유일한 예외).
 */
function useFullscreenDrawer(): boolean {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const measure = () => setFullscreen(window.innerWidth < FULLSCREEN_BELOW);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  return fullscreen;
}

export interface DrawerFrameProps {
  title: string;
  /** 제목 앞에 붙는 배지·칩 자리(유형 배지 등). */
  badge?: ReactNode;
  /** 헤더 우측 — 상태 드롭다운·기한·`⋯` 같은 화면별 컨트롤. */
  headerActions?: ReactNode;
  /** ⤢ 로 승격될 전체 페이지 라우트(F-5). 없으면 ⤢ 를 그리지 않는다(생성 드로어). */
  expandTo?: string;
  children: ReactNode;
  onClose: () => void;
}

export function DrawerFrame({
  title,
  badge,
  headerActions,
  expandTo,
  children,
  onClose,
}: DrawerFrameProps) {
  /**
   * 푸터 자리. **내용은 본문이 채운다** — 오버레이 스택은 `content` 를 스냅숏으로 들기
   * 때문에 상태를 가진 폼(생성 드로어)의 CTA 는 그 폼 **안**에 살아야 한다.
   * 자리(높이 76·구분선)는 여기 있고 채우는 것만 `DrawerFooter` 가 한다.
   */
  const [footerEl, setFooterEl] = useState<HTMLElement | null>(null);
  const router = useRouter();
  const fullscreen = useFullscreenDrawer();

  const expand = () => {
    if (!expandTo) {
      return;
    }
    // **승격은 한 방향**이다 — 드로어가 닫히고 그 라우트로 간다(F-5 · SPEC-003 U-4).
    onClose();
    router.push(expandTo);
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        // `Esc` · 스크림 클릭이 여기로 온다. × 는 아래 버튼이 같은 `onClose` 를 부른다.
        if (!open) {
          onClose();
        }
      }}
    >
      <SheetContent
        side="right"
        /**
         * **폭이 정해지는 유일한 자리.** 넓은 화면은 840 고정, 좁은 화면은 전체 화면이고
         * 그때만 스크림을 걷는다(SPEC-003 U-11). 바깥에서 이 값을 바꿀 길이 없다.
         */
        className={cn(
          "flex flex-col gap-0 border-l border-border bg-card p-0 shadow-drawer",
          // 생성물의 기본 닫기 버튼은 **지우지 않고 래퍼가 숨긴다** — 헤더가 자기 ×/← 를 그린다.
          // 지우면 재생성 때 되살아나 조용히 두 개가 된다(`ConfirmModal` 과 같은 방식).
          "[&>button:last-child]:hidden",
          fullscreen ? "inset-0 w-full max-w-none border-l-0" : "w-drawer max-w-drawer",
        )}
        // 전체 화면 구간에서는 뒤 화면이 보일 이유가 없다 — 스크림을 지운다.
        overlayClassName={fullscreen ? "bg-transparent" : undefined}
      >
        <header
          className={cn(
            "flex shrink-0 items-center gap-3 border-b border-divider px-6",
            // 넓은 화면 72 / 좁은 화면 74 한 줄(§7-1 · P-31)
            fullscreen ? "h-[74px]" : "h-[72px]",
          )}
        >
          {fullscreen ? (
            // 전체 화면에서는 스크림이 없으므로 **헤더 좌측 `←`** 가 닫는 길이다.
            <button
              type="button"
              aria-label="닫기"
              onClick={onClose}
              className="flex h-control w-control shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-muted"
            >
              <ArrowLeft aria-hidden />
            </button>
          ) : null}

          {badge}

          <SheetTitle className="min-w-0 flex-1 truncate text-detail-title text-foreground">
            {title}
          </SheetTitle>

          {headerActions}

          {expandTo ? (
            <button
              type="button"
              aria-label="전체 페이지로 열기"
              onClick={expand}
              className="flex h-control w-control shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-muted"
            >
              <Maximize2 aria-hidden />
            </button>
          ) : null}

          {/* 좁은 화면에서는 좌측 `←` 가 그 역할을 하므로 × 를 겹쳐 두지 않는다 */}
          {fullscreen ? null : (
            <button
              type="button"
              aria-label="드로어 닫기"
              onClick={onClose}
              className="flex h-control w-control shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-muted"
            >
              <X aria-hidden />
            </button>
          )}
        </header>

        <DrawerFooterSlot.Provider value={footerEl}>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        </DrawerFooterSlot.Provider>

        {/* 비어 있으면 자리째 사라진다(`empty:hidden`) — 상세 드로어에는 푸터가 없다 */}
        <footer
          ref={setFooterEl}
          className="flex h-[76px] shrink-0 items-center justify-end gap-2 border-t border-divider px-6 empty:hidden"
        />
      </SheetContent>
    </Sheet>
  );
}

/** 푸터 자리를 본문에 알려 주는 통로. 규격(76·구분선)은 프레임이 갖는다. */
const DrawerFooterSlot = createContext<HTMLElement | null>(null);

/**
 * 드로어 푸터에 CTA 를 놓는다. **드로어 본문 안에서만** 쓴다 —
 * 상태를 가진 폼이 자기 CTA 를 자기 상태와 함께 들 수 있게 하는 자리다.
 */
export function DrawerFooter({ children }: { children: ReactNode }) {
  const slot = useContext(DrawerFooterSlot);
  return slot ? createPortal(children, slot) : null;
}
