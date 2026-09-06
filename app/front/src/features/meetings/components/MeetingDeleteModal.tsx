"use client";

/**
 * **회의록 삭제 확인 모달 600**(SPEC-006 U-5 · SPEC-004 U-8 프레임) — `ConfirmModal` 위.
 *
 * 문안 3줄 —
 * - 제목 「'<제목>' 회의록을 삭제할까요?」
 * - 요약 「목록과 캘린더에서 사라집니다. 안건·회의록·AI 요약·스크립트·첨부 목록도 함께 보이지 않게 됩니다.」
 * - 경고 「**v1 에는 복원 화면이 없습니다.** 녹음 원본은 지워지지 않고 서버에 남습니다.」
 *
 * 진입점은 목록 행 컨텍스트 메뉴 · 시작 전 헤더 `⋯`. SPEC-007·008 의 삭제 버튼도 **이 함수를 부른다**
 * (이 spec 이 모달의 주인이다). **드로어가 열려 있으면 먼저 닫는다**(FE §6-2 — 드로어 위에 모달 금지).
 */

import type { useOverlay } from "@/lib/overlay/OverlayProvider";

type Overlay = ReturnType<typeof useOverlay>;

export const DELETE_SUMMARY =
  "목록과 캘린더에서 사라집니다. 안건·회의록·AI 요약·스크립트·첨부 목록도 함께 보이지 않게 됩니다.";
export const DELETE_WARNING = "v1 에는 복원 화면이 없습니다. 녹음 원본은 지워지지 않고 서버에 남습니다.";

export function openMeetingDeleteModal(
  overlay: Overlay,
  meeting: { id: number; title: string },
  onConfirm: () => Promise<void> | void,
): void {
  overlay.closeDrawer();
  overlay.openConfirm({
    title: `'${meeting.title}' 회의록을 삭제할까요?`,
    summary: DELETE_SUMMARY,
    warning: DELETE_WARNING,
    confirmLabel: "삭제",
    destructive: true,
    onConfirm,
  });
}
