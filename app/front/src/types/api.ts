/**
 * 백엔드 schema 계약의 **미러**(frontend/README.md §3-6). 키는 camelCase 그대로 쓴다.
 * **여기 없는 필드를 컴포넌트가 지어내지 않는다.** `any` 를 쓰지 않는다(§11).
 */

/** `GET /api/health` — SPEC-000 §4 Request / Response */
export interface HealthResponse {
  status: "ok";
  version: string;
  database: "ok";
}

/** `POST /api/auth/login` 요청 — SPEC-001 §4. **「유지」는 싣지 않는다**(서버가 알 필요 없다). */
export interface LoginRequest {
  loginId: string;
  password: string;
}

/**
 * `POST /api/auth/login` · `POST /api/auth/refresh` 응답.
 * **회전마다 셋 다 새로 온다** — 직전 refresh 는 즉시 무효다(A-7).
 */
export interface TokenBundle {
  accessToken: string;
  /** access 의 남은 수명(초). */
  expiresIn: number;
  refreshToken: string;
}

/** `GET /api/auth/session` 의 계정 요약. `id` 는 **number** 다(FE §3-6). */
export interface AccountSummary {
  id: number;
  loginId: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  /** 「현재」 경력에서 파생된 소속. 없으면 `null` 이고 사이드바 캡션을 비운다. */
  department: string | null;
}

export interface SessionResponse {
  account: AccountSummary;
}
