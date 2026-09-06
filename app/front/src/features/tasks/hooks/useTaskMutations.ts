"use client";

/**
 * 업무 쿼리·뮤테이션 — `['tasks','detail',id]`(frontend/README.md §3-3).
 *
 * ## 낙관적 갱신은 **세 자리만**(SPEC-003 §5 표)
 *
 * > **할일 체크·메모 추가·인라인 텍스트 — 한다 — 거부할 규칙이 없다.**
 * > 기한·유형·프로젝트·첨부·상태 전이 — **하지 않는다** — 겹침·삭제된 항목·완료 게이트가
 * > **거부할 수 있다.**
 *
 * 그 구분이 §5 표의 요점이다. 거부할 서버 규칙이 없는 셋은 **롤백이 단순**하므로 `onMutate` 로
 * 즉시 반영하고 `onError` 에서 되돌린다 — U-5 가 「체크하면 진행률이 **즉시**」를 요구한다.
 * 되돌린 뒤의 실패 안내는 **U-7 규격 그대로** 소유 블록이 그린다(자동 재시도 없음).
 *
 * ## 캐시에 쓰는 것은 **상세 전체**뿐이다
 *
 * 자식 컬렉션의 쓰기 표면은 전부 갱신된 `TaskDetail` 을 돌려준다(SPEC-003 §4, 2026-09-06).
 * `apiFetch<T>` 가 `as T` 캐스팅이라 **응답 형태가 어긋나도 타입 검사가 못 잡으므로**,
 * `putDetail` 이 **id 를 대조**해 엉뚱한 키에 쓰레기를 얹는 일을 즉시 드러낸다(검수 F-4).
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

/**
 * **일정이 바뀌었나** — `schedule` 파생 행을 다시 읽어야 하는지 가른다.
 *
 * 일정이 4필드로 돌아오면서 **계획 시작도 축이 됐다**(A-4 번복 · DEC-002) — `startDate` 만
 * 바꿔도 기간이 달라지므로 무효화가 나가야 한다. 시각(`dueStartTime`·`dueEndTime`)은
 * **제거됐다** — 업무는 날짜 단위다. 캘린더 work 가 이 판정을 그대로 물려받는다.
 */
function touchesDue(input: UpdateTaskInput): boolean {
  return "dueDate" in input || "startDate" in input;
}

/**
 * 응답이 상세 전체라 캐시를 그대로 갈아 끼운다 — 곧바로 다시 읽지 않는다.
 *
 * **id 를 대조한다.** `apiFetch` 가 무검증 캐스팅이라 서버가 다른 형태를 주면 조용히 지나가고,
 * 그러면 `['tasks','detail', <자식 id>]` 에 쓰레기가 쌓인다(검수 F-4가 그 사례다).
 */
function putDetail(client: QueryClient, expectedId: number, detail: TaskDetail): void {
  if (detail?.id !== expectedId) {
    // 계약 위반이다 — 캐시를 오염시키지 않고 재조회에 맡긴다. 개발 중에는 즉시 드러난다.
    if (process.env.NODE_ENV !== "production") {
      throw new Error(
        `업무 ${expectedId} 의 응답이 상세가 아닙니다(받은 id: ${String(detail?.id)}) — ` +
          "자식 컬렉션의 쓰기 표면은 갱신된 TaskDetail 을 돌려줘야 합니다(SPEC-003 §4).",
      );
    }
    return;
  }
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
  const detailKey = queryKeys.taskDetail(taskId ?? 0);

  const afterDetail = (detail: TaskDetail, dueChanged = false) => {
    putDetail(client, detail.id, detail);
    return invalidateTask(client, dueChanged);
  };

  /**
   * 낙관 반영의 공통 뼈대 — 진행 중 재조회를 멈추고, 되돌릴 스냅숏을 남기고, 캐시를 미리 고친다.
   * `onError` 가 그 스냅숏으로 되돌린다.
   */
  const optimistic = async (edit: (current: TaskDetail) => TaskDetail) => {
    await client.cancelQueries({ queryKey: detailKey });
    const snapshot = client.getQueryData<TaskDetail>(detailKey);
    if (snapshot) {
      client.setQueryData(detailKey, edit(snapshot));
    }
    return { snapshot };
  };

  const rollback = (context: { snapshot?: TaskDetail } | undefined) => {
    if (context?.snapshot) {
      client.setQueryData(detailKey, context.snapshot);
    }
  };

  return {
    /**
     * **화면이 낡았을 때 맞추는 문**(§3-3 표의 무효화만 쓴다).
     * 없는 자식을 지우려다 404 를 받은 자리가 이걸 부른다 — 같은 요청을 다시 보내도 또 404 라
     * 「다시 저장」이 아니라 **목록 갱신**이 해법이다.
     */
    refresh: () => invalidateTask(client),

    create: useMutation({
      mutationFn: (input: CreateTaskInput) => createTask(input),
      onSuccess: (detail) =>
        // 생성은 기한이 함께 올 수 있으므로 일정도 무효화한다(§3-3 표).
        afterDetail(detail, true),
    }),

    update: useMutation({
      mutationFn: ({ id, input }: { id: number; input: UpdateTaskInput }) => updateTask(id, input),
      /**
       * **인라인 텍스트만 낙관적이다**(§5 표). 기한·유형·프로젝트는 겹침·삭제된 항목이
       * 거부할 수 있어 값이 애초에 안 바뀐다 — 그래서 원복이 저절로 된다.
       */
      onMutate: async ({ input }) => {
        if (touchesDue(input) || "workTypeId" in input || "projectId" in input) {
          return { snapshot: undefined };
        }
        return optimistic((current) => ({ ...current, ...input }));
      },
      onError: (_error, _variables, context) => rollback(context),
      onSuccess: (detail, variables) => afterDetail(detail, touchesDue(variables.input)),
    }),

    addTodo: useMutation({
      mutationFn: (text: string) => addTodo(taskId as number, text),
      onSuccess: (detail) => afterDetail(detail),
    }),
    updateTodo: useMutation({
      mutationFn: ({ todoId, input }: { todoId: number; input: { text?: string; done?: boolean } }) =>
        updateTodo(taskId as number, todoId, input),
      /**
       * **할일 체크는 낙관적**이다 — 거부할 규칙이 없고 U-5 가 「진행률이 **즉시**」를 요구한다.
       * 진행률도 함께 미리 세어 둔다(서버 응답이 오면 파생값으로 덮인다).
       */
      onMutate: async ({ todoId, input }) =>
        optimistic((current) => {
          const todos = current.todos.map((todo) =>
            todo.id === todoId ? { ...todo, ...input } : todo,
          );
          return {
            ...current,
            todos,
            todoProgress: {
              done: todos.filter((todo) => todo.done).length,
              total: todos.length,
            },
          };
        }),
      onError: (_error, _variables, context) => rollback(context),
      onSuccess: (detail) => afterDetail(detail),
    }),
    removeTodo: useMutation({
      mutationFn: (todoId: number) => deleteTodo(taskId as number, todoId),
      onSuccess: () => invalidateTask(client),
    }),

    addMemo: useMutation({
      mutationFn: (text: string) => addMemo(taskId as number, text),
      /** **메모 추가도 낙관적**이다(§5 표) — 등록 즉시 최상단에 붙는다(U-9). */
      onMutate: async (text) =>
        optimistic((current) => ({
          ...current,
          memos: [
            // 서버가 진짜 id·시각을 준다. 그때까지만 사는 임시 행이다.
            { id: -Date.now(), text, createdAt: new Date().toISOString() },
            ...current.memos,
          ],
        })),
      onError: (_error, _variables, context) => rollback(context),
      onSuccess: (detail) => afterDetail(detail),
    }),

    addAttachment: useMutation({
      mutationFn: (input: { role: "reference" | "deliverable"; url: string; label: string | null }) =>
        addAttachment(taskId as number, input),
      // 첨부는 **낙관적으로 하지 않는다**(§5 표) — 사라진 문서가 거부할 수 있다.
      onSuccess: (detail) => afterDetail(detail),
    }),
    removeAttachment: useMutation({
      mutationFn: (attachmentId: number) => deleteAttachment(taskId as number, attachmentId),
      onSuccess: () => invalidateTask(client),
    }),

    linkRelations: useMutation({
      mutationFn: (taskIds: number[]) => linkRelations(taskId as number, taskIds),
      // **양방향**이라 반대편 상세도 갱신돼야 한다 — 키 전체를 무효화한다(T-10).
      onSuccess: (detail) => afterDetail(detail),
    }),
    unlinkRelation: useMutation({
      mutationFn: (otherTaskId: number) => unlinkRelation(taskId as number, otherTaskId),
      onSuccess: () => invalidateTask(client),
    }),
  };
}
