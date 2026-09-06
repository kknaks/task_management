"use client";

/**
 * **줄 삭제 확인 모달 600**(SPEC-008 U-7 · SPEC-004 U-8 프레임) — `ConfirmModal` 위.
 *
 * 삭제는 **자동 저장이 아니라 확인을 거친다** — 지운 줄은 되돌릴 이력이 없고([10] L800 · ERD M-20 「하드 딜리트 · 복원 창구 없음」),
 * AI 계승 근거 칩은 사용자가 다시 만들 수 없다. 다른 편집(본문 · 종류 · 안건 이름)은 포커스 해제 자동 저장이다.
 *
 * - 제목 「이 줄을 삭제할까요?」 · 요약 「회의록에서 사라지고 되돌릴 수 없습니다. AI 요약과 스크립트는 그대로 남습니다.」
 * - 경고 슬롯 — **업무 줄이면** 「연결된 업무는 삭제되지 않습니다. 반영하지 않은 변경(기한 · 상태 · 메모)은 함께 사라집니다.」, 그 밖은 비운다
 * - CTA 「취소」 · 「삭제」(`#E2685B`). **취소면 요청이 없다**
 *
 * 편집 모드는 전체 페이지라 드로어 위에 겹치지 않는다(FE §6-2) — 드로어(U-4)에는 「제거」 자체가 없다.
 * 실패 처리(모달은 닫히고 줄은 그대로 + 토스트)는 `onConfirm` 을 준 쪽(`useMeetingEdit.deleteLineConfirmed`)이 한다 — 던지지 않으므로 모달이 닫힌다.
 */

import type { MeetingLine } from "@/features/meetings/types";
import type { useOverlay } from "@/lib/overlay/OverlayProvider";

type Overlay = ReturnType<typeof useOverlay>;

export const LINE_DELETE_TITLE = "이 줄을 삭제할까요?";
export const LINE_DELETE_SUMMARY = "회의록에서 사라지고 되돌릴 수 없습니다. AI 요약과 스크립트는 그대로 남습니다.";
export const LINE_DELETE_TASK_WARNING =
  "연결된 업무는 삭제되지 않습니다. 반영하지 않은 변경(기한 · 상태 · 메모)은 함께 사라집니다.";

export function openLineDeleteModal(
  overlay: Overlay,
  line: Pick<MeetingLine, "id" | "taskId">,
  onConfirm: () => Promise<void> | void,
): void {
  overlay.openConfirm({
    title: LINE_DELETE_TITLE,
    summary: LINE_DELETE_SUMMARY,
    warning: line.taskId !== null ? LINE_DELETE_TASK_WARNING : undefined,
    confirmLabel: "삭제",
    destructive: true,
    onConfirm,
  });
}
