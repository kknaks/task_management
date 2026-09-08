/**
 * 업무 자원 중 **다른 영역이 함께 부르는 엔드포인트 호출 함수만** 둔다(frontend/README.md §2 규칙 4·5).
 *
 * `features/tasks/api.ts` 에 있던 것을 **`lib/api/` 로 올렸다**(WORK-008 검수 F-1 · WORK-006 검수 W-1 → G-5 와 같은 방식) —
 * 연관 업무 후보 검색은 업무 생성·상세 드로어(`RelationPopover`)와 **회의록의 「+ 연관 업무」 드로어**(SPEC-008 U-9 · 기획 L84
 * 「내 업무가 제공」)가 같은 표면을 읽고, 실행취소는 완료 토스트(`lib/hooks/useTaskDoneToast`)가 부른다.
 * 영역 사이 import 는 금지이고 공유는 `lib/` 로 올린다 — `features/tasks` 배럴로 내주면 정적 검사 ⑨ 가 잡는다.
 *
 * **여기 없는 것** — 업무 생성 · 갱신 · 상태 전이(`changeTaskStatus`)는 `features/tasks/api.ts` 에 그대로다.
 * 회의록은 그 셋을 부르지 않는다(`/api/meetings/…/task` 로만 쓴다 — SPEC-008 §4 · 완료 게이트 우회 0).
 * 모든 호출은 `lib/api/client.ts` 를 지난다(§2 규칙 5).
 */

import { apiFetch } from "@/lib/api/client";
import type { TaskStatus } from "@/components/shared/StatusDot";
import type { TaskRelation } from "@/types/api";

// --- 연관 업무 후보 검색 ---------------------------------------------------

/**
 * **연관업무 후보 검색**(SPEC-003 §4, 2026-09-06 신설).
 *
 * 업무에 매달리지 않는 **컬렉션 표면**이고 정렬 근거를 쿼리로 받는다 — 생성 드로어에는
 * 자기 id 가 없기 때문이다. 표면을 둘로 두면 생성·상세가 다른 코드를 타고 정렬이 갈린다.
 *
 * - **상세 드로어**: `excludeId` 만 보낸다 — 서버가 그 업무의 `project`·`due` 를 쓰고
 *   **이미 연결된 것도 함께 제외**한다
 * - **생성 드로어**: `excludeId` 없이 **폼에 입력 중인** `projectId`·`dueDate` 를 보낸다
 * - **회의록 U-9 드로어**: 회의의 `projectId` 와 `scope` 만 보낸다
 */
/**
 * **필터 칩 3 과 1:1**(SPEC-003 §4 `scope` 표 · U-8).
 *
 * `projectId`·`dueDate` 가 **정렬 힌트**인 것과 달리 `scope` 는 **후보를 잘라내는 필터**다 —
 * 역할이 달라서 따로 있다. 칩이 필터인데 서버에 필터가 없으면 화면이 「전체 정렬본」을
 * 세 번 똑같이 보여주게 된다.
 */
export type RelationScope = "project" | "recent30" | "all";

export interface RelationCandidateQuery {
  keyword?: string;
  excludeId?: number | null;
  projectId?: number | null;
  dueDate?: string | null;
  scope?: RelationScope;
}

/** `total` 은 **`scope` 를 적용한 뒤의 총계**이고 `items` 는 거기서 상위 20건이다(§4). */
export interface RelationCandidatePage {
  items: TaskRelation[];
  total: number;
}

export async function fetchRelationCandidates(
  query: RelationCandidateQuery,
): Promise<RelationCandidatePage> {
  const search = new URLSearchParams();
  if (query.keyword && query.keyword.trim().length > 0) {
    search.set("keyword", query.keyword.trim());
  }
  if (query.excludeId != null) {
    search.set("excludeId", String(query.excludeId));
  }
  if (query.projectId != null) {
    search.set("projectId", String(query.projectId));
  }
  if (query.dueDate) {
    search.set("dueDate", query.dueDate);
  }
  if (query.scope) {
    search.set("scope", query.scope);
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  const response = await apiFetch<RelationCandidatePage>(
    `/api/tasks/relations/candidates${suffix}`,
    { cache: "no-store" },
  );
  // **`total` 을 `items.length` 로 대신하지 않는다** — 20건을 넘으면 갈리고,
  // 그게 「n건 중 m」 카운트가 있는 이유다(§4 · U-8).
  return { items: response.items, total: response.total };
}

// --- 상태 전이 실행취소 ----------------------------------------------------

/**
 * 서버 응답은 `TaskListItem` 전체(SPEC-004 §4)다. 부르는 곳(완료 토스트)이 읽는 것은 없고 `['tasks']` 를 무효화할 뿐이라
 * 업무 목록 타입을 `lib/` 로 끌어오지 않고 **응답의 부분 집합만** 적는다 — 지어낸 필드는 없다.
 */
export interface UndoTaskStatusResult {
  id: number;
  status: TaskStatus;
}

/**
 * 마지막 전이 되돌리기 — **직전 상태 복원 + 그 전이 로그 삭제**(4초 이내 · SPEC-004 §4).
 * 부르는 곳은 완료 토스트(`lib/hooks/useTaskDoneToast`) 하나다. 전이 자체(`changeTaskStatus`)는 여기 없다.
 */
export function undoTaskStatus(id: number): Promise<UndoTaskStatusResult> {
  return apiFetch<UndoTaskStatusResult>(`/api/tasks/${id}/status/undo`, { method: "POST" });
}
