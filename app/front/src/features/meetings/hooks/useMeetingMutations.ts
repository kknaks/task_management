"use client";

/**
 * 회의 뮤테이션 — 생성 · 수정 · 삭제 · 시작 · 안건 · 첨부(SPEC-006 §4 · FE §3-3).
 *
 * ## 낙관적 갱신은 **안건 제목 인라인 편집 하나**(SPEC-006 §5 표)
 *
 * > 안건 추가·삭제 · 일시·유형·프로젝트 · 첨부 · 「회의 시작」 — **하지 않는다.**
 * > 응답이 `MeetingDetail` 전체이고 `orderIndex` 를 서버가 정하거나, 서버가 거부할 수 있다.
 *
 * ## 무효화 표(FE §3-3) — 표에 없는 무효화를 하지 않는다
 *
 * 생성·수정·삭제·시작 → `['meetings']` 전부 + **일시가 바뀌었으면 `['schedules']`**.
 * 안건·첨부는 목록의 `agendaTitles`·`attachmentCount` 가 딸려 있어 `['meetings']` 를 무효화한다.
 *
 * ## 캐시에 쓰는 것은 **상세 전체**뿐이다
 *
 * `apiFetch<T>` 가 무검증 캐스팅이라 `putDetail` 이 **id 를 대조**한다(WORK-004 검수 F-4 교훈).
 */

import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";

import {
  addAgenda,
  addLine,
  addMeetingAttachment,
  createMeeting,
  deleteAgenda,
  deleteMeeting,
  deleteMeetingAttachment,
  startMeeting,
  updateAgenda,
  updateMeeting,
} from "@/features/meetings/api";
import type {
  AddLineInput,
  AddMeetingAttachmentInput,
  AgendaState,
  CreateMeetingInput,
  MeetingDetail,
  MeetingLine,
  UpdateMeetingInput,
} from "@/features/meetings/types";
import { queryKeys } from "@/lib/api/queryKeys";

function invalidateMeetings(client: QueryClient, scheduleChanged = false): Promise<unknown> {
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.meetings() }),
    ...(scheduleChanged ? [client.invalidateQueries({ queryKey: queryKeys.schedules() })] : []),
  ]);
}

/** 일시가 바뀌었나 — `schedule` 파생 행을 다시 읽어야 하는지 가른다. */
function touchesTime(input: UpdateMeetingInput): boolean {
  return "startAt" in input;
}

function putDetail(client: QueryClient, expectedId: number, detail: MeetingDetail): void {
  if (detail?.id !== expectedId) {
    if (process.env.NODE_ENV !== "production") {
      throw new Error(
        `회의 ${expectedId} 의 응답이 상세가 아닙니다(받은 id: ${String(detail?.id)}) — ` +
          "쓰기 표면은 갱신된 MeetingDetail 을 돌려줘야 합니다(SPEC-006 §4).",
      );
    }
    return;
  }
  client.setQueryData(queryKeys.meetingDetail(detail.id), detail);
}

export function useMeetingMutations(meetingId?: number) {
  const client = useQueryClient();
  const detailKey = queryKeys.meetingDetail(meetingId ?? 0);

  const afterDetail = (detail: MeetingDetail, scheduleChanged = false) => {
    putDetail(client, detail.id, detail);
    return invalidateMeetings(client, scheduleChanged);
  };

  return {
    /** **화면이 낡았을 때 맞추는 문** — 409 상태 가드·404 자식이 이걸 부른다(Case Matrix). */
    refreshDetail: () =>
      client.invalidateQueries({ queryKey: detailKey }),
    refresh: () => invalidateMeetings(client),

    create: useMutation({
      mutationFn: (input: CreateMeetingInput) => createMeeting(input),
      // 생성은 일시가 함께 오므로 일정도 무효화한다(§3-3 표).
      onSuccess: (detail) => afterDetail(detail, true),
    }),

    update: useMutation({
      mutationFn: ({ id, input }: { id: number; input: UpdateMeetingInput }) =>
        updateMeeting(id, input),
      // 일시·유형·프로젝트는 **낙관적으로 하지 않는다**(§5 표) — 겹침·삭제된 항목이 거부할 수 있다.
      onSuccess: (detail, variables) => afterDetail(detail, touchesTime(variables.input)),
    }),

    remove: useMutation({
      mutationFn: (id: number) => deleteMeeting(id),
      onSuccess: () => invalidateMeetings(client, true),
    }),

    /**
     * 상태 전이 — 낙관적이지 않다. 성공하면 캐시가 `recording` 이 되고 **스위치가 바뀐다**.
     * 함께 「이 세션에서 시작했다」 표지를 세운다 — 회의 중 화면이 그때만 WS 를 바로 연다(SPEC-007 S-1 ·
     * 새로고침에는 표지가 없어 `paused/stream` 으로 시작한다).
     */
    start: useMutation({
      mutationFn: (id: number) => startMeeting(id),
      onSuccess: (detail) => {
        client.setQueryData(queryKeys.meetingStartIntent(detail.id), true);
        return afterDetail(detail);
      },
    }),

    addAgenda: useMutation({
      mutationFn: (title: string) => addAgenda(meetingId as number, title),
      onSuccess: (detail) => afterDetail(detail),
    }),
    renameAgenda: useMutation({
      mutationFn: ({ agendaId, title }: { agendaId: number; title: string }) =>
        updateAgenda(meetingId as number, agendaId, { title }),
      /** **안건 제목 인라인 편집만 낙관적**이다(§5 표) — 거부할 규칙이 없다(길이만). */
      onMutate: async ({ agendaId, title }) => {
        await client.cancelQueries({ queryKey: detailKey });
        const snapshot = client.getQueryData<MeetingDetail>(detailKey);
        if (snapshot) {
          client.setQueryData<MeetingDetail>(detailKey, {
            ...snapshot,
            agendas: {
              ...snapshot.agendas,
              human: snapshot.agendas.human.map((agenda) =>
                agenda.id === agendaId ? { ...agenda, title } : agenda,
              ),
            },
          });
        }
        return { snapshot };
      },
      onError: (_error, _variables, context) => {
        if (context?.snapshot) {
          client.setQueryData(detailKey, context.snapshot);
        }
      },
      onSuccess: (detail) => afterDetail(detail),
    }),
    removeAgenda: useMutation({
      mutationFn: (agendaId: number) => deleteAgenda(meetingId as number, agendaId),
      onSuccess: () => Promise.all([client.invalidateQueries({ queryKey: detailKey }), invalidateMeetings(client)]),
    }),

    // --- 회의 중(SPEC-007) — 무효화는 `['meetings','detail',id]` 만(WP 캐시 키 행) ------------

    /**
     * 사람 줄 추가. 응답이 **`LineItem`** 이라 상세 캐시의 그 안건 `lines` 끝에 붙인다 — 서버 응답 뒤에만(낙관적 없음).
     * 목록 무효화는 없다(`agendaTitles`·`attachmentCount` 가 안 바뀐다).
     */
    addLine: useMutation({
      mutationFn: (input: AddLineInput) => addLine(meetingId as number, input),
      onSuccess: (line: MeetingLine) => {
        client.setQueryData<MeetingDetail>(detailKey, (snapshot) => {
          if (!snapshot) {
            return snapshot;
          }
          return {
            ...snapshot,
            agendas: {
              ...snapshot.agendas,
              human: snapshot.agendas.human.map((agenda) =>
                agenda.id === line.agendaId && !agenda.lines.some((existing) => existing.id === line.id)
                  ? { ...agenda, lines: [...agenda.lines, line] }
                  : agenda,
              ),
            },
          };
        });
      },
    }),
    /**
     * 안건 상태 — `active`(전환) · `done`(완료 → 다음 `next` 가 활성) · `next`(되돌림). 응답이 `MeetingDetail` 전체다
     * (이전 활성이 `next` 로 함께 바뀐다). **낙관적이지 않다** — 실패는 토스트 + 배지 원복(Case Matrix).
     */
    setAgendaState: useMutation({
      mutationFn: ({ agendaId, state }: { agendaId: number; state: AgendaState }) =>
        updateAgenda(meetingId as number, agendaId, { state }),
      onSuccess: (detail) => putDetail(client, detail.id, detail),
    }),

    addAttachment: useMutation({
      mutationFn: (input: AddMeetingAttachmentInput) =>
        addMeetingAttachment(meetingId as number, input),
      onSuccess: (detail) => afterDetail(detail),
    }),
    removeAttachment: useMutation({
      mutationFn: (attachmentId: number) =>
        deleteMeetingAttachment(meetingId as number, attachmentId),
      onSuccess: () => Promise.all([client.invalidateQueries({ queryKey: detailKey }), invalidateMeetings(client)]),
    }),
  };
}
