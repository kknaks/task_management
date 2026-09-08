"use client";

/**
 * **업무를 바꾸는 요청 둘 — 「넣기」뿐이다**(SPEC-008 U-6 · U-9 · U-10 · MF-66).
 *
 * | 함수 | 요청 | 언제 |
 * |---|---|---|
 * | `insertNewTask(line, input)` | `POST …/lines/{id}/task` | 액션 줄 「넣기」 — 업무를 만든다(그 줄이 업무 줄이 된다) |
 * | `applyTaskUpdate(line, input)` | `PATCH …/lines/{id}/task` | 업무 줄 「넣기」 — 헤더 셀렉터의 업무에 **변경분을 한 요청으로** 반영한다 |
 *
 * **`payload` 저장(「저장」)은 여기 없다** — 그것은 줄을 고치는 것이라 `useMeetingEdit.savePayload` 가 한다(업무 API 를 지나지 않는다).
 *
 * ## 완료 게이트의 네 번째 진입점 — 그러나 **판정은 여기 없다**
 *
 * 서버 `task_service` 가 그래프 · 게이트 · 로그 · 실적을 판정하고 거부는 예외로 온다. 이 훅은 그 답을 **WORK-005 규격의 토스트**로
 * 옮길 뿐이다 — 전이 가능 여부·결과자료 유무를 여기서 미리 판단하지 않는다(SPEC-004 §5). 업무 API 를 직접 부르지 않는다.
 * **회의록은 `done` 을 보내지 않으므로**(MF-59 — 상태 값이 `todo`·`in_progress` 둘뿐) 완료 토스트가 여기서 뜰 일이 없다.
 *
 * | 응답 | 화면(SPEC-008 §4 Case Matrix · SPEC-004 U-6) |
 * |---|---|
 * | 200 · 201 | `payload` 비워짐 → 「갱신 완료」. 토스트 없음 — 버튼이 바뀌는 것이 결과다 |
 * | 422 `task_completion_blocked` | 거부 토스트(6초) + 「결과 입력」 → 그 업무 상세 드로어의 완료 카드로. 줄은 그대로 |
 * | 409 `invalid_status_transition` | 토스트 「이 상태로는 바꿀 수 없습니다」. **전부 롤백** — `payload` 가 남는다 |
 * | 404 | 업무가 지워졌다 — 상세 재조회(줄이 「삭제된 업무」로 바뀐다) |
 * | 409 `invalid_meeting_status` | 토스트 + 상세 재조회(화면이 낡았다) |
 * | 5xx · 네트워크 | 토스트 「업무를 갱신하지 못했습니다」 |
 *
 * ## 낙관적 갱신을 하지 않는다 — 거부가 정상 경로다(FE §3-4). 두 요청 모두 응답 `MeetingDetail` 을 캐시에 놓는다.
 * ## 무효화 — 업무가 바뀌었으므로 `['tasks']` · 기한·시작일이 바뀔 수 있으므로 `['schedules']` 도(FE §3-3 표).
 *
 * **드로어가 받는 실패** — 두 함수 모두 **던진다**. 드로어가 열린 채 인라인으로 붙이고(U-9 · U-10 「제출 중 · 실패」),
 * 토스트가 필요한 코드(전이 거부 · 게이트)는 여기서 띄운 뒤 다시 던진다.
 */

import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

// `features/tasks` 에서 가져오는 것은 배럴의 허용 이름뿐이다(§2 규칙 4 예외 — 정적 검사 ⑨).
import { openTaskDetailDrawer } from "@/features/tasks";
import { applyLineTaskUpdate, createTaskFromLine } from "@/features/meetings/api";
import { INVALID_STATUS_MESSAGE, isMeetingNotFound } from "@/features/meetings/errors";
import type { MeetingDetail, MeetingLine, NewTaskInput, TaskUpdateInput } from "@/features/meetings/types";
import { API_ERROR_CODE, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/queryKeys";
import { useOverlay } from "@/lib/overlay/OverlayProvider";

/** 거부 토스트 6초 — 할 일(「결과 입력」)이 있는 토스트라 더 길다(SPEC-004 U-6). */
const BLOCKED_TOAST_MS = 6000;
export const APPLY_FAILED_MESSAGE = "업무를 갱신하지 못했습니다";
export const TASK_GONE_MESSAGE = "삭제된 업무입니다";

export function useMeetingTaskLink(meeting: MeetingDetail) {
  const client = useQueryClient();
  const overlay = useOverlay();
  const detailKey = queryKeys.meetingDetail(meeting.id);

  const refreshDetail = useCallback(() => client.invalidateQueries({ queryKey: detailKey }), [client, detailKey]);

  const settle = useCallback(
    (detail: MeetingDetail) => {
      client.setQueryData(detailKey, detail);
      return Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.tasks() }),
        client.invalidateQueries({ queryKey: queryKeys.schedules() }),
      ]);
    },
    [client, detailKey],
  );

  const create = useMutation({
    mutationFn: ({ lineId, input }: { lineId: number; input: NewTaskInput }) => createTaskFromLine(meeting.id, lineId, input),
    onSuccess: settle,
  });

  const update = useMutation({
    mutationFn: ({ lineId, input }: { lineId: number; input: TaskUpdateInput }) => applyLineTaskUpdate(meeting.id, lineId, input),
    onSuccess: settle,
  });

  /** 거부를 **토스트로 옮기고 다시 던진다** — 드로어가 열린 채 인라인도 붙일 수 있게. */
  const report = useCallback(
    (error: unknown, taskId: number | null): never => {
      if (!isApiError(error)) {
        toast.error(APPLY_FAILED_MESSAGE);
        throw error;
      }
      switch (error.code) {
        case API_ERROR_CODE.TASK_COMPLETION_BLOCKED:
          // **거부는 정상 경로다.** 아무것도 바뀌지 않았다 — `payload` 가 남는다
          toast.error(error.detail, {
            duration: BLOCKED_TOAST_MS,
            action: taskId !== null ? { label: "결과 입력", onClick: () => openTaskDetailDrawer(overlay, taskId, { focusCompletion: true }) } : undefined,
          });
          break;
        case API_ERROR_CODE.INVALID_STATUS_TRANSITION:
          toast.error(error.detail);
          break;
        case API_ERROR_CODE.INVALID_MEETING_STATUS:
          toast.error(INVALID_STATUS_MESSAGE);
          void refreshDetail();
          break;
        default:
          if (isMeetingNotFound(error)) {
            toast.error(TASK_GONE_MESSAGE);
            void refreshDetail();
            break;
          }
          toast.error(APPLY_FAILED_MESSAGE);
      }
      throw error;
    },
    [overlay, refreshDetail],
  );

  /** U-10 「넣기」 — 업무를 만든다. 그 줄이 업무 줄로 바뀐 상세가 응답이다. */
  const insertNewTask = useCallback(
    async (line: MeetingLine, input: NewTaskInput): Promise<void> => {
      try {
        await create.mutateAsync({ lineId: line.id, input });
      } catch (error) {
        report(error, null);
      }
    },
    [create, report],
  );

  /** U-9 「넣기」 — 헤더 셀렉터의 업무에 변경분을 반영한다. 거부되면 **전부 롤백**이고 `payload` 가 남는다. */
  const applyTaskUpdate = useCallback(
    async (line: MeetingLine, input: TaskUpdateInput): Promise<void> => {
      try {
        await update.mutateAsync({ lineId: line.id, input });
      } catch (error) {
        report(error, input.taskId);
      }
    },
    [report, update],
  );

  return {
    insertNewTask,
    applyTaskUpdate,
    /** 어느 줄이 요청 중인가 — 그 줄의 버튼만 비활성 + 진행 표시(U-6). */
    busyLineId: update.isPending ? (update.variables?.lineId ?? null) : create.isPending ? (create.variables?.lineId ?? null) : null,
  };
}
