/**
 * 백엔드 schema 계약의 **미러**(frontend/README.md §3-6). 키는 camelCase 그대로 쓴다.
 * **여기 없는 필드를 컴포넌트가 지어내지 않는다.** `any` 를 쓰지 않는다(§11).
 *
 * WORK-001 이 여는 표면은 헬스 하나다(SPEC-000 §4).
 */

/** `GET /api/health` — SPEC-000 §4 Request / Response */
export interface HealthResponse {
  status: "ok";
  version: string;
  database: "ok";
}
