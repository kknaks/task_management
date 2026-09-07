/**
 * 유형·프로젝트의 **엔드포인트 호출 함수만** 둔다(frontend/README.md §2).
 *
 * `features/settings` 에 있던 것을 **`lib/api/` 로 올렸다**(WORK-006 검수 W-1) — 업무 설정 화면뿐
 * 아니라 업무·회의 드로어의 셀렉터가 같은 목록을 읽고 「+ 새 프로젝트로 추가」가 같은 생성을 부른다.
 * 영역 사이 import 는 금지이고(§2 규칙 4) 공유는 `lib/` 로 올린다.
 *
 * **`items` 를 꺼내는 것은 이 파일까지**다 — 훅 위로는 배열이 올라간다(§3-6 · SPEC-002 §4).
 * 모든 호출은 `lib/api/client.ts` 를 지난다(§2 규칙 5).
 */

import { apiFetch } from "@/lib/api/client";
import type { ColorToken, ListResponse, Project, WorkType, WorkTypeKind } from "@/types/api";

// --- 유형 -----------------------------------------------------------------

export async function fetchWorkTypes(): Promise<WorkType[]> {
  const response = await apiFetch<ListResponse<WorkType>>("/api/work-types", {
    cache: "no-store",
  });
  return response.items;
}

export interface CreateWorkTypeInput {
  /** **생성 시에만** 정해진다. PATCH 에는 이 필드가 없다(SPEC-002 §5). */
  kind: WorkTypeKind;
  name: string;
  colorToken: ColorToken;
  /** 선택 — 안 보내면 `null` 로 생긴다(A-12 · MF-21). */
  description?: string | null;
}

export function createWorkType(input: CreateWorkTypeInput): Promise<WorkType> {
  return apiFetch<WorkType>("/api/work-types", { method: "POST", body: input });
}

/**
 * 부분 수정. **보낸 필드만 바뀐다** — 인라인 자동 저장이 필드 하나만 보내기 때문이다(§4).
 * `kind` 를 받지 않는 것이 계약이다.
 */
export type UpdateWorkTypeInput =
  | { name: string }
  | { colorToken: ColorToken }
  /** **`description` 만 `null` 을 받는다** — 「설명을 지운다」(SPEC-002 §4). 기본 유형 3종도 색과 설명은 바꿀 수 있다. */
  | { description: string | null };

export function updateWorkType(id: number, input: UpdateWorkTypeInput): Promise<WorkType> {
  return apiFetch<WorkType>(`/api/work-types/${id}`, { method: "PATCH", body: input });
}

export function deleteWorkType(id: number): Promise<void> {
  return apiFetch<void>(`/api/work-types/${id}`, { method: "DELETE" });
}

// --- 프로젝트 -------------------------------------------------------------

export async function fetchProjects(): Promise<Project[]> {
  const response = await apiFetch<ListResponse<Project>>("/api/projects", { cache: "no-store" });
  return response.items;
}

export interface CreateProjectInput {
  name: string;
  colorToken: ColorToken;
}

export function createProject(input: CreateProjectInput): Promise<Project> {
  return apiFetch<Project>("/api/projects", { method: "POST", body: input });
}

export type UpdateProjectInput = { name: string } | { colorToken: ColorToken };

export function updateProject(id: number, input: UpdateProjectInput): Promise<Project> {
  return apiFetch<Project>(`/api/projects/${id}`, { method: "PATCH", body: input });
}

export function deleteProject(id: number): Promise<void> {
  return apiFetch<void>(`/api/projects/${id}`, { method: "DELETE" });
}
