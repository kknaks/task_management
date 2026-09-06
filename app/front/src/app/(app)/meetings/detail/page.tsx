"use client";

/**
 * **P-35/37/40 회의 상세 — 상태로 갈린다(F-10)** — 라우트 껍데기.
 *
 * **동적 세그먼트를 쓰지 않는다** — 식별은 `?id=` 다(FE §1-2). 스위치는 `MeetingDetailPage` 가 갖는다.
 */

import { Suspense } from "react";

import { MeetingDetailPage } from "@/features/meetings/components/MeetingDetailPage";

export default function Page() {
  // `useSearchParams` 는 정적 빌드에서 Suspense 경계를 요구한다(Next 규약).
  return (
    <Suspense fallback={null}>
      <MeetingDetailPage />
    </Suspense>
  );
}
