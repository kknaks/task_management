"use client";

/**
 * 업무 설정의 쿼리·뮤테이션 — `['workTypes']`·`['projects']`(frontend/README.md §3-3).
 *
 * **낙관적 갱신을 하지 않는다.** 이름 중복·기본 유형 잠금·팔레트 검사가 **거부할 수 있는**
 * 변경이라, 서버 응답을 받고 반영한다(§3-4 원칙 · SPEC-002 §4).
 *
 * 무효화 — 유형·프로젝트가 바뀌면 배지 이름·색이 딸린 `['tasks']`·`['meetings']` 도 함께
 * 무효화한다(§3-3 표). **그 키를 읽는 화면이 아직 없어 지금은 no-op** 이지만, 무효화를
 * 여기서 걸어 두면 소비 그룹이 화면만 만들면 된다(WORK-003 Internal Interface Contract).
 */

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import {
  createProject,
  createWorkType,
  deleteProject,
  deleteWorkType,
  fetchProjects,
  fetchWorkTypes,
  updateProject,
  updateWorkType,
  type CreateProjectInput,
  type CreateWorkTypeInput,
  type UpdateProjectInput,
  type UpdateWorkTypeInput,
} from "@/features/settings/api";
import { queryKeys } from "@/lib/api/queryKeys";

/** 이 표에 없는 무효화를 하지 않는다(§3-3). */
function invalidateWorkTypes(client: QueryClient): Promise<unknown> {
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.workTypes() }),
    client.invalidateQueries({ queryKey: queryKeys.tasks() }),
    client.invalidateQueries({ queryKey: queryKeys.meetings() }),
  ]);
}

function invalidateProjects(client: QueryClient): Promise<unknown> {
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.projects() }),
    client.invalidateQueries({ queryKey: queryKeys.tasks() }),
    client.invalidateQueries({ queryKey: queryKeys.meetings() }),
  ]);
}

export function useWorkTypesQuery() {
  return useQuery({
    queryKey: queryKeys.workTypes(),
    queryFn: fetchWorkTypes,
    // 목록은 잠깐 재사용한다(§3-2).
    staleTime: 30_000,
  });
}

export function useProjectsQuery() {
  return useQuery({
    queryKey: queryKeys.projects(),
    queryFn: fetchProjects,
    staleTime: 30_000,
  });
}

export function useWorkTypeMutations() {
  const client = useQueryClient();

  return {
    create: useMutation({
      mutationFn: (input: CreateWorkTypeInput) => createWorkType(input),
      onSuccess: () => invalidateWorkTypes(client),
    }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: number; input: UpdateWorkTypeInput }) =>
        updateWorkType(id, input),
      onSuccess: () => invalidateWorkTypes(client),
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteWorkType(id),
      onSuccess: () => invalidateWorkTypes(client),
    }),
  };
}

export function useProjectMutations() {
  const client = useQueryClient();

  return {
    create: useMutation({
      mutationFn: (input: CreateProjectInput) => createProject(input),
      onSuccess: () => invalidateProjects(client),
    }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: number; input: UpdateProjectInput }) =>
        updateProject(id, input),
      onSuccess: () => invalidateProjects(client),
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteProject(id),
      onSuccess: () => invalidateProjects(client),
    }),
  };
}
