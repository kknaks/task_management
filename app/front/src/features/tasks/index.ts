/**
 * `features/tasks` 가 **밖으로 내보내는 것**.
 *
 * WORK-005(상태 전이·목록)가 여기서만 가져간다 — 내부 파일 경로를 직접 파고들면 규격이
 * 그쪽에서 정해진다(검수 W-9 가 그 사례다).
 *
 * **회의록(WORK-008 Phase 5)이 가져가는 것은 업무 상세 드로어(「결과 입력」 유도) 하나**다 — frontend/README.md §2 규칙 4 의
 * 단 하나의 예외(업무·회의 드로어의 재사용). 완료 토스트/실행취소 · 연관 업무 후보 검색 · 전이 그래프는 **드로어가 아니라서**
 * 이 배럴로 내주지 않고 `lib/hooks/useTaskDoneToast` · `lib/api/tasks` · `lib/taskStatus` 에 산다(WORK-008 검수 F-1 · G-5 와 같은 방식).
 * 업무 **생성 · 갱신 · 상태 전이 호출은 내보내지 않는다** — 회의록은 `/api/meetings/…/task` 로만 쓴다(SPEC-008 §4).
 */

export { openTaskCreateDrawer, openTaskDetailDrawer } from "@/features/tasks/openTaskDrawers";
/**
 * **연관업무 팝오버**(SPEC-003 U-8) — SPEC-008 U-9 가 「업무 화면의 `RelationPopover` 그대로 뜬다 · 그대로 재사용한다」고 못박아
 * 회의록 payload 드로어가 **같은 부품**을 쓴다(단일 선택 prop 하나만 더했다). 두 벌을 만들지 않으려고 배럴로 내준다 — §2 규칙 4 의 예외 둘째.
 */
export { RelationPopover } from "@/features/tasks/components/RelationPopover";
export { useCompletionCardFocus } from "@/features/tasks/hooks/useCompletionCardFocus";
export type { CompletionCardFocus } from "@/features/tasks/hooks/useCompletionCardFocus";
export { useTaskDetailQuery, useTaskMutations } from "@/features/tasks/hooks/useTaskMutations";
export type { TaskDetail, TaskStatus } from "@/features/tasks/types";
