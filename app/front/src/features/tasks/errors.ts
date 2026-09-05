/**
 * SPEC-003 §4 Case Matrix 를 화면 문구로 옮기는 곳 하나.
 *
 * **화면은 `code` 로 분기하고 `detail` 문구로 분기하지 않는다**(frontend/README.md §3-5).
 */

import { API_ERROR_CODE, isApiError } from "@/lib/api/errors";

export interface TaskInlineError {
  message: string;
  /** 필드 옆이 아니라 **토스트**로 알려야 하는 것(`schedule_overlap`). */
  toast: boolean;
  /** 어느 컨트롤 옆에 붙는가 — 없으면 폼 전체다. */
  field?: "title" | "workType" | "due";
}

/**
 * 인라인/토스트로 옮길 사유. **`null` 이면 그 밖의 5xx·네트워크**이고 호출자가
 * 「가리지 않는」 실패 처리를 한다(Case Matrix 마지막 두 행).
 */
export function taskInlineError(error: unknown): TaskInlineError | null {
  if (!isApiError(error)) {
    return null;
  }

  switch (error.code) {
    case API_ERROR_CODE.VALIDATION_ERROR:
      return { message: error.detail, toast: false, field: "title" };
    case API_ERROR_CODE.INVALID_WORK_TYPE:
      return { message: "삭제된 유형입니다. 다시 골라 주세요", toast: false, field: "workType" };
    case API_ERROR_CODE.SCHEDULE_OVERLAP:
      // **토스트**이고 기한 값은 이전으로 되돌린다 — 저장되지 않는다(Case Matrix).
      return { message: "그 시간에 다른 일정이 있습니다", toast: true, field: "due" };
    case API_ERROR_CODE.UNSUPPORTED_FILE_TYPE:
      return { message: "md 문서만 첨부할 수 있습니다", toast: false };
    default:
      return null;
  }
}

/** 없는 업무 — 「없는 업무입니다」 + 「목록으로」. **리다이렉트하지 않는다**(U-3). */
export function isTaskNotFound(error: unknown): boolean {
  return isApiError(error) && error.code === API_ERROR_CODE.NOT_FOUND;
}

/** U-7 토스트 문구 — 「저장하지 못했습니다 · <필드 이름>」. 실행취소를 붙이지 않는다. */
export function autoSaveErrorToast(fieldLabel: string): string {
  return `저장하지 못했습니다 · ${fieldLabel}`;
}
