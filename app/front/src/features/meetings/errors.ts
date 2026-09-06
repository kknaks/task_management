/**
 * SPEC-006 §4 Case Matrix 를 화면 문구로 옮기는 곳 하나.
 *
 * **화면은 `code` 로 분기하고 `detail` 문구로 분기하지 않는다**(frontend/README.md §3-5).
 */

import { API_ERROR_CODE, isApiError } from "@/lib/api/errors";

export interface MeetingInlineError {
  message: string;
  /** 필드 옆이 아니라 **토스트**로 알려야 하는 것(`schedule_overlap` · `invalid_meeting_status`). */
  toast: boolean;
  /** 어느 컨트롤 옆에 붙는가 — 없으면 폼 전체다. */
  field?: "title" | "workType" | "project" | "time";
}

/** 겹침 토스트 문구(Case Matrix · S-3). */
export const OVERLAP_MESSAGE = "그 시간에 다른 일정이 있습니다";
/** 상태 가드 토스트 문구(Case Matrix · S-7). */
export const INVALID_STATUS_MESSAGE = "지금 상태에서는 할 수 없습니다";
/** 생성 드로어의 길이 안내(Case Matrix `validation_error`). */
export const DURATION_MESSAGE = "회의는 5분 이상 300분 이하여야 합니다";
export const END_BEFORE_START_MESSAGE = "종료 시각은 시작보다 뒤여야 합니다";

/**
 * 인라인/토스트로 옮길 사유. **`null` 이면 그 밖의 5xx·네트워크**이고 호출자가
 * 「가리지 않는」 실패 처리를 한다(Case Matrix 마지막 두 행).
 */
export function meetingInlineError(error: unknown): MeetingInlineError | null {
  if (!isApiError(error)) {
    return null;
  }

  switch (error.code) {
    case API_ERROR_CODE.VALIDATION_ERROR:
      return { message: error.detail, toast: false, field: "title" };
    case API_ERROR_CODE.INVALID_WORK_TYPE:
      return {
        message: "삭제됐거나 회의에 쓸 수 없는 유형입니다. 다시 골라 주세요",
        toast: false,
        field: "workType",
      };
    case API_ERROR_CODE.INVALID_PROJECT:
      return { message: "삭제된 프로젝트입니다. 다시 골라 주세요", toast: false, field: "project" };
    case API_ERROR_CODE.SCHEDULE_OVERLAP:
      // **토스트 + 일시 필드 실패 테두리**. 드로어는 열린 채다(Case Matrix).
      return { message: OVERLAP_MESSAGE, toast: true, field: "time" };
    case API_ERROR_CODE.INVALID_MEETING_STATUS:
      return { message: INVALID_STATUS_MESSAGE, toast: true };
    case API_ERROR_CODE.UNSUPPORTED_FILE_TYPE:
      return { message: "md 문서만 첨부할 수 있습니다", toast: false };
    default:
      return null;
  }
}

/** 없는 회의록 — 「없는 회의록입니다」 + 「목록으로」. **리다이렉트하지 않는다**(U-4). */
export function isMeetingNotFound(error: unknown): boolean {
  return isApiError(error) && error.code === API_ERROR_CODE.NOT_FOUND;
}

/** 상태 가드(409) — 토스트 + **상세 재조회**(화면이 낡은 것이 원인). */
export function isInvalidMeetingStatus(error: unknown): boolean {
  return isApiError(error) && error.code === API_ERROR_CODE.INVALID_MEETING_STATUS;
}

/** U-7 토스트 문구 — 「저장하지 못했습니다 · <필드 이름>」. 실행취소를 붙이지 않는다. */
export function autoSaveErrorToast(fieldLabel: string): string {
  return `저장하지 못했습니다 · ${fieldLabel}`;
}
