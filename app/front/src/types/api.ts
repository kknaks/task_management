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

/**
 * 허용 색 팔레트 8종의 **토큰명**(SPEC-002 §4 Data Contract).
 *
 * **여기서 다시 나열하지 않는다** — 목록의 프론트 정본은 `lib/palette.ts` 의 `PALETTE_TOKENS`
 * 하나이고 이 타입은 거기서 파생한다(검수 W-1). 손으로 두 번 적으면 유니온에만 더했을 때
 * 팝오버에서 조용히 빠진다.
 */
import type { ColorToken } from "@/lib/palette";

export type { ColorToken };

/** 유형의 종류. **저장·전송 모두 영문 소문자**이고 화면의 「미팅」/「업무」는 표시 매핑이다(DB G-4). */
export type WorkTypeKind = "meeting" | "task";

/** `GET /api/work-types` 의 항목 — SPEC-002 §4 Data Contract */
export interface WorkType {
  id: number;
  kind: WorkTypeKind;
  name: string;
  colorToken: ColorToken;
  /** 기본 유형 3종. **이름·종류 고정, 삭제 불가, 색만 편집**(A-4) */
  isDefault: boolean;
}

/** `GET /api/projects` 의 항목. 유형과 달리 **종류가 없다**(이름 + 색뿐 — DEC-001 §3). */
export interface Project {
  id: number;
  name: string;
  colorToken: ColorToken;
}

/** 목록 응답 봉투. **`items` 를 꺼내는 것은 영역별 `api.ts` 까지**이고 훅 위로는 배열이 올라간다(§3-6). */
export interface ListResponse<T> {
  items: T[];
}
