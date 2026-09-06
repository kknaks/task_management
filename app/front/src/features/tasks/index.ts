/**
 * `features/tasks` 가 **밖으로 내보내는 것**.
 *
 * WORK-005(상태 전이·목록)가 여기서만 가져간다 — 내부 파일 경로를 직접 파고들면 규격이
 * 그쪽에서 정해진다(검수 W-9 가 그 사례다).
 */

export { openTaskCreateDrawer, openTaskDetailDrawer } from "@/features/tasks/openTaskDrawers";
export { useCompletionCardFocus } from "@/features/tasks/hooks/useCompletionCardFocus";
export type { CompletionCardFocus } from "@/features/tasks/hooks/useCompletionCardFocus";
export { useTaskDetailQuery, useTaskMutations } from "@/features/tasks/hooks/useTaskMutations";
export type { TaskDetail, TaskStatus } from "@/features/tasks/types";
