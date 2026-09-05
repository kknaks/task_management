"use client";

/**
 * **상태 전이 훅 하나 — 세 진입점이 공유한다**(WP §Internal Interface Contract · SPEC-004 U-6).
 *
 * > 리스트 상태 셀 · 상세 헤더 드롭다운 · 칸반 DnD 가 **같은 요청 본문**을 내고
 * > **같은 에러 분기·같은 토스트**를 지난다. 화면마다 호출을 만들면 「같은 판정」이
 * > 화면에서만 깨진다.
 *
 * 그래서 **`changeTaskStatus` 를 부르는 곳이 이 파일 하나**여야 한다 — grep 결과가 그 증거다.
 * (넷째 진입점인 회의록은 WORK-008 이 같은 엔드포인트에 붙는다.)
 *
 * ## 낙관적 갱신을 하지 않는다
 *
 * 완료 게이트·전이 그래프가 **거부할 수 있다**(FE §3-4 · §5 표). 거부는 정상 경로다.
 * 즉각성은 다른 방법으로 준다 — 칸반은 **드래그 고스트**가, 리스트·드롭다운은 `pending` 이.
 * (WORK-004 에서 낙관적으로 만든 세 자리 — 할일 체크·메모·인라인 텍스트 — 와 **정반대 축**이다.)
 *
 * ## 무효화
 *
 * 전이·삭제 뒤 `['tasks', …]` 만 다시 읽는다. **기한이 바뀐 게 아니므로 `['schedules']` 를
 * 건드리지 않는다**(FE §3-3 표 · SPEC-004 §5).
 */

import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { changeTaskStatus, deleteTask, undoTaskStatus } from "@/features/tasks/api";
import type { TaskListItem, TaskStatus, TaskStatusInput } from "@/features/tasks/types";
import { API_ERROR_CODE, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/queryKeys";

/** 완료 토스트 4초 · 거부 토스트 6초(U-6 — 할 일이 있는 토스트라 더 길다). */
const DONE_TOAST_MS = 4000;
const BLOCKED_TOAST_MS = 6000;

export interface TaskStatusHandlers {
  /**
   * 거부 토스트의 「결과 입력」 — **WORK-004 가 내보낸 `useCompletionCardFocus()` 로 간다**.
   * 여기서 스크롤·포커스·강조를 새로 만들지 않는다(규격이 둘이 되지 않게).
   */
  onEnterCompletion?: (taskId: number) => void;
}

export function useTaskStatus(handlers: TaskStatusHandlers = {}) {
  const client = useQueryClient();
  const { onEnterCompletion } = handlers;

  /** 업무가 바뀌면 목록·상세를 다시 읽는다. **`['schedules']` 는 건드리지 않는다.** */
  const invalidate = useCallback(
    () => client.invalidateQueries({ queryKey: queryKeys.tasks() }),
    [client],
  );

  const change = useMutation({
    mutationFn: ({ id, input }: { id: number; input: TaskStatusInput }) =>
      changeTaskStatus(id, input),
    onSuccess: () => invalidate(),
  });

  const undo = useMutation({
    mutationFn: (id: number) => undoTaskStatus(id),
    onSuccess: () => invalidate(),
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteTask(id),
    onSuccess: () => invalidate(),
  });

  /**
   * 완료 뒤 4초 동안만 뜨는 토스트. **실행취소는 서버가 조건을 판정한다**(4초·마지막 로그) —
   * 화면 타이머는 표시용이고, 늦게 눌리면 `undo_not_available` 이 같은 문구로 돌아온다.
   */
  const doneToast = useCallback(
    (id: number) => {
      toast.success("완료 처리했습니다", {
        duration: DONE_TOAST_MS,
        action: {
          label: "실행취소",
          onClick: () => {
            undo.mutateAsync(id).catch((error: unknown) => {
              if (isApiError(error) && error.code === API_ERROR_CODE.UNDO_NOT_AVAILABLE) {
                toast.error(error.detail, {
                  description: "상태에서 직접 되돌릴 수 있습니다",
                });
                return;
              }
              toast.error("되돌리지 못했습니다");
            });
          },
        },
      });
    },
    [undo],
  );

  /**
   * **세 진입점이 지나는 문 하나.** 성공하면 `true` 를 돌려준다 —
   * 칸반이 「원위치할지」를 이 값으로 정한다(실패하면 카드가 원래 컬럼으로 돌아간다).
   */
  const setStatus = useCallback(
    async (task: { id: number; title: string }, input: TaskStatusInput): Promise<boolean> => {
      try {
        await change.mutateAsync({ id: task.id, input });
        if (input.status === "done") {
          doneToast(task.id);
        }
        return true;
      } catch (error: unknown) {
        if (!isApiError(error)) {
          toast.error("상태를 바꾸지 못했습니다");
          return false;
        }
        switch (error.code) {
          case API_ERROR_CODE.TASK_COMPLETION_BLOCKED:
            // **거부는 정상 경로다.** 세 진입점이 **같은 문구**를 본다(§4 Case Matrix).
            toast.error(error.detail, {
              duration: BLOCKED_TOAST_MS,
              action: onEnterCompletion
                ? { label: "결과 입력", onClick: () => onEnterCompletion(task.id) }
                : undefined,
            });
            return false;
          case API_ERROR_CODE.INVALID_STATUS_TRANSITION:
            toast.error(error.detail);
            return false;
          case API_ERROR_CODE.NOT_FOUND:
            // 다른 곳에서 지워졌다 — 「다시 시도」가 아니라 **목록 갱신**으로 푼다(§4).
            toast.error(error.detail, { description: "목록을 새로 고칩니다" });
            void invalidate();
            return false;
          default:
            // `validation_error` 는 **취소 모달 안 인라인**이라 여기서 토스트를 내지 않는다.
            throw error;
        }
      }
    },
    [change, doneToast, invalidate, onEnterCompletion],
  );

  const removeTask = useCallback(
    async (id: number): Promise<boolean> => {
      try {
        await remove.mutateAsync(id);
        return true;
      } catch {
        toast.error("삭제하지 못했습니다");
        return false;
      }
    },
    [remove],
  );

  return {
    setStatus,
    removeTask,
    /** 어떤 업무가 요청 중인가 — 칸반이 그 카드를 로딩(불투명도 0.6)으로 유지한다. */
    pendingId: change.isPending ? (change.variables?.id ?? null) : null,
    isPending: change.isPending,
  };
}

/** 취소 전이의 본문 — 사유는 `cancelled` 일 때만 실린다(T-7). */
export function cancelInput(reason: string, logCancelReason: boolean): TaskStatusInput {
  return { status: "cancelled" as TaskStatus, cancelReason: reason, logCancelReason };
}
