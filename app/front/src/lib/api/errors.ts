/**
 * `ApiError` · `code` 상수 — `frontend/README.md` §3-5.
 *
 * 화면은 **`code` 로 분기하고 `detail` 문구로 분기하지 않는다.**
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  /**
   * **어느 입력이 틀렸는가** — 응답 본문에 `field` 가 실려 오면 그대로 든다(요청 본문의 키 이름).
   * 지금 백엔드 응답은 `{detail, code}` 뿐이라 **대개 비어 있다**(SPEC-006 검수 G-2) — 화면은
   * 있으면 그 컨트롤에, 없으면 **폼 전체**에 붙이고 엉뚱한 칸을 짚지 않는다(W-3).
   */
  readonly field: string | null;

  constructor(status: number, code: string, detail: string, field: string | null = null) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.field = field;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * 백엔드가 내는 `code`. 응답 형태는 `{"detail","code"}` 고정이다(backend/README.md §8-2).
 * 화면이 분기하는 키가 여기 있고, 나머지는 각 work 가 추가한다.
 */
export const API_ERROR_CODE = {
  DB_UNAVAILABLE: "db_unavailable",
  /** 자격 증명 실패 — 로그인 폼 **인라인**. 횟수를 세거나 잠그지 않는다(DEC-001 §4). */
  INVALID_CREDENTIALS: "invalid_credentials",
  /** 입력값 검증 실패. 정상 경로에서는 버튼이 비활성이라 도달하지 않는다. */
  VALIDATION_ERROR: "validation_error",
  /** access 만료 — **화면이 모른다.** client 가 갱신 1회로 삼킨다(SPEC-001 §4). */
  TOKEN_EXPIRED: "token_expired",
  /** refresh 만료·재사용 감지 — 토큰 폐기 후 로그인 화면(SPEC-001 §4 · S001-OQ-2). */
  INVALID_REFRESH_TOKEN: "invalid_refresh_token",
  /** v2 게이트가 샜을 때의 안전망. 정상 경로가 아니다. */
  V2_NOT_AVAILABLE: "v2_not_available",

  /** 같은 계정에서 삭제되지 않은 것끼리 이름이 겹쳤다(SPEC-002 §4). */
  DUPLICATE_NAME: "duplicate_name",
  /** 기본 유형 3종의 이름·종류 변경과 삭제(A-4). **서버 판정이 정본**이다. */
  WORK_TYPE_LOCKED: "work_type_locked",
  /** 팔레트 밖 토큰명·임의 hex(A-5). */
  INVALID_COLOR_TOKEN: "invalid_color_token",
  /** 없는 항목·남의 항목. **존재를 흘리지 않는다**(SPEC-002 §5). */
  NOT_FOUND: "not_found",

  /** 삭제된 유형을 골랐다(SPEC-003 §4 Case Matrix). */
  INVALID_WORK_TYPE: "invalid_work_type",
  /**
   * 삭제된 프로젝트를 골랐다 — **2026-09-06 신설**(SPEC-003 §4).
   * 그전엔 `validation_error` 로 합류해 **화면이 유형과 프로젝트를 구분할 수 없었다** —
   * 상세에 두 셀렉터가 나란히 생기면서 어디가 틀렸는지 못 짚는 문제가 실제가 됐다.
   */
  INVALID_PROJECT: "invalid_project",
  /** 시간까지 지정한 기한이 다른 일정과 겹친다(DEC-005 §7). **저장되지 않는다.** */
  SCHEDULE_OVERLAP: "schedule_overlap",
  /** 자료함 첨부는 md 문서만(T-9 · DEC-004 §8). */
  UNSUPPORTED_FILE_TYPE: "unsupported_file_type",

  /**
   * **완료 게이트가 막았다**(422 · SPEC-004 §4 · T-5) — 결과자료 ≥1 또는 완료 결과가 없다.
   * **상태가 바뀌지 않는다.** 세 진입점이 같은 문구로 거부된다.
   */
  TASK_COMPLETION_BLOCKED: "task_completion_blocked",
  /** 전이 그래프 밖이다(409 · T-6). **같은 상태로 다시 보내도 이 코드**다. */
  INVALID_STATUS_TRANSITION: "invalid_status_transition",
  /** 실행취소 조건 3개(마지막 로그가 전이 · 그 뒤 변경 없음 · 4초 이내)를 못 채웠다(409). */
  UNDO_NOT_AVAILABLE: "undo_not_available",

  /**
   * **회의 상태 가드**(409 · SPEC-006 §4 상태별 허용 표) — 지금 `status` 에서 허용되지 않는 쓰기.
   * 화면 처리는 하나다: **토스트 + 상세 재조회**(화면이 낡은 것이 원인). 정상 경로에서는
   * 버튼·메뉴가 비활성이라 닿지 않는다. SPEC-007 의 `meeting_not_recording` 은 **이 코드로 합쳐졌다**.
   */
  INVALID_MEETING_STATUS: "invalid_meeting_status",
} as const;

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
 * 유형·프로젝트 **생성·수정이 거절됐을 때 인라인에 붙일 사유**(SPEC-002 §4 Case Matrix).
 * **`null` 이면 인라인이 아니라 토스트로 갈 실패**다(5xx·네트워크 — 사유를 폼 옆에 붙이지 않는다).
 *
 * 설정 패널과 업무·회의 드로어의 「+ 새 프로젝트로 추가」가 같은 문구를 쓴다 — 그래서
 * `features/settings` 가 아니라 여기 산다(FE §2 규칙 4 · WORK-006 검수 W-1).
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

/**
 * **클라이언트에서만 만들어지는 code.** 서버가 응답하지 못한 실패라 `status` 가 없다(0).
 * SPEC-000 §4 Case Matrix 의 「네트워크 실패」·「CORS 차단」 두 행이 여기다.
 */
export const CLIENT_ERROR_CODE = {
  /** 요청이 서버에 닿지 못했다 — 서버가 꺼져 있거나 주소가 틀렸다. */
  NETWORK_UNREACHABLE: "network_unreachable",
  /** 서버는 살아 있는데 브라우저가 응답을 막았다 — 허용 origin 목록 문제. */
  CORS_BLOCKED: "cors_blocked",
} as const;
