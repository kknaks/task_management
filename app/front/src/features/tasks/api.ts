/**
 * 업무 영역의 **엔드포인트 호출 함수만** 둔다(frontend/README.md §2).
 * 모든 호출은 `lib/api/client.ts` 를 지난다(§2 규칙 5).
 *
 * **상태 전이 호출이 없다** — 전용 엔드포인트이고 SPEC-004(WORK-005)가 소유한다(SPEC-003 §4).
 */

import { apiFetch } from "@/lib/api/client";
import type {
  CreateTaskInput,
  TaskDetail,
  TaskRelation,
  UpdateTaskInput,
} from "@/features/tasks/types";

export function createTask(input: CreateTaskInput): Promise<TaskDetail> {
  return apiFetch<TaskDetail>("/api/tasks", { method: "POST", body: input });
}

export function fetchTask(id: number): Promise<TaskDetail> {
  return apiFetch<TaskDetail>(`/api/tasks/${id}`, { cache: "no-store" });
}

export function updateTask(id: number, input: UpdateTaskInput): Promise<TaskDetail> {
  return apiFetch<TaskDetail>(`/api/tasks/${id}`, { method: "PATCH", body: input });
}

// --- 할일 -----------------------------------------------------------------

/**
 * **자식 컬렉션의 쓰기 표면은 전부 갱신된 `TaskDetail` 을 돌려준다**(SPEC-003 §4, 2026-09-06 확정).
 * 부분 응답을 주지 않는다 — 자식 하나를 건드리면 로그 한 줄이 늘고 `todoProgress`·파생값이 함께
 * 바뀌므로, 부분 응답이면 화면이 나머지를 다시 조립해야 하고 그 조립 규칙이 화면마다 갈린다.
 * **삭제만 `204`** 다.
 */
export function addTodo(taskId: number, text: string): Promise<TaskDetail> {
  return apiFetch<TaskDetail>(`/api/tasks/${taskId}/todos`, { method: "POST", body: { text } });
}

export function updateTodo(
  taskId: number,
  todoId: number,
  input: { text?: string; done?: boolean },
): Promise<TaskDetail> {
  return apiFetch<TaskDetail>(`/api/tasks/${taskId}/todos/${todoId}`, {
    method: "PATCH",
    body: input,
  });
}

export function deleteTodo(taskId: number, todoId: number): Promise<void> {
  return apiFetch<void>(`/api/tasks/${taskId}/todos/${todoId}`, { method: "DELETE" });
}

// --- 메모 · 첨부 · 연관 ----------------------------------------------------

export function addMemo(taskId: number, text: string): Promise<TaskDetail> {
  return apiFetch<TaskDetail>(`/api/tasks/${taskId}/memos`, { method: "POST", body: { text } });
}

/**
 * 첨부 추가. **이 work 는 `kind=link` 만 보낸다** — `kind=doc` 은 문서함이 아직 없어
 * 서버가 거부한다(T-9 · WP Phase 4 스텁).
 */
export function addAttachment(
  taskId: number,
  input: { role: "reference" | "deliverable"; url: string; label: string | null },
): Promise<TaskDetail> {
  return apiFetch<TaskDetail>(`/api/tasks/${taskId}/attachments`, {
    method: "POST",
    body: { role: input.role, kind: "link", url: input.url, label: input.label },
  });
}

export function deleteAttachment(taskId: number, attachmentId: number): Promise<void> {
  return apiFetch<void>(`/api/tasks/${taskId}/attachments/${attachmentId}`, { method: "DELETE" });
}

/**
 * **연관업무 후보 검색**(SPEC-003 §4, 2026-09-06 신설).
 *
 * 업무에 매달리지 않는 **컬렉션 표면**이고 정렬 근거를 쿼리로 받는다 — 생성 드로어에는
 * 자기 id 가 없기 때문이다. 표면을 둘로 두면 생성·상세가 다른 코드를 타고 정렬이 갈린다.
 *
 * - **상세 드로어**: `excludeId` 만 보낸다 — 서버가 그 업무의 `project`·`due` 를 쓰고
 *   **이미 연결된 것도 함께 제외**한다
 * - **생성 드로어**: `excludeId` 없이 **폼에 입력 중인** `projectId`·`dueDate` 를 보낸다
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

/** 연관 연결도 같은 계약이다 — **갱신된 `TaskDetail`**(§4 자식 컬렉션 응답 절 · 검수 W-7). */
export function linkRelations(taskId: number, taskIds: number[]): Promise<TaskDetail> {
  return apiFetch<TaskDetail>(`/api/tasks/${taskId}/relations`, {
    method: "POST",
    body: { taskIds },
  });
}

export function unlinkRelation(taskId: number, otherTaskId: number): Promise<void> {
  return apiFetch<void>(`/api/tasks/${taskId}/relations/${otherTaskId}`, { method: "DELETE" });
}
