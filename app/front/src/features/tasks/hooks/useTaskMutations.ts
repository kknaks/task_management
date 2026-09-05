"use client";

/**
 * 업무 쿼리·뮤테이션 — `['tasks','detail',id]`(frontend/README.md §3-3).
 *
 * ## 낙관적 갱신은 세 자리만
 *
 * > **할일 체크·메모 추가·인라인 텍스트만** 낙관적이다. **기한·유형·프로젝트·첨부는 하지
 * > 않는다** — 겹침·삭제된 항목·사라진 문서가 **거부할 수 있다**(WORK-004 Internal Interface
 * > Contract · FE §3-4 「서버가 거부할 수 있는 변경은 낙관적으로 하지 않는다」).
 *
 * 이 파일은 **낙관적 갱신을 하지 않는다.** 서버 응답(상세 전체)을 캐시에 그대로 얹는다 —
 * 응답이 파생값(`dDay`·`todoProgress`)까지 다시 계산해 주므로 화면이 셀 필요가 없다.
 * 할일 체크의 즉시 반영은 그 응답이 곧바로 오기 때문에 성립한다.
 */

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import {
  addAttachment,
  addMemo,
  addTodo,
  createTask,
  deleteAttachment,
  deleteTodo,
  fetchTask,
  linkRelations,
  unlinkRelation,
  updateTask,
  updateTodo,
} from "@/features/tasks/api";
import type { CreateTaskInput, TaskDetail, UpdateTaskInput } from "@/features/tasks/types";
import { queryKeys } from "@/lib/api/queryKeys";

/**
 * 업무가 바뀌면 `['tasks', …]` 전부, **기한이 바뀌었으면 `['schedules']` 도** 무효화한다
 * (§3-3 표). **표에 없는 무효화를 하지 않는다.**
 */
function invalidateTask(client: QueryClient, dueChanged = false): Promise<unknown> {
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.tasks() }),
    ...(dueChanged ? [client.invalidateQueries({ queryKey: queryKeys.schedules() })] : []),
  ]);
}

/** 응답이 상세 전체라 캐시를 그대로 갈아 끼운다 — 곧바로 다시 읽지 않는다. */
function putDetail(client: QueryClient, detail: TaskDetail): void {
  client.setQueryData(queryKeys.taskDetail(detail.id), detail);
}

export function useTaskDetailQuery(id: number | null) {
  return useQuery({
    queryKey: queryKeys.taskDetail(id ?? 0),
    queryFn: () => fetchTask(id as number),
    enabled: id !== null,
    // 상세는 **열 때마다 새로**(§3-2).
    staleTime: 0,
  });
}

export function useTaskMutations(taskId?: number) {
  const client = useQueryClient();

  const afterDetail = (detail: TaskDetail, dueChanged = false) => {
    putDetail(client, detail);
    return invalidateTask(client, dueChanged);
  };

  return {
    create: useMutation({
      mutationFn: (input: CreateTaskInput) => createTask(input),
      onSuccess: (detail) =>
        // 생성은 기한이 함께 올 수 있으므로 일정도 무효화한다(§3-3 표).
        afterDetail(detail, true),
    }),

    update: useMutation({
      mutationFn: ({ id, input }: { id: number; input: UpdateTaskInput }) => updateTask(id, input),
      onSuccess: (detail, variables) => afterDetail(detail, "dueDate" in variables.input),
    }),

    addTodo: useMutation({
      mutationFn: (text: string) => addTodo(taskId as number, text),
      onSuccess: (detail) => afterDetail(detail),
    }),
    updateTodo: useMutation({
      mutationFn: ({ todoId, input }: { todoId: number; input: { text?: string; done?: boolean } }) =>
        updateTodo(taskId as number, todoId, input),
      onSuccess: (detail) => afterDetail(detail),
    }),
    removeTodo: useMutation({
      mutationFn: (todoId: number) => deleteTodo(taskId as number, todoId),
      onSuccess: () => invalidateTask(client),
    }),

    addMemo: useMutation({
      mutationFn: (text: string) => addMemo(taskId as number, text),
      onSuccess: (detail) => afterDetail(detail),
    }),

    addAttachment: useMutation({
      mutationFn: (input: { role: "reference" | "deliverable"; url: string; label: string | null }) =>
        addAttachment(taskId as number, input),
      onSuccess: (detail) => afterDetail(detail),
    }),
    removeAttachment: useMutation({
      mutationFn: (attachmentId: number) => deleteAttachment(taskId as number, attachmentId),
      onSuccess: () => invalidateTask(client),
    }),

    linkRelations: useMutation({
      mutationFn: (taskIds: number[]) => linkRelations(taskId as number, taskIds),
      // **양방향**이라 반대편 상세도 갱신돼야 한다 — 키 전체를 무효화한다(T-10).
      onSuccess: () => invalidateTask(client),
    }),
    unlinkRelation: useMutation({
      mutationFn: (otherTaskId: number) => unlinkRelation(taskId as number, otherTaskId),
      onSuccess: () => invalidateTask(client),
    }),
  };
}
