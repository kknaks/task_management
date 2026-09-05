/**
 * SPEC-002 §4 Case Matrix 를 화면 문구로 옮기는 곳 하나.
 *
 * **화면은 `code` 로 분기하고 `detail` 문구로 분기하지 않는다**(frontend/README.md §3-5).
 * 여기서 나온 문구는 **그 항목 옆 인라인**으로 붙고, 자동 저장 실패의 토스트는 U-7 규격이 따로 만든다.
 */

import { API_ERROR_CODE, isApiError } from "@/lib/api/errors";

/** 「유형」/「프로젝트」로 갈리는 문구가 있어 대상을 받는다. */
export type SettingEntity = "workType" | "project";

/**
 * **문구를 템플릿으로 만들지 않는다.** SPEC-002 Case Matrix 가 「같은 이름의 **유형이**」 /
 * 「같은 이름의 **프로젝트가**」로 조사를 갈라 적었다 — `${label}가` 로 묶으면 「유형가」가 나온다.
 */
const DUPLICATE_NAME_MESSAGE: Record<SettingEntity, string> = {
  workType: "같은 이름의 유형이 이미 있습니다",
  project: "같은 이름의 프로젝트가 이미 있습니다",
};


/**
 * 인라인에 붙일 사유. **`null` 이면 인라인이 아니라 토스트로 갈 실패**다
 * (5xx·네트워크 — 사유를 폼 옆에 붙이지 않는다).
 */
export function inlineErrorMessage(error: unknown, entity: SettingEntity): string | null {
  if (!isApiError(error)) {
    return null;
  }

  switch (error.code) {
    case API_ERROR_CODE.DUPLICATE_NAME:
      return DUPLICATE_NAME_MESSAGE[entity];
    case API_ERROR_CODE.VALIDATION_ERROR:
      return "이름은 1~30자로 입력해 주세요";
    case API_ERROR_CODE.WORK_TYPE_LOCKED:
      // 토스트로 흘리지 않는다 — **해당 항목 옆 인라인 안내**다(Case Matrix).
      return error.detail;
    case API_ERROR_CODE.INVALID_COLOR_TOKEN:
      return "허용된 색이 아닙니다";
    default:
      return null;
  }
}

/** 없는 항목·남의 항목 — 토스트 + 목록 갱신(Case Matrix). */
export function isNotFound(error: unknown): boolean {
  return isApiError(error) && error.code === API_ERROR_CODE.NOT_FOUND;
}

/** U-7 토스트 문구 — 「저장하지 못했습니다 · <필드 이름>」. 실행취소를 붙이지 않는다. */
export function autoSaveErrorToast(fieldLabel: string): string {
  return `저장하지 못했습니다 · ${fieldLabel}`;
}
