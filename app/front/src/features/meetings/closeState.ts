/**
 * **종료 후 상태 판정 한 곳**(SPEC-008 §4 Validation · ERD M-20 · M-5-e · DEC-003 §1 표 L45).
 *
 * 화면이 `status`·`integrationState` 를 각자 읽어 트랙을 고르면 규칙이 갈린다 — 회의록 탭이 그리는 트랙 ·
 * 편집 대상 트랙 · 배지 어휘를 **여기서만** 정한다. 트리 컴포넌트(`AgendaLineTree` 계열)는 여전히 트랙을 모른다 —
 * 이 함수의 결과를 **prop 으로** 받는다.
 */

import type { AgendaBadge } from "@/features/meetings/components/AgendaHeader";
import type { AgendaState, MeetingAgenda, MeetingDetail, MeetingLine, MeetingTrack } from "@/features/meetings/types";

/** 회의록 탭이 그리는 트랙 = 편집 대상 트랙(M-20 「대상 트랙은 편집 모드와 같다」). */
export type NotesTrack = Extract<MeetingTrack, "human" | "merged">;

/**
 * 회의록 탭이 **그리는** 트랙 — `ended`+`succeeded` 면 최종 회의록, 그 밖(생성중 · 실패)은 사람 원본(U-1 · U-2 · U-3).
 * `scheduled`·`recording` 은 WORK-006·007 화면이라 여기 오지 않지만, 드로어(U-4)가 스냅숏으로 그릴 때는 사람 원본이다.
 */
export function notesTrackOf(meeting: Pick<MeetingDetail, "status" | "integrationState">): NotesTrack {
  return meeting.status === "ended" && meeting.integrationState === "succeeded" ? "merged" : "human";
}

/**
 * **편집 대상 트랙** — `ended` 에서만 있다. `succeeded → merged` · `failed → human`. `generating` 은 잠금(`null`).
 * 트랙 규칙은 서버 `meeting_edit_service` 가 정본이고 화면은 같은 표를 읽을 뿐이다.
 */
export function editTrackOf(meeting: Pick<MeetingDetail, "status" | "integrationState">): NotesTrack | null {
  if (meeting.status !== "ended") {
    return null;
  }
  return meeting.integrationState === "succeeded" ? "merged" : "human";
}

/** 회의록 탭에 그릴 안건 — `notesTrackOf` 가 고른 트랙. */
export function notesAgendasOf(meeting: MeetingDetail): MeetingAgenda[] {
  return meeting.agendas[notesTrackOf(meeting)];
}

/**
 * 최종 회의록 줄의 화살표 — `detail`·`evidence` 둘 다 없으면 없다(SPEC-008 U-5).
 * 상세 본문(`MeetingDetailBody`)과 목록 미리보기(`MeetingPreviewPanel` — SPEC-006 §7 「SPEC-008 규격을 읽기 전용으로 그대로」)가
 * 같은 판정을 `AgendaLineTree` 의 `expandable` 로 넘긴다.
 */
export function notesExpandable(line: MeetingLine): boolean {
  return Boolean(line.detail) || line.evidence.length > 0;
}

/**
 * **종료 후 어휘**(DEC-003 §1 표 L45) — `next` 는 「**다음 논의로**」. 회의 중 「대기」는 WORK-007 `LIVE_AGENDA_BADGE` 의 것이다.
 * 같은 `state` 값이지만 뜻이 둘이라 문구를 하나로 통일하지 않는다(SPEC-008 §7). 시안 L1525 「다음으로」는 정정됐다.
 * `active` 는 `/end` 가 `done` 으로 바꾸므로 종료 후에는 오지 않지만(M-5-c) 매핑은 남긴다 — 값이 와도 숨기지 않는다.
 */
export const ENDED_AGENDA_BADGE: Record<AgendaState, Exclude<AgendaBadge, null>> = {
  active: { tone: "active", label: "논의 중" },
  done: { tone: "done", label: "완료" },
  next: { tone: "next", label: "다음 논의로" },
};

/** AI 가 새로 만든 안건 — `state=null`(최종 회의록의 AI 신설 안건 · AI 탭의 `sourceAgendaId=null` 안건). SPEC-007 U-4 와 같은 표기. */
export const AI_AGENDA_CAPTION: Exclude<AgendaBadge, null> = { tone: "caption", label: "AI 안건" };

/**
 * 회의록 탭(사람 원본 · 최종 회의록)의 배지 — `state` 가 있으면 종료 후 어휘, 없으면 AI 신설 안건 캡션(U-3).
 * 최종 회의록에서 `state=null` 은 「어느 사람 안건에도 안 붙은 AI 안건」뿐이다(②가 낸 신설 안건 — M-8).
 */
export function endedNotesBadge(agenda: MeetingAgenda): AgendaBadge {
  return agenda.state ? ENDED_AGENDA_BADGE[agenda.state] : AI_AGENDA_CAPTION;
}

/**
 * AI 요약 탭의 배지 — SPEC-007 U-4 그대로: 미러 안건은 원본 사람 안건의 `state`, 신설 안건은 「AI 안건」 캡션.
 * 종료 후라 어휘만 `ENDED_AGENDA_BADGE` 다.
 */
export function endedAiBadge(agenda: MeetingAgenda, humanById: ReadonlyMap<number, MeetingAgenda>): AgendaBadge {
  if (agenda.sourceAgendaId === null) {
    return AI_AGENDA_CAPTION;
  }
  const source = humanById.get(agenda.sourceAgendaId);
  return source?.state ? ENDED_AGENDA_BADGE[source.state] : null;
}
