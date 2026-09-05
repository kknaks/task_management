/**
 * `ApiError` · `code` 상수 — `frontend/README.md` §3-5.
 *
 * 화면은 **`code` 로 분기하고 `detail` 문구로 분기하지 않는다.**
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;

  constructor(status: number, code: string, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
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
} as const;

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
