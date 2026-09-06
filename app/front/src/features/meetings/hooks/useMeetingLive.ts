"use client";

/**
 * 회의 중 화면의 **조회 쿼리**(SPEC-007 §4 · WP 캐시 키 행).
 *
 * - 트랜스크립트 `['meetings','transcript',id]` — 진입 시 1회. 이후는 `useMeetingStream` 이 WS `transcript.final` 로 append 한다
 * - 실패는 **가리지 않는다** — 우 패널에 「불러오지 못했습니다」 + 「다시 시도」(Case Matrix). 빈 목록으로 대체하지 않는다
 * - 상세는 `useMeetingDetail`(WORK-006) 그대로다
 */

import { useQuery } from "@tanstack/react-query";

import { fetchTranscript } from "@/features/meetings/api";
import type { TranscriptResponse } from "@/features/meetings/types";
import { queryKeys } from "@/lib/api/queryKeys";

export function useTranscriptQuery(meetingId: number) {
  return useQuery({
    queryKey: queryKeys.meetingTranscript(meetingId),
    queryFn: () => fetchTranscript(meetingId),
    // WS 가 append 하는 캐시다 — 포커스·마운트로 되감지 않는다(재조회는 「다시 시도」와 `ready` 따라잡기뿐).
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** 「화자 k명」 — 응답 `speakerCount` 와 실제 라벨 수 중 큰 쪽. 0 이면 숨긴다(U-5). */
export function speakerCountOf(transcript: TranscriptResponse | undefined): number {
  if (!transcript) {
    return 0;
  }
  return Math.max(transcript.speakerCount, new Set(transcript.items.map((item) => item.speakerLabel)).size);
}
