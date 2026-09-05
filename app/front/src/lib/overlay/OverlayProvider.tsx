"use client";

/**
 * 오버레이 스택 — **전역으로 남는 UI 상태는 이것 하나뿐이다**(frontend/README.md §3-1 · §6-1).
 *
 * API 두 개가 곧 용도 규칙이다 — **편집은 드로어, 결정은 모달.**
 * 컴포넌트가 `Sheet`·`Dialog` 를 직접 import 하지 않는다(§11 금지 목록 3).
 *
 * **WORK-001 은 뼈대다.** 스택과 §6-2 의 규칙(드로어 위에 모달 금지)은 지금 세우고,
 * 실제 표면인 `DrawerFrame`(S-04)·`ConfirmModal`(S-05)은 그 화면을 만드는 work 가
 * 이 Provider 아래에 끼운다. 그때까지 열린 항목은 상태로만 남고 그려지지 않는다.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export interface DrawerRequest {
  /** 같은 드로어를 다시 열 때 식별자. */
  key: string;
  title: string;
  badge?: ReactNode;
  /** ⤢ 로 승격될 전체 페이지 라우트(F-5). 예) `/tasks/detail?id=12` */
  expandTo?: string;
  content: ReactNode;
}

export interface ConfirmRequest {
  title: string;
  summary: ReactNode;
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

  const closeTop = useCallback(() => {
    setStack((prev) => prev.slice(0, -1));
  }, []);

  const closeAll = useCallback(() => setStack([]), []);

  const value = useMemo<OverlayContextValue>(
    () => ({ stack, openDrawer, openConfirm, closeTop, closeAll }),
    [stack, openDrawer, openConfirm, closeTop, closeAll],
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
