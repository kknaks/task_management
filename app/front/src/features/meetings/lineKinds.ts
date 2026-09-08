/**
 * 줄 종류 4종의 **표시 매핑 한 곳**(DEC-003 §1 표 · [09] L658~680 · G-4).
 *
 * `LineRow`(라벨) · `LineKindPopover`(회의 중 `/` 팝오버)가 같은 이름·색을 본다 — **편집 모드 셀렉터는 폐기됐다**(MF-60).
 * 컴포넌트끼리 서로 import 하면 순환이 생겨 여기로 올렸다(WORK-008). 저장값은 영문 소문자다.
 */

import type { LineKind } from "@/features/meetings/types";

export const LINE_KINDS: readonly LineKind[] = ["discussion", "decision", "task", "action"];

export const LINE_KIND_LABEL: Record<LineKind, string> = {
  discussion: "논의",
  decision: "결정",
  task: "업무",
  action: "액션",
};

/** 종류별 라벨 색 — 논의 `#9EA2AE` · 결정 `#1663B5` · 업무 `#5F6470` · 액션 `#4B52A8`. */
export const LINE_LABEL_CLASS: Record<LineKind, string> = {
  discussion: "text-fg-caption",
  decision: "text-line-decision",
  task: "text-muted-foreground",
  action: "text-secondary-foreground",
};

export function isLineKind(kind: string): kind is LineKind {
  return kind in LINE_KIND_LABEL;
}
