/**
 * SPEC-002 §4 Case Matrix 를 화면 문구로 옮기는 곳 하나.
 *
 * **화면은 `code` 로 분기하고 `detail` 문구로 분기하지 않는다**(frontend/README.md §3-5).
 * 여기서 나온 문구는 **그 항목 옆 인라인**으로 붙고, 자동 저장 실패의 토스트는 U-7 규격이 따로 만든다.
 *
 * `inlineErrorMessage`(코드→문구)는 업무·회의 드로어의 「+ 새 프로젝트로 추가」도 쓰므로
 * **`lib/api/errors.ts` 로 올렸다**(WORK-006 검수 W-1). 여기는 설정 화면만 쓰는 것만 남는다.
 */

import { API_ERROR_CODE, isApiError } from "@/lib/api/errors";

/** 없는 항목·남의 항목 — 토스트 + 목록 갱신(Case Matrix). */
export function isNotFound(error: unknown): boolean {
  return isApiError(error) && error.code === API_ERROR_CODE.NOT_FOUND;
}

/** U-7 토스트 문구 — 「저장하지 못했습니다 · <필드 이름>」. 실행취소를 붙이지 않는다. */
export function autoSaveErrorToast(fieldLabel: string): string {
  return `저장하지 못했습니다 · ${fieldLabel}`;
}
