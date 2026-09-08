/**
 * 업무 영역의 **엔드포인트 호출 함수만** 둔다(frontend/README.md §2).
 * 모든 호출은 `lib/api/client.ts` 를 지난다(§2 규칙 5).
 *
 * **상태 전이 호출은 아래 `changeTaskStatus` 하나**다 — 전용 엔드포인트이고
 * 세 진입점이 `useTaskStatus.ts` 를 지나 이 함수 하나로 모인다(SPEC-004 §4).
 */

import { apiFetch } from "@/lib/api/client";
import type {
  CreateTaskInput,
  TaskDetail,
  TaskListItem,
  TaskListResponse,
  TaskStatusInput,
  TasksListQuery,
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
 * **연관업무 후보 검색은 `lib/api/tasks.ts` 로 올라갔다**(WORK-008 검수 F-1) — 업무 드로어와 회의록 U-9 드로어가 함께 부른다.
 * 실행취소(`undoTaskStatus`)도 같은 이유로 그쪽이다(완료 토스트 `lib/hooks/useTaskDoneToast`).
 */

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

// --- SPEC-004 목록 · 상태 전이 -------------------------------------------

/** `?` 에 실제로 값이 있는 것만 싣는다 — 서버가 「없음」과 「빈 문자열」을 구분한다. */
function toSearch(query: TasksListQuery): string {
  const search = new URLSearchParams({
    from: query.from,
    to: query.to,
    sort: query.sort,
    page: String(query.page),
    size: String(query.size),
  });
  if (query.workTypeId !== null) {
    search.set("workTypeId", String(query.workTypeId));
  }
  if (query.status !== null) {
    search.set("status", query.status);
  }
  if (query.projectId !== null) {
    search.set("projectId", String(query.projectId));
  }
  return search.toString();
}

export function fetchTasks(query: TasksListQuery): Promise<TaskListResponse> {
  return apiFetch<TaskListResponse>(`/api/tasks?${toSearch(query)}`, { cache: "no-store" });
}

/**
 * **상태 전이 — 전용 엔드포인트 하나**(SPEC-004 §4).
 *
 * 일반 `PATCH` 에 섞지 않는다: 완료 게이트 판정이 붙기 때문이다. 리스트 셀·상세 드롭다운·
 * 칸반 DnD·(WORK-008 의) 회의록이 **전부 이 하나를 지난다** — 그래서 이 함수를 부르는 곳도
 * **`useTaskStatus.ts` 하나**여야 한다(WP §Internal Interface Contract).
 */
export function changeTaskStatus(id: number, input: TaskStatusInput): Promise<TaskListItem> {
  return apiFetch<TaskListItem>(`/api/tasks/${id}/status`, { method: "PATCH", body: input });
}

/** **소프트 딜리트** — 목록·집계에서 빠지고 자식 행은 남는다(T-11). 복원 표면은 없다. */
export function deleteTask(id: number): Promise<void> {
  return apiFetch<void>(`/api/tasks/${id}`, { method: "DELETE" });
}
