"use client";

/**
 * **P-23 업무 상세 전체 페이지** — 라우트 껍데기.
 *
 * **동적 세그먼트를 쓰지 않는다** — 식별은 `?id=` 다(FE §1-2). 쿼리 파싱은 영역 훅 하나가 한다.
 */

import { Suspense } from "react";

import { TaskDetailPage } from "@/features/tasks/components/TaskDetailPage";

export default function Page() {
  // `useSearchParams` 는 정적 빌드에서 Suspense 경계를 요구한다(Next 규약).
  return (
    <Suspense fallback={null}>
      <TaskDetailPage />
    </Suspense>
  );
}
