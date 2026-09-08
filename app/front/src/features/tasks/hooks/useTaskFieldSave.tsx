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

import {
  AutoSaveFailureNotice,
  type AutoSaveFailure,
} from "@/components/shared/AutoSaveFailureNotice";
import {
  autoSaveFailureMessage,
  isValidationError,
  taskInlineError,
} from "@/features/tasks/errors";
import { useTaskMutations } from "@/features/tasks/hooks/useTaskMutations";
import { useRowFailures } from "@/lib/hooks/useRowFailures";
import type { TaskDetail, UpdateTaskInput } from "@/features/tasks/types";

/**
 * U-7 문구에 들어가는 필드 이름. **토스트와 인라인 캡션이 같은 이름을 쓴다.**
 * 편집 대상은 SPEC-003 U-2 의 넷 + 헤더의 셋이다.
 */
export const TASK_FIELD_LABEL = {
  title: "제목",
  /** 계획 시작·종료 두 칸을 한 축으로 묶는다 — 저장도 함께 나간다(F-1②). */
  due: "일정",
  workType: "유형",
  project: "프로젝트",
  /** `background`·`goal` 을 합친 하나(DEC-002 · F-1b). */
  description: "설명",
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
        /**
         * **422 는 컨트롤 옆 인라인으로 새지 않는다**(G-0c) — 서버 문구가
         * 「입력값을 확인해 주세요」 하나라 그 자리에 붙여 봐야 무엇이 틀렸는지 알 수 없다.
         * 아래 U-7 경로로 내려가 **필드 이름을 짚고** 「다시 저장」을 함께 준다.
         */
        if (inline && !inline.toast && !isValidationError(error) && onInlineError) {
          // 삭제된 유형·프로젝트처럼 **그 컨트롤 옆에 붙는** 사유는 자동 저장 실패와 다른 축이다.
          onInlineError(field, inline.message);
          return;
        }
        toast.error(autoSaveFailureMessage(error, TASK_FIELD_LABEL[field]));
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
  const failureList = useCallback(
    (...fields: TaskField[]): AutoSaveFailure[] =>
      fields
        .filter((field) => field in rowFailures)
        .map((field) => ({
          field,
          label: TASK_FIELD_LABEL[field],
          onRetry: () => void rowFailures[field].retry(),
        })),
    [rowFailures],
  );

  const noticeFor = useCallback(
    (...fields: TaskField[]) => (
      <AutoSaveFailureNotice busy={mutations.update.isPending} failures={failureList(...fields)} />
    ),
    [failureList, mutations.update.isPending],
  );

  return {
    save,
    saving: mutations.update.isPending,
    hasFailed: (field: TaskField) => hasFailed(task.id, field),
    noticeFor,
    /**
     * 한 블록이 **본체 필드와 자식 컬렉션을 함께** 들 때 쓴다(결과자료 카드 —
     * 완료 결과 + 결과자료 첨부). 줄을 합쳐 **자리를 하나로** 유지한다.
     */
    failureList,
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
 * 필드 키는 **행마다 다르다**(`todo:<id>` · `attachment:<id>` · `relation:<otherId>`) —
 * 두 행이 동시에 실패하면 줄이 둘로 늘고 「다시 저장」도 각자 자기 요청만 낸다.
 * 아직 행이 없는 추가·연결은 **블록 단위 키**(`…:new`)를 쓰고 넣으려던 입력을 그대로 다시 보낸다.
 *
 * **낙관적 갱신 여부와 실패 표시는 별개 축이다** — 낙관적이면 「되돌린다 + 말한다」,
 * 아니면 「안 바뀐다 + 말한다」다. 어느 쪽이든 **말은 해야 한다**(DEC-001 §7 · SPEC-002 U-7).
 */
export interface CollectionRunOptions {
  /**
   * **화면이 낡아서 난 실패**를 가로챈다 — 「다시 저장」으로 풀 일이 아니다.
   * 없는 연관을 해제하면 서버가 404 를 내는데(2026-09-06), 그건 이미 없는 것을 지우려 한 것이라
   * 같은 요청을 다시 보내도 또 404 다. **목록을 갱신해 화면을 맞추는 것**이 해법이다.
   *
   * `true` 를 돌려주면 실패 표시를 켜지 않는다(호출자가 이미 처리했다는 뜻).
   */
  onStale?: (error: unknown) => boolean;
}

export function useCollectionSave(taskId: number, label: string, busy: boolean) {
  const { failures, markFailed, clearFailed, hasFailed } = useRowFailures();

  const run = useCallback(
    async (
      field: string,
      request: () => Promise<unknown>,
      options?: CollectionRunOptions,
    ): Promise<boolean> => {
      try {
        await request();
        clearFailed(taskId, field);
        return true;
      } catch (error) {
        if (options?.onStale?.(error)) {
          // 저장 실패가 아니라 **화면이 낡은 것**이다 — 표시를 켜지 않는다.
          clearFailed(taskId, field);
          return true;
        }
        toast.error(autoSaveFailureMessage(error, label));
        markFailed(taskId, field, {
          retry: async () => {
            await run(field, request, options);
          },
        });
        return false;
      }
    },
    [clearFailed, label, markFailed, taskId],
  );

  const rowFailures = failures[taskId] ?? {};

  const failureList = (): AutoSaveFailure[] =>
    Object.keys(rowFailures).map((field) => ({
      field,
      label,
      onRetry: () => void rowFailures[field].retry(),
    }));

  return {
    run,
    hasFailed: (field: string) => hasFailed(taskId, field),
    failureList,
    /** 캡션·「다시 저장」의 **블록당 하나뿐인 자리**. */
    notice: <AutoSaveFailureNotice busy={busy} failures={failureList()} />,
  };
}
