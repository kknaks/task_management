/** 연결 확인 화면이 쓰는 엔드포인트 호출 함수만 둔다(frontend/README.md §2). */

import { apiFetch } from "@/lib/api/client";
import type { HealthResponse } from "@/types/api";

/** `GET /api/health` — **인증 게이트 밖**이라 토큰을 붙이지 않는다(SPEC-000 §4). */
export function fetchHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/api/health", { cache: "no-store", publicSurface: true });
}
