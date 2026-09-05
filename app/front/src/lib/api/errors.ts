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
 * WORK-001 이 마주치는 것은 `db_unavailable` 하나뿐 — 나머지는 각 work 가 추가한다.
 */
export const API_ERROR_CODE = {
  DB_UNAVAILABLE: "db_unavailable",
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
