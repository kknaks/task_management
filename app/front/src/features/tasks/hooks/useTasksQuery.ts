"use client";

/**
 * **리스트와 칸반이 같은 응답을 본다**(WP Phase 2). 두 뷰에 쿼리를 따로 만들지 않는다 —
 * 칸반은 같은 목록을 상태로 나눠 그릴 뿐이다.
 *
 * - **실패를 빈 목록으로 대체하지 않는다**(§4 Case Matrix · FE §3-5) — 호출자가 `error` 를
 *   받아 실패 표시 + 「다시 시도」를 그린다. `retry:false` 라 **「다시 시도」가 한 번만** 나간다
 * - **필터를 바꿀 때 화면이 비지 않는다**(U-11) — `placeholderData` 로 이전 결과를 유지하고
 *   위에 진행 표시만 둔다. 스켈레톤은 **첫 로딩에만**
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { fetchTasks } from "@/features/tasks/api";
import type { TasksListQuery } from "@/features/tasks/types";
import { queryKeys } from "@/lib/api/queryKeys";

export function useTasksQuery(query: TasksListQuery) {
  return useQuery({
    queryKey: queryKeys.tasksList({ ...query }),
    queryFn: () => fetchTasks(query),
    // 목록은 **열 때마다 새로** — 상태 전이가 다른 화면에서 일어날 수 있다.
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
}

/**
 * 칸반 4컬럼으로 나눈다 — **서버에 컬럼별 쿼리를 내지 않는다.**
 * 순서는 목록 정렬을 그대로 물려받는다(같은 응답이므로 리스트와 순서가 어긋나지 않는다).
 */
export const KANBAN_COLUMNS = ["todo", "in_progress", "done", "cancelled"] as const;
