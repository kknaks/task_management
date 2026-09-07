"use client";

/**
 * **업무 연동의 뮤테이션 한 벌 — 생성 · 갱신 각 하나**(SPEC-008 U-6 · U-9 · U-10 · WP Phase 5).
 *
 * ## 완료 게이트의 네 번째 진입점 — 그러나 **판정은 여기 없다**
 *
 * 「업무 갱신」은 `PATCH …/lines/{id}/task` **하나**다(본문 없음 — 줄의 `payload` 가 요청). 서버 `task_service.change_status()`
 * 가 그래프 · 게이트 · 로그 · 실적을 판정하고 거부는 예외로 온다. 이 훅은 그 답을 **WORK-005 규격의 토스트**로 옮길 뿐이다 —
 * 결과자료 유무 · 전이 가능 여부를 여기서 미리 판단하지 않는다(SPEC-004 §5). 업무 API(`/api/tasks/...`)를 직접 부르지 않는다.
 *
 * | 응답 | 화면(SPEC-008 §4 Case Matrix · SPEC-004 U-6) |
 * |---|---|
 * | 200 | `payload` 비워짐 → 「갱신 완료」. **완료 전이가 포함됐고 성공했으면** 완료 토스트 「완료 처리했습니다 · 실행취소」(4초 — `lib/hooks/useTaskDoneToast` · 업무 화면과 같은 것) |
 * | 422 `task_completion_blocked` | 거부 토스트(6초) + **「결과 입력」** → 그 업무 상세 드로어의 「결과자료 · 완료 결과」 카드로(WORK-004 `useCompletionCardFocus` 유도 훅). 줄은 「업무 갱신」 그대로 |
 * | 409 `invalid_status_transition` | 토스트 「이 상태로는 바꿀 수 없습니다」. 줄 그대로 |
 * | 404 | 업무가 지워졌다 — 상세 재조회(서버가 `isDeleted:true` 로 실어 오면 줄이 「삭제된 업무」 비활성) |
 * | 409 `invalid_meeting_status` | 토스트 + 상세 재조회(화면이 낡았다) |
 * | 5xx · 네트워크 | 토스트 「업무를 갱신하지 못했습니다」. 버튼은 활성으로 복귀 |
 *
 * ## 낙관적 갱신을 하지 않는다 — 거부가 정상 경로다(FE §3-4). 두 요청 모두 응답 `MeetingDetail` 을 캐시에 놓는다.
 * ## 무효화 — 업무가 바뀌었으므로 `['tasks']`. 기한이 바뀔 수 있으므로 갱신 뒤 `['schedules']` 도(FE §3-3 표).
 *
 * **실패를 받는 자리** — `applyLinePayload` 는 **던지지 않는다**(버튼 · 드로어 후속 요청이 `void` 로 부른다 — 두 번째 실패가
 * unhandled 로 새지 않게). `createTaskFromLine` 은 **던진다** — 드로어가 열린 채 인라인으로 붙인다(U-10 「제출 중 · 실패」).
 */

import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { STATUS_LABEL } from "@/components/shared/StatusDot";
// `features/tasks` 에서 가져오는 것은 업무 상세 드로어 **하나** — §2 규칙 4 의 유일한 예외(드로어 재사용). 토스트는 `lib/hooks` 의 것이다.
import { openTaskDetailDrawer } from "@/features/tasks";
import { applyLineTaskChange, createTaskFromLine as postCreateTaskFromLine } from "@/features/meetings/api";
import { INVALID_STATUS_MESSAGE, isMeetingNotFound } from "@/features/meetings/errors";
import type { MeetingDetail, MeetingLine, NewTaskInput } from "@/features/meetings/types";
import { API_ERROR_CODE, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/queryKeys";
import { useTaskDoneToast } from "@/lib/hooks/useTaskDoneToast";
import { useOverlay } from "@/lib/overlay/OverlayProvider";

/** 거부 토스트 6초 — 할 일(「결과 입력」)이 있는 토스트라 더 길다(SPEC-004 U-6). */
const BLOCKED_TOAST_MS = 6000;
export const APPLY_FAILED_MESSAGE = "업무를 갱신하지 못했습니다";
export const TASK_GONE_MESSAGE = "삭제된 업무입니다";

/** 「업무 갱신」 툴팁에 실을 항목 — `status` 가 업무의 현재 상태와 같으면 뺀다(§4 「화면 계산」 · SPEC-004 L478). */
export function payloadSummary(line: MeetingLine): string[] {
  const change = line.payload;
  if (!change) {
    return [];
  }
  const parts: string[] = [];
  if (change.dueDate) {
    parts.push(`기한 → ${change.dueDate.slice(5).replace("-", ".")}`);
  }
  if (change.status && change.status !== line.task?.status) {
    parts.push(`상태 → ${STATUS_LABEL[change.status]}`);
  }
  if (change.note) {
    parts.push("메모 1건");
  }
  return parts;
}

export function useMeetingTaskLink(meeting: MeetingDetail) {
  const client = useQueryClient();
  const overlay = useOverlay();
  const detailKey = queryKeys.meetingDetail(meeting.id);

  const refreshDetail = useCallback(() => client.invalidateQueries({ queryKey: detailKey }), [client, detailKey]);
  const doneToast = useTaskDoneToast({ onUndone: () => void refreshDetail() });

  const putDetail = useCallback(
    (detail: MeetingDetail) => {
      client.setQueryData(detailKey, detail);
    },
    [client, detailKey],
  );

  const create = useMutation({
    mutationFn: ({ lineId, input }: { lineId: number; input: NewTaskInput }) => postCreateTaskFromLine(meeting.id, lineId, input),
    onSuccess: (detail) => {
      putDetail(detail);
      return Promise.all([client.invalidateQueries({ queryKey: queryKeys.tasks() }), client.invalidateQueries({ queryKey: queryKeys.schedules() })]);
    },
  });

  const apply = useMutation({
    mutationFn: (lineId: number) => applyLineTaskChange(meeting.id, lineId),
    onSuccess: (detail) => {
      putDetail(detail);
      return Promise.all([client.invalidateQueries({ queryKey: queryKeys.tasks() }), client.invalidateQueries({ queryKey: queryKeys.schedules() })]);
    },
  });

  /** U-10 「업무 생성」 — 거절은 그대로 던진다(드로어가 인라인). 성공하면 그 줄이 업무 줄로 바뀐 상세가 캐시에 있다. */
  const createTaskFromLine = useCallback(
    (line: MeetingLine, input: NewTaskInput): Promise<MeetingDetail> => create.mutateAsync({ lineId: line.id, input }),
    [create],
  );

  /**
   * U-6 「업무 갱신」 — **즉시 요청 · 확인 없음 · 요청 하나**. 성공 여부를 돌려주고 **던지지 않는다.**
   * 완료 전이가 실려 있었고(`payload.status==='done'` 이고 업무가 아직 `done` 이 아니었다) 성공했으면 완료 토스트.
   */
  const applyLinePayload = useCallback(
    async (line: MeetingLine): Promise<boolean> => {
      const completing = line.payload?.status === "done" && line.task?.status !== "done";
      const taskId = line.taskId;
      try {
        await apply.mutateAsync(line.id);
        if (completing && taskId !== null) {
          doneToast(taskId);
        }
        return true;
      } catch (error: unknown) {
        if (!isApiError(error)) {
          toast.error(APPLY_FAILED_MESSAGE);
          return false;
        }
        switch (error.code) {
          case API_ERROR_CODE.TASK_COMPLETION_BLOCKED:
            // **거부는 정상 경로다.** 아무것도 바뀌지 않았다 — 줄은 「업무 갱신」 그대로. 「결과 입력」은 WORK-005 와 같은 유도 훅으로
            toast.error(error.detail, {
              duration: BLOCKED_TOAST_MS,
              action:
                taskId !== null
                  ? { label: "결과 입력", onClick: () => openTaskDetailDrawer(overlay, taskId, { focusCompletion: true }) }
                  : undefined,
            });
            return false;
          case API_ERROR_CODE.INVALID_STATUS_TRANSITION:
            toast.error(error.detail);
            return false;
          case API_ERROR_CODE.INVALID_MEETING_STATUS:
            toast.error(INVALID_STATUS_MESSAGE);
            void refreshDetail();
            return false;
          default:
            if (isMeetingNotFound(error)) {
              // 업무(또는 줄)가 다른 곳에서 지워졌다 — 상세를 다시 읽으면 줄이 「삭제된 업무」 비활성으로 바뀐다
              toast.error(TASK_GONE_MESSAGE);
              void refreshDetail();
              return false;
            }
            toast.error(APPLY_FAILED_MESSAGE);
            return false;
        }
      }
    },
    [apply, doneToast, overlay, refreshDetail],
  );

  return {
    createTaskFromLine,
    applyLinePayload,
    /** 어느 줄이 요청 중인가 — 그 줄의 버튼만 비활성 + 진행 표시(U-6). */
    applyingLineId: apply.isPending ? (apply.variables ?? null) : null,
    creating: create.isPending,
  };
}
