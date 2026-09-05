"use client";

/**
 * **모든 `page.tsx` 는 `'use client'` 다**(frontend/README.md §1-3).
 * 라우트 파일은 껍데기고 화면 컴포넌트 하나를 렌더한다(§2 규칙 1).
 *
 * 목록·칸반은 **WORK-005** 가 이 자리를 대체한다.
 */

import { TasksEntryScreen } from "@/features/tasks/components/TasksEntryScreen";

export default function Page() {
  return <TasksEntryScreen />;
}
