"use client";

/**
 * **U-2 최소 폭 안내 화면**(SPEC-000 §2 · P-02 · FE §7-2).
 *
 * 폭 < 1280 인 동안 아래 화면을 **덮는다.** 아래 화면은 렌더되지만 조작할 수 없다.
 * 넓히면 **즉시** 원래 화면으로 돌아온다(새로고침 불필요).
 *
 * - **CTA 가 없다.** 닫기·무시하고 계속 버튼을 두지 않는다 — 그 아래 폭에는 레이아웃 규격이 없다.
 * - **Tauri 창 `minWidth` 로 막지 않는다**(FE §7-2 확정). 셸이 없는 환경(브라우저)에서도
 *   같게 동작해야 하므로 가드는 화면이 갖는다.
 * - 브레이크포인트 유틸이 아니라 **측정값**이 필요하다 — 안내 문구가 현재 폭을 보여준다.
 */

import { useEffect, useState, type ReactNode } from "react";

/** `--tm-min-width` 와 같은 값. Tailwind `desk` 브레이크포인트의 기준이기도 하다(§7-1). */
const MIN_WIDTH = 1280;

export function MinWidthGuard({ children }: { children: ReactNode }) {
  // 정적 산출물은 폭을 모른 채 구워진다 — 하이드레이션 뒤에 측정한다.
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const measure = () => setWidth(window.innerWidth);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const tooNarrow = width !== null && width < MIN_WIDTH;

  return (
    <>
      {children}
      {tooNarrow ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="창이 너무 좁습니다"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-background px-8 text-center"
        >
          <p className="text-page-title text-foreground">창이 너무 좁습니다</p>
          <p className="text-body text-fg-meta">
            가로 {MIN_WIDTH}px 이상에서 사용해 주세요 · 현재 {width}px
          </p>
        </div>
      ) : null}
    </>
  );
}
