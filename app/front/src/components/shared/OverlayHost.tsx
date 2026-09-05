"use client";

/**
 * `OverlayProvider` 의 스택을 **실제 표면으로 그리는 자리**(frontend/README.md §6-1).
 *
 * WORK-001 은 스택과 §6-2 규칙만 세웠고 아무것도 그리지 않았다. WORK-002 가 **모달**을 붙인다.
 * 드로어(`DrawerFrame` S-04)는 그 화면을 만드는 work 가 여기 같은 자리에 끼운다.
 *
 * `lib/overlay` 가 아니라 `components/shared` 에 있는 이유 — Provider(상태)와 표면(그리기)을
 * 나눠야 `lib` 이 컴포넌트를 import 하지 않는다(§2 디렉토리 구조).
 */

import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { useOverlay } from "@/lib/overlay/OverlayProvider";

export function OverlayHost() {
  const { stack, closeTop } = useOverlay();

  return (
    <>
      {stack.map((entry, index) =>
        entry.kind === "confirm" ? (
          <ConfirmModal key={`confirm-${index}`} request={entry} onClose={closeTop} />
        ) : null,
      )}
    </>
  );
}
