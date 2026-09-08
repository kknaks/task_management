"use client";

/**
 * **P-33 회의록 목록 + 우측 미리보기** — 라우트 껍데기(frontend/README.md §1 · §2 규칙 1).
 *
 * **모든 `page.tsx` 는 `'use client'` 다**(§1-3). 달·필터·선택은 **쿼리스트링**에 남는다(§1-2).
 */

import { Suspense } from "react";

import { MeetingsScreen } from "@/features/meetings/components/MeetingsScreen";

export default function Page() {
  // `useSearchParams()` 는 정적 산출물에서 Suspense 경계를 요구한다(§1-2).
  return (
    <Suspense fallback={null}>
      <MeetingsScreen />
    </Suspense>
  );
}
