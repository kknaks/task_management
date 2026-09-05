/**
 * 업무 영역의 응답·요청 타입 — **백엔드 schema 의 미러**(SPEC-003 §4 · FE §3-6).
 * **여기 없는 필드를 컴포넌트가 지어내지 않는다.** `any` 를 쓰지 않는다(§11).
 */

import type { TaskStatus } from "@/components/shared/StatusDot";
import type { ColorToken } from "@/lib/palette";

export type { TaskStatus };

/**
 * 업무가 참조하는 유형·프로젝트 요약.
 *
 * **삭제(소프트)된 것은 `isDeleted: true` 로 실려 온다** — 이름·색을 그대로 보여주기
 * 위해서다(A-6). 선택 목록에는 나오지 않는다(SPEC-003 §4).
 */
export interface TaskRefSummary {
  id: number;
  name: string;
  colorToken: ColorToken | string;
  isDeleted: boolean;
}

export interface TaskWorkTypeSummary extends TaskRefSummary {
  kind: "meeting" | "task";
}

export interface TaskTodo {
  id: number;
  text: string;
  done: boolean;
  dueDate: string | null;
}

export interface TaskMemo {
  id: number;
  text: string;
  createdAt: string;
}

export interface TaskAttachment {
  id: number;
  role: "reference" | "deliverable";
  kind: "doc" | "link";
  name: string;
  documentId: number | null;
  folderPath: string | null;
  url: string | null;
}

export interface TaskRelation {
  id: number;
  title: string;
  status: TaskStatus;
  projectName: string | null;
  dueDate: string | null;
}

export interface TaskLog {
  id: number;
  text: string;
  createdAt: string;
}

/** `GET /api/tasks/{id}` — SPEC-003 §4 Request / Response */
export interface TaskDetail {
  id: number;
  title: string;
  status: TaskStatus;
  workType: TaskWorkTypeSummary;
  project: TaskRefSummary | null;
  dueDate: string | null;
  dueStartTime: string | null;
  dueEndTime: string | null;
  /** **파생값** — 서버가 계산해 내려준다. 화면이 다시 계산하지 않는다(G-7 · FE §3-6). */
  dDay: number | null;
  isOverdue: boolean;
  background: string | null;
  goal: string | null;
  completionResult: string | null;
  cancelReason: string | null;
  todos: TaskTodo[];
  /** 파생값. 화면이 다시 세지 않는다. */
  todoProgress: { done: number; total: number };
  memos: TaskMemo[];
  attachments: TaskAttachment[];
  /** **최근 5건**만 담는다. 전체 수는 `relationTotal`(06-related-tasks). */
  relations: TaskRelation[];
  relationTotal: number;
  logs: TaskLog[];
  createdAt: string;
  updatedAt: string;
}

/** `POST /api/tasks` — 드로어에 넣은 것이 **한 번에** 간다(§5 「절반만 저장되는 상태가 없다」). */
export interface CreateTaskInput {
  title: string;
  workTypeId: number;
  projectId?: number | null;
  dueDate?: string | null;
  dueStartTime?: string | null;
  dueEndTime?: string | null;
  background?: string | null;
  goal?: string | null;
  todos?: { text: string }[];
  attachments?: { role: "reference" | "deliverable"; kind: "link"; url: string; label?: string | null }[];
  relatedTaskIds?: number[];
}

/**
 * `PATCH /api/tasks/{id}` — **보낸 필드만 바뀐다.**
 * **`status` 가 없다** — 상태 전이는 전용 엔드포인트이고 SPEC-004(WORK-005) 몫이다.
 */
export type UpdateTaskInput =
  | { title: string }
  | { background: string | null }
  | { goal: string | null }
  | { completionResult: string | null }
  | { workTypeId: number }
  | { projectId: number | null }
  | { dueDate: string | null; dueStartTime?: string | null; dueEndTime?: string | null };

// --- SPEC-004 목록 · 상태 전이 -------------------------------------------

/**
 * `GET /api/tasks` 의 **목록 항목**. 상세(`TaskDetail`)와 **다른 형태**다 —
 * 목록은 파생값(`overdueDays`·`memoCount`)을 더 들고 자식 컬렉션을 들지 않는다.
 *
 * **`overdueDays` 는 목록에만 있다**(상세 계약에 없다 — SPEC-003 이 안 정했다).
 * 상세에서 지연 일수를 그려야 하면 목록에서 받은 값을 쓰고, **화면이 다시 계산하지 않는다**(T-4).
 */
export interface TaskListItem {
  id: number;
  title: string;
  status: TaskStatus;
  workType: TaskWorkTypeSummary;
  project: TaskRefSummary | null;
  dueDate: string | null;
  dueStartTime: string | null;
  dueEndTime: string | null;
  dDay: number | null;
  isOverdue: boolean;
  overdueDays: number | null;
  memoCount: number;
  todoProgress: { done: number; total: number };
  cancelReason: string | null;
  cancelledAt: string | null;
}

/**
 * 유형 탭에 붙는 수. **그 기간에 업무가 있는 유형만 담긴다**(+전체) —
 * 0건 유형은 **행이 아예 없으므로 화면이 0 을 그린다**(없는 키로 탭을 감추지 않는다).
 */
export interface TaskTypeCount {
  workTypeId: number | null;
  name: string;
  count: number;
}

/**
 * 상태별 총계 — **`typeCounts` 와 같은 결**이다(SPEC-004 §4, 2026-09-06 신설).
 * 기간·유형·프로젝트 필터는 반영하고 **상태 필터 자신은 반영하지 않는다.**
 *
 * 칸반 완료 컬럼의 「8월 12」가 여기서 온다 — **받아온 카드를 세지 않는다.**
 * 세면 「그 달 완료 건수」가 아니라 「지금 받아온 것 중 완료 건수」가 되고,
 * 상한 500 에 걸리는 순간 두 수가 조용히 갈린다(검수 F-2).
 */
export interface TaskStatusCounts {
  todo: number;
  inProgress: number;
  done: number;
  cancelled: number;
}

export interface TaskListResponse {
  items: TaskListItem[];
  total: number;
  page: number;
  size: number;
  typeCounts: TaskTypeCount[];
  statusCounts: TaskStatusCounts;
  /** **기간만** 적용한 총계 — U-9 「필터를 지우면 **n건이** 보입니다」의 `n`. */
  unfilteredTotal: number;
}

/** 정렬 3종(SPEC-004 §4 Validation). 기본 `due_asc` — **기한 없는 업무가 맨 아래**다. */
export type TaskSort = "due_asc" | "due_desc" | "created_desc";

/** `?view=` — 리스트·칸반(FE §1-2 Q-32). */
export type TasksView = "list" | "board";

/** `GET /api/tasks` 쿼리. **전부 `?` 에 남는다** — 컴포넌트가 자체 상태로 들지 않는다. */
export interface TasksListQuery {
  from: string;
  to: string;
  workTypeId: number | null;
  status: TaskStatus | null;
  projectId: number | null;
  sort: TaskSort;
  page: number;
  size: number;
}

/**
 * `PATCH /api/tasks/{id}/status` — **세 진입점 공통**.
 * `cancelReason` 은 `cancelled` 일 때만 받는다(T-7). `logCancelReason` 기본 참.
 */
export interface TaskStatusInput {
  status: TaskStatus;
  cancelReason?: string;
  logCancelReason?: boolean;
}
