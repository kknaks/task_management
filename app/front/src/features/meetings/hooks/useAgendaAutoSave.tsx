"use client";

/**
 * 시작 전 안건의 **자동 저장 한 벌**(SPEC-006 U-4 · SPEC-002 U-7 구현 규약 · WORK-003 U-7 그대로).
 *
 * - **실패 상태는 컴포넌트 내부 state 가 아니다** — `useRowFailures`(WORK-003)가 들고
 *   `MeetingAgendaList` 에는 `hasFailed(id)` · `notice` 로 내려간다. 소유자는 **이 훅을 부른 화면**이다
 * - 캡션·「다시 저장」은 **블록 아래 인라인 자리 하나**(`AutoSaveFailureNotice`)
 * - **자동 재시도가 없다** — `retry` 는 「다시 저장」이 눌린 만큼만 불린다(DEC-001 §7)
 * - 제목 수정은 **낙관적**이고(§5 표) 실패하면 되돌아간다 — 되돌아가기만 하고 말이 없으면
 *   사용자는 저장된 줄 안다. 그래서 롤백 뒤에도 U-7 표시가 남는다
 * - 409 `invalid_meeting_status` · 404 는 「다시 저장」으로 풀 일이 아니다 — **상세 재조회**(Case Matrix)
 */

import { useCallback } from "react";
import { toast } from "sonner";

import { AutoSaveFailureNotice, type AutoSaveFailure } from "@/components/shared/AutoSaveFailureNotice";
import {
  autoSaveErrorToast,
  isInvalidMeetingStatus,
  isMeetingNotFound,
  INVALID_STATUS_MESSAGE,
} from "@/features/meetings/errors";
import { useMeetingMutations } from "@/features/meetings/hooks/useMeetingMutations";
import { useRowFailures } from "@/lib/hooks/useRowFailures";

const AGENDA_LABEL = "안건";

export function useAgendaAutoSave(meetingId: number) {
  const mutations = useMeetingMutations(meetingId);
  const { failures, markFailed, clearFailed, clearRow, hasFailed } = useRowFailures();

  /** 화면이 낡아서 난 실패 — 표시를 켜지 않고 상세를 다시 읽는다. */
  const handleStale = useCallback(
    (error: unknown): boolean => {
      if (isInvalidMeetingStatus(error)) {
        toast.error(INVALID_STATUS_MESSAGE);
        void mutations.refreshDetail();
        return true;
      }
      if (isMeetingNotFound(error)) {
        toast.error("이미 없는 안건입니다");
        void mutations.refreshDetail();
        return true;
      }
      return false;
    },
    [mutations],
  );

  const rename = useCallback(
    async (agendaId: number, title: string): Promise<void> => {
      try {
        await mutations.renameAgenda.mutateAsync({ agendaId, title });
        clearFailed(agendaId, "title");
      } catch (error) {
        if (handleStale(error)) {
          clearFailed(agendaId, "title");
          return;
        }
        toast.error(autoSaveErrorToast(AGENDA_LABEL));
        markFailed(agendaId, "title", {
          retry: () => rename(agendaId, title),
          attempted: title,
        });
      }
    },
    [clearFailed, handleStale, markFailed, mutations.renameAgenda],
  );

  const remove = useCallback(
    async (agendaId: number): Promise<void> => {
      try {
        await mutations.removeAgenda.mutateAsync(agendaId);
        clearRow(agendaId);
      } catch (error) {
        if (handleStale(error)) {
          return;
        }
        toast.error(autoSaveErrorToast(AGENDA_LABEL));
        markFailed(agendaId, "remove", { retry: () => remove(agendaId) });
      }
    },
    [clearRow, handleStale, markFailed, mutations.removeAgenda],
  );

  const add = useCallback(
    async (title: string): Promise<boolean> => {
      try {
        await mutations.addAgenda.mutateAsync(title);
        return true;
      } catch (error) {
        if (!handleStale(error)) {
          toast.error(autoSaveErrorToast(AGENDA_LABEL));
        }
        return false;
      }
    },
    [handleStale, mutations.addAgenda],
  );

  const failureList: AutoSaveFailure[] = Object.entries(failures).flatMap(([id, row]) =>
    Object.entries(row).map(([field, failure]) => ({
      field: `${id}:${field}`,
      label: AGENDA_LABEL,
      onRetry: () => void failure.retry(),
    })),
  );

  const busy =
    mutations.renameAgenda.isPending || mutations.removeAgenda.isPending || mutations.addAgenda.isPending;

  return {
    add,
    rename,
    remove,
    adding: mutations.addAgenda.isPending,
    hasFailed: (agendaId: number) => hasFailed(agendaId, "title") || hasFailed(agendaId, "remove"),
    /** 캡션·「다시 저장」의 **블록당 하나뿐인 자리**. */
    notice: <AutoSaveFailureNotice busy={busy} failures={failureList} />,
  };
}
