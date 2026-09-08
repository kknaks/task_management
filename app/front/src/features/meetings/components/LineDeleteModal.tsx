"use client";

/**
 * **줄 삭제 확인 모달 420**(SPEC-008 U-7 · MF-63) — `ConfirmModal` 의 `size:"light"` 위.
 *
 * 삭제는 **자동 저장이 아니라 확인을 거친다** — 지운 줄은 되돌릴 이력이 없다([10] L800 · ERD M-20 「하드 딜리트 · 복원 창구 없음」).
 * 다른 편집(본문 · 안건 이름)은 포커스 해제 자동 저장이다.
 *
 * - 제목 「이 줄을 삭제할까요?」 · 요약 「**되돌릴 수 없습니다.**」 — **한 문장**이다
 * - **안 지워지는 것(AI 요약 · 스크립트 · 연결된 업무)을 적지 않는다.** 경고 슬롯도 없다 — **업무 줄이어도 같다**(갈래를 만들지 않는다)
 * - CTA 「취소」 · 「삭제」(`#E2685B`) h32. **취소면 요청이 없다**
 *
 * 회의 삭제(SPEC-006 U-5)는 **600 그대로**다 — 큰 모달은 딸린 것이 많은 결정의 자리다.
 * 편집 모드는 전체 페이지라 드로어 위에 겹치지 않는다(FE §6-2) — 드로어(U-4)에는 「제거」 자체가 없다.
 * 실패 처리(모달은 닫히고 줄은 그대로 + 토스트)는 `onConfirm` 을 준 쪽(`useMeetingEdit.deleteLineConfirmed`)이 한다.
 */

import type { useOverlay } from "@/lib/overlay/OverlayProvider";

type Overlay = ReturnType<typeof useOverlay>;

export const LINE_DELETE_TITLE = "이 줄을 삭제할까요?";
export const LINE_DELETE_SUMMARY = "되돌릴 수 없습니다.";

export function openLineDeleteModal(overlay: Overlay, onConfirm: () => Promise<void> | void): void {
  overlay.openConfirm({
    title: LINE_DELETE_TITLE,
    summary: LINE_DELETE_SUMMARY,
    size: "light",
    confirmLabel: "삭제",
    destructive: true,
    onConfirm,
  });
}
