"use client";

/**
 * **모든 `page.tsx` 는 `'use client'` 다**(frontend/README.md §1-3).
 * 라우트 파일은 껍데기고 화면 컴포넌트 하나를 렌더한다(§2 규칙 1).
 *
 * 리스트·칸반과 뷰 전환은 **`?view=`** 에 남는다 — 라우트를 쪼개지 않는다(§1-2).
 */

import { Suspense } from "react";

import { TasksScreen } from "@/features/tasks/components/TasksScreen";

export default function Page() {
  // `useSearchParams()` 는 정적 산출물에서 Suspense 경계를 요구한다(§1-2).
  return (
    <Suspense fallback={null}>
      <TasksScreen />
    </Suspense>
  );
}
