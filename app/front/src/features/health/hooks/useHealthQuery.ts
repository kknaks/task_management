"use client";

import { useQuery } from "@tanstack/react-query";

import { fetchHealth } from "@/features/health/api";
import { queryKeys } from "@/lib/api/queryKeys";

/**
 * 헬스 조회.
 *
 * **자동 재시도가 없다**(전역 `retry:false` — FE §3-2 · SPEC-000 §5 헬스 규칙).
 * 재요청은 사용자가 「다시 확인」을 누를 때 `refetch()` 로 **한 번만** 나간다.
 */
export function useHealthQuery() {
  return useQuery({
    queryKey: queryKeys.health(),
    queryFn: fetchHealth,
    // 매번 새로 확인한다 — 「연결됐다」를 캐시로 보여주면 안 된다.
    staleTime: 0,
    gcTime: 0,
  });
}
