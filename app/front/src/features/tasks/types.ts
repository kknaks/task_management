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
