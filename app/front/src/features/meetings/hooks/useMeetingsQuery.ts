"use client";

/**
 * 회의록 목록 쿼리 — `['meetings','list',{…}]`(SPEC-006 U-2 · FE §3-3).
 *
 * - **실패를 빈 목록으로 대체하지 않는다**(§4 Case Matrix · FE §3-5) — 호출자가 `error` 를
 *   받아 실패 표시 + 「다시 시도」를 그린다. `retry:false` 라 **「다시 시도」가 한 번만** 나간다
 * - **달·필터를 바꿀 때 화면이 비지 않는다**(U-2 로딩) — `placeholderData` 로 이전 결과를
 *   유지하고 위에 얇은 진행 표시만 둔다. 스켈레톤은 **첫 로딩에만**
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { fetchMeetings } from "@/features/meetings/api";
import type { MeetingsListQuery } from "@/features/meetings/types";
import { queryKeys } from "@/lib/api/queryKeys";

export function useMeetingsQuery(query: MeetingsListQuery) {
  return useQuery({
    queryKey: queryKeys.meetingsList({ ...query }),
    queryFn: () => fetchMeetings(query),
    // 목록은 **열 때마다 새로** — 상태 전이가 다른 창에서 일어날 수 있다.
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
}
