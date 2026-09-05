"use client";

/**
 * 업무 본체 필드의 **자동 저장 한 벌**(SPEC-003 U-2 · SPEC-002 U-7 구현 규약).
 *
 * 헤더(제목·기한·유형·프로젝트)와 본문 블록(배경·목표·완료 결과)이 **같은 규격**을 타야 하는데,
 * 둘이 다른 컴포넌트라 배선을 이 훅 하나에 모은다. 안 그러면 두 번째 자리가 생기는 순간
 * 규격이 샌다 — WORK-003 검수 F-1 이 그 사례다.
 *
 * - **실패 상태는 내부 state 가 아니다** — `useRowFailures` 가 들고 컨트롤에는 `saveFailed` prop 으로 간다
 * - 캡션·「다시 저장」은 **소유 블록 안의 인라인 자리 하나**가 그린다(`noticeFor`)
 * - **자동 재시도가 없다** — `save` 는 눌린 만큼만 불린다
 *
 * 소유자를 블록별로 나누고 싶으면 **블록마다 이 훅을 따로 부른다** — 실패 상태가 섞이지 않는다.
 */

import { useCallback } from "react";
import { toast } from "sonner";

import { AutoSaveFailureNotice } from "@/components/shared/AutoSaveFailureNotice";
import { autoSaveErrorToast, taskInlineError } from "@/features/tasks/errors";
import { useTaskMutations } from "@/features/tasks/hooks/useTaskMutations";
import { useRowFailures } from "@/features/settings/useRowFailures";
import type { TaskDetail, UpdateTaskInput } from "@/features/tasks/types";

/**
 * U-7 문구에 들어가는 필드 이름. **토스트와 인라인 캡션이 같은 이름을 쓴다.**
 * 편집 대상은 SPEC-003 U-2 의 넷 + 헤더의 셋이다.
 */
export const TASK_FIELD_LABEL = {
  title: "제목",
  due: "기한",
  workType: "유형",
  project: "프로젝트",
  background: "배경",
  goal: "목표",
  completionResult: "완료 결과",
} as const;

export type TaskField = keyof typeof TASK_FIELD_LABEL;

/** 셀렉터 옆에 붙는 인라인 사유 — 유형과 프로젝트를 **분기해서** 짚는다(§4 Case Matrix). */
export type FieldInlineErrors = Partial<Record<TaskField, string | null>>;

export function useTaskFieldSave(task: TaskDetail) {
  const mutations = useTaskMutations(task.id);
  const { failures, markFailed, clearFailed, hasFailed } = useRowFailures();

  /**
   * 필드 하나를 저장한다. **성공하면 그 필드의 실패 표시를 지우고**(해제 조건 ①·②),
   * 실패하면 켠다 — 재요청 방법을 함께 들어 「다시 저장」이 같은 요청을 낸다.
   *
   * `schedule_overlap`·`invalid_work_type`·`invalid_project` 는 **그 컨트롤 옆 인라인**이거나
   * **토스트**다(§4 Case Matrix) — `errors.ts` 가 이미 분류해 둔 것을 그대로 쓴다.
   * **원복은 저절로 된다** — 낙관적 갱신을 하지 않으므로 값이 애초에 안 바뀐다(§5 표).
   */
  const save = useCallback(
    async (
      field: TaskField,
      input: UpdateTaskInput,
      onInlineError?: (field: TaskField, message: string) => void,
    ): Promise<void> => {
      try {
        await mutations.update.mutateAsync({ id: task.id, input });
        clearFailed(task.id, field);
      } catch (error) {
        const inline = taskInlineError(error);
        if (inline && !inline.toast && onInlineError) {
          // 삭제된 유형·프로젝트처럼 **그 컨트롤 옆에 붙는** 사유는 자동 저장 실패와 다른 축이다.
          onInlineError(field, inline.message);
          return;
        }
        toast.error(inline?.message ?? autoSaveErrorToast(TASK_FIELD_LABEL[field]));
        markFailed(task.id, field, {
          retry: () => save(field, input, onInlineError),
        });
      }
    },
    [clearFailed, markFailed, mutations.update, task.id],
  );

  const rowFailures = failures[task.id] ?? {};

  /**
   * **소유자는 블록**이다 — 캡션·「다시 저장」을 그 필드가 있는 블록 안에 둔다.
   * 자리는 **블록당 하나**이고 그 블록에서 여러 필드가 실패하면 줄이 늘어난다.
   */
  const noticeFor = useCallback(
    (...fields: TaskField[]) => (
      <AutoSaveFailureNotice
        busy={mutations.update.isPending}
        failures={fields
          .filter((field) => field in rowFailures)
          .map((field) => ({
            field,
            label: TASK_FIELD_LABEL[field],
            onRetry: () => void rowFailures[field].retry(),
          }))}
      />
    ),
    [mutations.update.isPending, rowFailures],
  );

  return {
    save,
    saving: mutations.update.isPending,
    hasFailed: (field: TaskField) => hasFailed(task.id, field),
    noticeFor,
  };
}

/**
 * 자식 컬렉션(할일·메모)의 **같은 규격**.
 *
 * 본체 필드와 갈라 두는 이유는 **낙관적 갱신 때문**이다 — 할일 체크·메모 추가는 §5 표에서
 * 「한다」쪽이라 실패하면 값이 **되돌아간다**. 되돌아가기만 하고 아무 말이 없으면 사용자는
 * **체크가 안 눌린 줄 안다** — 그래서 롤백 뒤에 U-7 표시가 반드시 남아야 한다.
 * (검수 W-2 의 「롤백 시 U-7 실패 표시가 그대로 뜨는지」가 이 자리다.)
 *
 * 필드 키는 **행마다 다르다**(`todo:<id>`) — 두 행이 동시에 실패하면 줄이 둘로 늘고
 * 「다시 저장」도 각자 자기 요청만 낸다.
 */
export function useCollectionSave(taskId: number, label: string, busy: boolean) {
  const { failures, markFailed, clearFailed, hasFailed } = useRowFailures();

  const run = useCallback(
    async (field: string, request: () => Promise<unknown>): Promise<void> => {
      try {
        await request();
        clearFailed(taskId, field);
      } catch {
        toast.error(autoSaveErrorToast(label));
        markFailed(taskId, field, { retry: () => run(field, request) });
      }
    },
    [clearFailed, label, markFailed, taskId],
  );

  const rowFailures = failures[taskId] ?? {};

  return {
    run,
    hasFailed: (field: string) => hasFailed(taskId, field),
    /** 캡션·「다시 저장」의 **블록당 하나뿐인 자리**. */
    notice: (
      <AutoSaveFailureNotice
        busy={busy}
        failures={Object.keys(rowFailures).map((field) => ({
          field,
          label,
          onRetry: () => void rowFailures[field].retry(),
        }))}
      />
    ),
  };
}
