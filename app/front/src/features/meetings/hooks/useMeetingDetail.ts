"use client";

/**
 * 회의 상세 쿼리 — `['meetings','detail',id]`(FE §3-3).
 *
 * **미리보기 패널과 상세 페이지가 같은 키를 본다**(SPEC-006 U-8 기대 결과) — 한쪽이 갱신되면
 * 다른 쪽도 따라온다. 상세는 **열 때마다 새로**(§3-2 `staleTime 0`).
 */

import { useQuery } from "@tanstack/react-query";

import { fetchMeeting } from "@/features/meetings/api";
import { queryKeys } from "@/lib/api/queryKeys";

export function useMeetingDetail(id: number | null) {
  return useQuery({
    queryKey: queryKeys.meetingDetail(id ?? 0),
    queryFn: () => fetchMeeting(id as number),
    enabled: id !== null,
    staleTime: 0,
  });
}
