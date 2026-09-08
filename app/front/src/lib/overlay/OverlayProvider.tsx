"use client";

/**
 * 오버레이 스택 — **전역으로 남는 UI 상태는 이것 하나뿐이다**(frontend/README.md §3-1 · §6-1).
 *
 * API 두 개가 곧 용도 규칙이다 — **편집은 드로어, 결정은 모달.**
 * 컴포넌트가 `Sheet`·`Dialog` 를 직접 import 하지 않는다(§11 금지 목록 3).
 *
 * 표면은 `components/shared/OverlayHost.tsx` 가 그린다 — `DrawerFrame`(S-04)·`ConfirmModal`(S-05).
 * **드로어 규격(폭 등)은 이 파일이 아니라 `DrawerFrame` 하나가 정한다**(§6-2) —
 * 여기 요청 타입에 `width`·`size`·`className` 같은 자리를 두지 않는 이유가 그것이다.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export interface DrawerRequest {
  /** 같은 드로어를 다시 열 때 식별자. */
  key: string;
  title: string;
  badge?: ReactNode;
  /** 헤더 우측 컨트롤(상태 드롭다운·기한·`⋯`). 화면이 자리를 채운다. */
  headerActions?: ReactNode;
  /** 헤더를 통째로 그린다 — 상세 드로어처럼 시안 헤더가 3겹인 경우(REDRAW-03 §2-1). */
  renderHeader?: (state: {
    fullscreen: boolean;
    expand: (() => void) | null;
    onClose: () => void;
  }) => ReactNode;
  /** ⤢ 로 승격될 전체 페이지 라우트(F-5). 예) `/tasks/detail?id=12` */
  expandTo?: string;
  content: ReactNode;
}

export interface ConfirmRequest {
  title: string;
  summary: ReactNode;
  /**
   * 모달 크기(FE §6) — `heavy`(기본 · 600)는 딸린 것이 많은 결정(회의 삭제 · 계정),
   * `light`(420)는 **제목 + 한 문장 + h32** 뿐인 결정(줄 삭제 — SPEC-008 U-7 · MF-63).
   * `light` 는 **입력 · 경고 슬롯을 받지 않는다.**
   */
  size?: "heavy" | "light";
  /**
   * **결정에 필요한 입력 슬롯** — 취소 사유 칩처럼 「결정 하나」에 딸린 최소 입력이다
   * (SPEC-004 U-7). 편집은 드로어라는 규칙과 어긋나지 않는다: 여기 들어오는 것은
   * 저장할 필드가 아니라 **그 결정의 근거**다.
   *
   * `setCanConfirm` 으로 확인 버튼의 활성 여부를 슬롯이 정한다 — 프레임은 판단하지 않는다.
   */
  body?: (ctx: { setCanConfirm: (ok: boolean) => void }) => ReactNode;
  /** 경고 슬롯. **비워 두면 줄 자체가 없다**(SPEC-001 U-5 — 조건부 노출). */
  warning?: ReactNode;
  /** 확인 버튼 문구. 「확인」이 아니라 **하려는 동작**을 적는다(U-5 「로그아웃」·U-6 「계정 삭제」). */
  confirmLabel: string;
  /**
   * 파괴적 색(`--tm-status-overdue`)을 쓸지. **데이터가 사라지는 결정에만** 켠다 —
   * 로그아웃은 아무것도 지우지 않으므로 끈다(U-5 CTA).
   */
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}

type OverlayEntry =
  | ({ kind: "drawer" } & DrawerRequest)
  | ({ kind: "confirm" } & ConfirmRequest);

interface OverlayContextValue {
  stack: readonly OverlayEntry[];
  openDrawer: (request: DrawerRequest) => void;
  openConfirm: (request: ConfirmRequest) => void;
  /** 열려 있는 드로어를 닫는다 — 위에 모달이 얹혀 있어도 드로어만 걷는다. */
  closeDrawer: () => void;
  closeTop: () => void;
  closeAll: () => void;
}

const OverlayContext = createContext<OverlayContextValue | null>(null);

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<readonly OverlayEntry[]>([]);

  const openDrawer = useCallback((request: DrawerRequest) => {
    // 드로어는 동시에 하나다. 다른 드로어가 열려 있으면 교체한다(§6-2).
    setStack((prev) => [...prev.filter((entry) => entry.kind !== "drawer"), { kind: "drawer", ...request }]);
  }, []);

  const openConfirm = useCallback((request: ConfirmRequest) => {
    setStack((prev) => {
      const hasDrawer = prev.some((entry) => entry.kind === "drawer");
      if (hasDrawer) {
        // **드로어 위에 모달을 겹치지 않는다**(09-design-tokens §오버레이).
        // 개발 모드에서는 세우고, 운영에서는 드로어를 먼저 닫고 연다(§6-2).
        if (process.env.NODE_ENV !== "production") {
          throw new Error(
            "드로어가 열린 상태에서 openConfirm 을 부를 수 없습니다 — 드로어 안의 단계 전환으로 만드세요(§6-2).",
          );
        }
        return [{ kind: "confirm", ...request }];
      }
      return [...prev, { kind: "confirm", ...request }];
    });
  }, []);

  const closeDrawer = useCallback(() => {
    setStack((prev) => prev.filter((entry) => entry.kind !== "drawer"));
  }, []);

  const closeTop = useCallback(() => {
    setStack((prev) => prev.slice(0, -1));
  }, []);

  const closeAll = useCallback(() => setStack([]), []);

  const value = useMemo<OverlayContextValue>(
    () => ({ stack, openDrawer, openConfirm, closeDrawer, closeTop, closeAll }),
    [stack, openDrawer, openConfirm, closeDrawer, closeTop, closeAll],
  );

  return <OverlayContext.Provider value={value}>{children}</OverlayContext.Provider>;
}

export function useOverlay(): OverlayContextValue {
  const context = useContext(OverlayContext);
  if (!context) {
    throw new Error("useOverlay 는 OverlayProvider 안에서만 쓸 수 있습니다.");
  }
  return context;
}
