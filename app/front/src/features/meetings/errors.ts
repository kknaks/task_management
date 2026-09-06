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

/** v2 게이트가 샜을 때의 안전망 토스트(Case Matrix · `501 v2_not_available`). `V2Gate` 와 같은 문구다. */
export const V2_NOT_AVAILABLE_MESSAGE = "v2에서 제공됩니다";

/**
 * `validation_error` 의 **`field`(요청 본문 키) → 컨트롤**. 서버가 어느 입력인지 말해 줄 때만 짚는다 —
 * 모르면 `undefined`(폼 전체). **제목으로 기본을 두지 않는다** — 일시 오류를 제목 칸에 붙이게 된다(W-3).
 */
function validationField(field: string | null): MeetingInlineError["field"] {
  switch (field) {
    case "title":
      return "title";
    case "workTypeId":
      return "workType";
    case "projectId":
      return "project";
    case "startAt":
    case "endAt":
      return "time";
    default:
      return undefined;
  }
}

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
      // **해당 컨트롤**(Case Matrix) — 서버가 `field` 를 주면 그 칸, 아니면 폼 전체.
      return { message: error.detail, toast: false, field: validationField(error.field) };
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
    case API_ERROR_CODE.V2_NOT_AVAILABLE:
      // 정상 경로가 아니다 — `V2Gate` 가 새서 요청이 나갔을 때의 안전망(Case Matrix · W-5).
      return { message: V2_NOT_AVAILABLE_MESSAGE, toast: true };
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

/** 422 인가 — 종료 후 편집의 인라인 필드 · 드로어가 **그 필드**에 붙일지 가른다(SPEC-008 Case Matrix `validation_error`). */
export function isValidationError(error: unknown): boolean {
  return isApiError(error) && error.code === API_ERROR_CODE.VALIDATION_ERROR;
}

/** 서버가 짚은 요청 필드(camelCase) — 없으면 `null`(폼 전체). 엉뚱한 칸을 짚지 않는다(W-3). */
export function validationFieldOf(error: unknown): string | null {
  return isApiError(error) && error.code === API_ERROR_CODE.VALIDATION_ERROR ? error.field : null;
}

/** 줄 삭제 실패 토스트(Case Matrix 「줄 삭제 실패」) — 모달은 닫히고 줄은 그대로 남는다. */
export const LINE_DELETE_FAILED_MESSAGE = "삭제하지 못했습니다";
/** 「회의 종료」 · 「다시 생성」 요청 자체가 실패했을 때(5xx · 네트워크) — 가리지 않는다. */
export const END_FAILED_MESSAGE = "회의를 종료하지 못했습니다";
export const INTEGRATE_FAILED_MESSAGE = "다시 생성을 시작하지 못했습니다";
