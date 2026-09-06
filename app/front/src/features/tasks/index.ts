/**
 * `features/tasks` 가 **밖으로 내보내는 것**.
 *
 * WORK-005(상태 전이·목록)가 여기서만 가져간다 — 내부 파일 경로를 직접 파고들면 규격이
 * 그쪽에서 정해진다(검수 W-9 가 그 사례다).
 *
 * **회의록(WORK-008 Phase 5)이 가져가는 것** — 업무 상세 드로어(「결과 입력」 유도) · 완료 토스트/실행취소 ·
 * 연관 업무 후보 검색(`GET /api/tasks/relations/candidates` — 기획 L84 「내 업무가 제공」) · 전이 그래프(U-9 상태 셀렉터의 항목).
 * 업무 **생성 · 갱신 · 상태 전이 호출은 내보내지 않는다** — 회의록은 `/api/meetings/…/task` 로만 쓴다(SPEC-008 §4).
 */

export { openTaskCreateDrawer, openTaskDetailDrawer } from "@/features/tasks/openTaskDrawers";
export { useCompletionCardFocus } from "@/features/tasks/hooks/useCompletionCardFocus";
export type { CompletionCardFocus } from "@/features/tasks/hooks/useCompletionCardFocus";
export { useTaskDetailQuery, useTaskMutations } from "@/features/tasks/hooks/useTaskMutations";
export type { TaskDetail, TaskStatus } from "@/features/tasks/types";
export { useTaskDoneToast } from "@/features/tasks/hooks/useTaskDoneToast";
export { fetchRelationCandidates } from "@/features/tasks/api";
export type { RelationCandidatePage, RelationCandidateQuery, RelationScope } from "@/features/tasks/api";
export { canTransition } from "@/features/tasks/statusTransitions";
export type { TaskRelation } from "@/features/tasks/types";
