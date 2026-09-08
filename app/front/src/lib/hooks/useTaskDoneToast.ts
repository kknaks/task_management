"use client";

/**
 * **완료 토스트 「완료 처리했습니다 · 실행취소」 하나**(SPEC-004 U-6 · WORK-005).
 *
 * `useTaskStatus`(리스트 셀 · 상세 드롭다운 · 칸반)와 **회의록의 「업무 갱신」**(SPEC-008 U-6 · WORK-008 Phase 5)이
 * 같은 전이를 지나므로 같은 토스트를 띄운다 — 「같은 전이이기 때문이다」(U-6 문구). 그래서 토스트를 여기 한 파일로 뽑았다.
 * 회의록이 자기 토스트를 만들면 문구 · 수명 · 실행취소 실패 안내가 둘이 된다.
 *
 * `features/tasks/hooks/` 에 있던 것을 **`lib/hooks/` 로 올렸다**(WORK-008 검수 F-1 · WORK-006 검수 W-1 → G-5 와 같은 방식) —
 * 두 영역이 쓰는 훅은 배럴로 내주지 않고 `lib/` 에 둔다(frontend/README.md §2 규칙 4).
 *
 * **실행취소는 서버가 조건을 판정한다**(4초 · 마지막 로그) — 화면 타이머는 표시용이고, 늦게 눌리면
 * `undo_not_available` 이 같은 문구로 돌아온다. 실행취소 자체는 SPEC-004 `POST /api/tasks/{id}/status/undo` 그대로다.
 */

import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { undoTaskStatus } from "@/lib/api/tasks";
import { API_ERROR_CODE, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/queryKeys";

/** 완료 토스트 4초(U-6). 거부 토스트(6초)는 `useTaskStatus` 가 갖는다. */
export const DONE_TOAST_MS = 4000;

export function useTaskDoneToast(options: {
  /** 실행취소가 성공한 뒤 — 호출자가 자기 캐시(예: 회의 상세)를 다시 읽는다. `['tasks']` 는 여기서 무효화한다. */
  onUndone?: () => void;
} = {}) {
  const client = useQueryClient();
  const { onUndone } = options;

  const undo = useMutation({
    mutationFn: (id: number) => undoTaskStatus(id),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.tasks() }),
  });

  return useCallback(
    (id: number) => {
      toast.success("완료 처리했습니다", {
        duration: DONE_TOAST_MS,
        action: {
          label: "실행취소",
          onClick: () => {
            undo
              .mutateAsync(id)
              .then(() => onUndone?.())
              .catch((error: unknown) => {
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
    [onUndone, undo],
  );
}
