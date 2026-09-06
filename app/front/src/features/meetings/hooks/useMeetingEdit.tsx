"use client";

/**
 * **종료 후 편집의 뮤테이션 한 벌**(SPEC-008 U-7 · §5 구현 규칙 · WP Phase 4).
 *
 * ## 낙관적 갱신 표(SPEC-008 §5 · FE §3-4)
 *
 * | 한다 | 인라인 본문 · 안건 이름 · 종류 전환(**`task` 이탈 제외**) |
 * | 하지 않는다 | **줄 삭제**(모달을 지나며 204 뒤에 제거) · `task` 이탈 전환(연결이 풀리는 것을 응답으로 확인) · 논의/결정 추가(응답 `LineItem` 뒤 append — 드로어가 응답까지 열려 있어 낙관적으로 그릴 자리가 없다) |
 *
 * 편집 대상 트랙은 `editTrackOf`(`succeeded → merged` · `failed → human`) 하나가 정한다 — 서버 `meeting_edit_service` 의 표와 같다.
 *
 * ## 실패는 U-7 규격(SPEC-002 · WORK-003 그대로)
 *
 * 실패 상태는 **`useRowFailures`** 가 든다(줄 · 안건 따로 — id 공간이 다르다). 컨트롤에는 `saveFailed` prop 으로 내려가고
 * 캡션·「다시 저장」은 **블록 아래 인라인 자리 하나**(`notice`)가 그린다. **자동 재시도 없음.**
 * 409 `invalid_meeting_status` · 404 는 「다시 저장」으로 풀 일이 아니다 — 토스트 + 상세 재조회(Case Matrix).
 *
 * ## 무효화(FE §3-3 표) — 줄 · 안건 이름 쓰기 → `['meetings','detail',id]` + `['tasks']`. 삭제 · 추가는 응답이 상세 전체가 아니라
 * (`204` · `LineItem`) `mergedSummary` 를 위해 상세를 다시 읽는다 — 화면이 세지 않는다.
 */

import { useCallback } from "react";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { AutoSaveFailureNotice, type AutoSaveFailure } from "@/components/shared/AutoSaveFailureNotice";
import { addLine, deleteLine, updateAgenda, updateLine } from "@/features/meetings/api";
import { editTrackOf, type NotesTrack } from "@/features/meetings/closeState";
import {
  autoSaveErrorToast,
  INVALID_STATUS_MESSAGE,
  isInvalidMeetingStatus,
  isMeetingNotFound,
  LINE_DELETE_FAILED_MESSAGE,
} from "@/features/meetings/errors";
import type { AddLineInput, LineKind, MeetingAgenda, MeetingDetail, MeetingLine } from "@/features/meetings/types";
import { queryKeys } from "@/lib/api/queryKeys";
import { useRowFailures } from "@/lib/hooks/useRowFailures";

/** U-7 토스트 · 캡션에 들어가는 필드 이름. */
export const LINE_FIELD_LABEL = { content: "줄 내용", kind: "줄 종류" } as const;
export const AGENDA_TITLE_LABEL = "안건 이름";

type Agendas = MeetingAgenda[];

function patchTrack(detail: MeetingDetail, track: NotesTrack, update: (agendas: Agendas) => Agendas): MeetingDetail {
  return { ...detail, agendas: { ...detail.agendas, [track]: update(detail.agendas[track]) } };
}

function patchLine(agendas: Agendas, lineId: number, update: (line: MeetingLine) => MeetingLine): Agendas {
  return agendas.map((agenda) => ({
    ...agenda,
    lines: agenda.lines.map((line) => (line.id === lineId ? update(line) : line)),
  }));
}

function putDetail(client: QueryClient, expectedId: number, detail: MeetingDetail): void {
  if (detail?.id !== expectedId) {
    if (process.env.NODE_ENV !== "production") {
      throw new Error(`회의 ${expectedId} 의 응답이 상세가 아닙니다 — 줄·안건 쓰기는 MeetingDetail 을 돌려줘야 합니다(SPEC-008 §4).`);
    }
    return;
  }
  client.setQueryData(queryKeys.meetingDetail(detail.id), detail);
}

export function useMeetingEdit(meeting: MeetingDetail) {
  const client = useQueryClient();
  const detailKey = queryKeys.meetingDetail(meeting.id);
  const track = editTrackOf(meeting);
  const lineFailures = useRowFailures();
  const agendaFailures = useRowFailures();

  const refreshDetail = useCallback(() => client.invalidateQueries({ queryKey: detailKey }), [client, detailKey]);
  const afterWrite = useCallback(
    (detail: MeetingDetail) => {
      putDetail(client, meeting.id, detail);
      return client.invalidateQueries({ queryKey: queryKeys.tasks() });
    },
    [client, meeting.id],
  );

  /** 화면이 낡아서 난 실패(409 · 404) — 표시를 켜지 않고 상세를 다시 읽는다. */
  const handleStale = useCallback(
    (error: unknown, notFoundMessage: string): boolean => {
      if (isInvalidMeetingStatus(error)) {
        toast.error(INVALID_STATUS_MESSAGE);
        void refreshDetail();
        return true;
      }
      if (isMeetingNotFound(error)) {
        toast.error(notFoundMessage);
        void refreshDetail();
        return true;
      }
      return false;
    },
    [refreshDetail],
  );

  const snapshotAndPatch = async (update: (detail: MeetingDetail) => MeetingDetail) => {
    await client.cancelQueries({ queryKey: detailKey });
    const snapshot = client.getQueryData<MeetingDetail>(detailKey);
    if (snapshot) {
      client.setQueryData<MeetingDetail>(detailKey, update(snapshot));
    }
    return { snapshot };
  };
  const rollback = (context: { snapshot?: MeetingDetail } | undefined) => {
    if (context?.snapshot) {
      client.setQueryData(detailKey, context.snapshot);
    }
  };

  const updateContent = useMutation({
    mutationFn: ({ lineId, content }: { lineId: number; content: string }) => updateLine(meeting.id, lineId, { content }),
    // 인라인 본문 — **낙관적**(§5 표). 거부할 규칙이 길이뿐이다.
    onMutate: ({ lineId, content }) =>
      track ? snapshotAndPatch((detail) => patchTrack(detail, track, (agendas) => patchLine(agendas, lineId, (line) => ({ ...line, content })))) : undefined,
    onError: (_error, _variables, context) => rollback(context),
    onSuccess: afterWrite,
  });

  const updateKind = useMutation({
    mutationFn: ({ lineId, kind }: { lineId: number; kind: LineKind; leavingTask: boolean }) => updateLine(meeting.id, lineId, { kind }),
    /**
     * 종류 전환 — 낙관적. 단 **`task` 에서 벗어나는 전환은 아니다**(§5) — `taskId`·`pendingChange` 가 풀리는 것을
     * 서버 응답으로 확인한다. 배지·버튼이 사라지는 것도 응답 뒤다.
     */
    onMutate: ({ lineId, kind, leavingTask }) =>
      track && !leavingTask
        ? snapshotAndPatch((detail) => patchTrack(detail, track, (agendas) => patchLine(agendas, lineId, (line) => ({ ...line, kind }))))
        : undefined,
    onError: (_error, _variables, context) => rollback(context),
    onSuccess: afterWrite,
  });

  /**
   * **줄 삭제 — 낙관적이지 않다.** 확인 모달을 지나고 `204` 가 온 뒤에 그 행을 캐시에서 빼고,
   * `mergedSummary` · 뒤 줄 `orderIndex` 는 상세를 다시 읽어 받는다(화면이 다시 조립하지 않는다 — §4).
   */
  const removeLine = useMutation({
    mutationFn: (lineId: number) => deleteLine(meeting.id, lineId),
    onSuccess: (_void, lineId) => {
      if (track) {
        client.setQueryData<MeetingDetail>(detailKey, (snapshot) =>
          snapshot
            ? patchTrack(snapshot, track, (agendas) =>
                agendas.map((agenda) => ({ ...agenda, lines: agenda.lines.filter((line) => line.id !== lineId) })),
              )
            : snapshot,
        );
      }
      return Promise.all([refreshDetail(), client.invalidateQueries({ queryKey: queryKeys.tasks() })]);
    },
  });

  const renameAgenda = useMutation({
    mutationFn: ({ agendaId, title }: { agendaId: number; title: string }) => updateAgenda(meeting.id, agendaId, { title }),
    // 안건 이름 — **낙관적**(§5 표). 편집 대상 트랙의 안건이다(`human` 이 아닐 수 있다 — WORK-006 `renameAgenda` 와 다른 점).
    onMutate: ({ agendaId, title }) =>
      track ? snapshotAndPatch((detail) => patchTrack(detail, track, (agendas) => agendas.map((agenda) => (agenda.id === agendaId ? { ...agenda, title } : agenda)))) : undefined,
    onError: (_error, _variables, context) => rollback(context),
    // 목록 `agendaTitles`(사람 트랙) · 미리보기가 같은 이름을 보도록 `['meetings']` 도 무효화한다(WORK-006 과 같은 표).
    onSuccess: (detail) => Promise.all([afterWrite(detail), client.invalidateQueries({ queryKey: queryKeys.meetings() })]),
  });

  /**
   * 논의 · 결정 추가(U-8) — 응답이 **`LineItem`(201)** 이라 그 안건 `lines` 끝에 붙이고, `mergedSummary` 를 위해 상세를 다시 읽는다.
   * 트랙은 응답 줄의 것이다(안건의 트랙이 곧 줄의 트랙 — §4).
   */
  const appendLine = useMutation({
    mutationFn: (input: AddLineInput) => addLine(meeting.id, input),
    onSuccess: (line: MeetingLine) => {
      const lineTrack = line.track;
      client.setQueryData<MeetingDetail>(detailKey, (snapshot) => {
        if (!snapshot || (lineTrack !== "human" && lineTrack !== "merged")) {
          return snapshot;
        }
        return patchTrack(snapshot, lineTrack, (agendas) =>
          agendas.map((agenda) =>
            agenda.id === line.agendaId && !agenda.lines.some((existing) => existing.id === line.id)
              ? { ...agenda, lines: [...agenda.lines, line] }
              : agenda,
          ),
        );
      });
      return Promise.all([refreshDetail(), client.invalidateQueries({ queryKey: queryKeys.tasks() })]);
    },
  });

  // --- U-7 배선: 성공하면 표시를 지우고, 실패하면 켠다(재요청 방법을 함께) ------------------------

  const saveLineContent = useCallback(
    async (line: MeetingLine, content: string): Promise<void> => {
      try {
        await updateContent.mutateAsync({ lineId: line.id, content });
        lineFailures.clearFailed(line.id, "content");
      } catch (error) {
        if (handleStale(error, "이미 없는 줄입니다")) {
          lineFailures.clearFailed(line.id, "content");
          return;
        }
        toast.error(autoSaveErrorToast(LINE_FIELD_LABEL.content));
        lineFailures.markFailed(line.id, "content", { retry: () => saveLineContent(line, content), attempted: content });
        // **다시 던지지 않는다** — 실패는 여기서 표시로 끝난다. 던지면 「다시 저장」의 `retry`(void 로 불린다)가
        // 두 번째 실패에서 unhandled rejection 이 된다(WORK-006 검수 `Selector` 와 같은 증상). 입력은 값 유지만 한다.
      }
    },
    [handleStale, lineFailures, updateContent],
  );

  const changeLineKind = useCallback(
    async (line: MeetingLine, kind: LineKind): Promise<void> => {
      const leavingTask = line.kind === "task" && kind !== "task";
      try {
        await updateKind.mutateAsync({ lineId: line.id, kind, leavingTask });
        lineFailures.clearFailed(line.id, "kind");
      } catch (error) {
        if (handleStale(error, "이미 없는 줄입니다")) {
          lineFailures.clearFailed(line.id, "kind");
          return;
        }
        toast.error(autoSaveErrorToast(LINE_FIELD_LABEL.kind));
        lineFailures.markFailed(line.id, "kind", { retry: () => changeLineKind(line, kind), attempted: kind });
      }
    },
    [handleStale, lineFailures, updateKind],
  );

  const renameAgendaTitle = useCallback(
    async (agenda: MeetingAgenda, title: string): Promise<void> => {
      try {
        await renameAgenda.mutateAsync({ agendaId: agenda.id, title });
        agendaFailures.clearFailed(agenda.id, "title");
      } catch (error) {
        if (handleStale(error, "이미 없는 안건입니다")) {
          agendaFailures.clearFailed(agenda.id, "title");
          return;
        }
        toast.error(autoSaveErrorToast(AGENDA_TITLE_LABEL));
        agendaFailures.markFailed(agenda.id, "title", { retry: () => renameAgendaTitle(agenda, title), attempted: title });
        // 다시 던지지 않는다 — 위 `saveLineContent` 와 같은 이유.
      }
    },
    [agendaFailures, handleStale, renameAgenda],
  );

  /**
   * 「제거」 확인 뒤 — 실패해도 **던지지 않는다**: 모달은 닫히고 줄은 그대로 남고 토스트 「삭제하지 못했습니다」(Case Matrix).
   * 「다시 저장」 표시가 아니다 — 사용자가 다시 「제거」를 누른다.
   */
  const deleteLineConfirmed = useCallback(
    async (line: MeetingLine): Promise<boolean> => {
      try {
        await removeLine.mutateAsync(line.id);
        lineFailures.clearRow(line.id);
        return true;
      } catch (error) {
        if (!handleStale(error, "이미 없는 줄입니다")) {
          toast.error(LINE_DELETE_FAILED_MESSAGE);
        }
        return false;
      }
    },
    [handleStale, lineFailures, removeLine],
  );

  /** 드로어(U-8)의 「추가」 — 거절은 그대로 던진다. 드로어가 인라인으로 붙인다. */
  const addLineFromDrawer = useCallback(
    (input: AddLineInput): Promise<MeetingLine> => appendLine.mutateAsync(input),
    [appendLine],
  );

  const failureList: AutoSaveFailure[] = [
    ...Object.entries(lineFailures.failures).flatMap(([id, row]) =>
      Object.entries(row).map(([field, failure]) => ({
        field: `line:${id}:${field}`,
        label: LINE_FIELD_LABEL[field as keyof typeof LINE_FIELD_LABEL] ?? field,
        onRetry: () => void failure.retry(),
      })),
    ),
    ...Object.entries(agendaFailures.failures).flatMap(([id, row]) =>
      Object.entries(row).map(([field, failure]) => ({
        field: `agenda:${id}:${field}`,
        label: AGENDA_TITLE_LABEL,
        onRetry: () => void failure.retry(),
      })),
    ),
  ];

  const busy = updateContent.isPending || updateKind.isPending || renameAgenda.isPending;

  return {
    /** 편집 대상 트랙 — `null` 이면 편집이 없다(`generating` 잠금 · 그 밖 상태). */
    track,
    saveLineContent,
    changeLineKind,
    renameAgendaTitle,
    deleteLineConfirmed,
    addLineFromDrawer,
    adding: appendLine.isPending,
    deleting: removeLine.isPending,
    lineSaveFailed: (line: MeetingLine, field: "content" | "kind") => lineFailures.hasFailed(line.id, field),
    agendaSaveFailed: (agenda: MeetingAgenda) => agendaFailures.hasFailed(agenda.id, "title"),
    /** U-7 「값 유지」 — 실패 뒤 캐시는 서버 값으로 돌아가므로 넣으려던 값을 따로 든다. */
    lineAttempted: (line: MeetingLine, field: "content" | "kind") => lineFailures.attemptedValue(line.id, field),
    agendaAttempted: (agenda: MeetingAgenda) => agendaFailures.attemptedValue(agenda.id, "title"),
    /** 캡션·「다시 저장」의 **블록당 하나뿐인 자리**. */
    notice: <AutoSaveFailureNotice busy={busy} failures={failureList} />,
  };
}
