/**
 * 회의 종료 테스트 시드 — 생성중 · 종료(성공 · 실패) 상세와 트랜스크립트. **테스트 파일이 아니다.**
 * 「앱 창 확인」 항목을 테스트로 옮기는 데 여러 파일이 같은 시드를 쓴다(WORK-008 → WORK-012 로 갱신).
 */

import { meetingDetail } from "@/features/meetings/testUtils";
import type { MeetingAgenda, MeetingDetail, MeetingLine, TranscriptResponse } from "@/features/meetings/types";

export const STARTED = "2026-08-27T00:30:00Z";

export function line(partial: Partial<MeetingLine> & Pick<MeetingLine, "id" | "agendaId" | "track" | "kind" | "content">): MeetingLine {
  return {
    detail: null, evidence: [], orderIndex: partial.id, taskId: null, payload: null,
    task: null, createdAt: "2026-08-27T00:34:00Z", ...partial,
  };
}

export const TASK_SUMMARY = { id: 101, title: "제품 소개서 내용 업데이트", status: "in_progress", dueDate: "2026-08-29", isDeleted: false, workType: { id: 3, name: "문서·보고", colorToken: "steel", isDeleted: false } };

/** 사람 원본 — 회의 중 쓴 것 그대로(`active` 는 `/end` 가 `done` 으로 바꿨다). */
export const HUMAN: MeetingAgenda[] = [
  { id: 301, track: "human", title: "개정 대상 섹션 확정", orderIndex: 0, state: "done", sourceAgendaId: null, lines: [
    line({ id: 120, agendaId: 301, track: "human", kind: "discussion", content: "제품 개요 · 기능은 유지, 도입 사례 분량이 과다" }),
    line({ id: 121, agendaId: 301, track: "human", kind: "decision", content: "도입 사례는 3건만 유지하고 나머지는 별도 페이지로 분리한다.", createdAt: "2026-08-27T00:36:00Z" }),
  ] },
  { id: 302, track: "human", title: "디자인 반영 일정과 검수 방식", orderIndex: 1, state: "done", sourceAgendaId: null, lines: [
    line({ id: 122, agendaId: 302, track: "human", kind: "action", content: "소개서 개정본 검수 일정 잡기" }),
  ] },
  { id: 303, track: "human", title: "가격 표기 문구 처리 방향", orderIndex: 2, state: "next", sourceAgendaId: null, lines: [] },
];

export const AI: MeetingAgenda[] = [
  { id: 40, track: "ai", title: "개정 대상 섹션 확정", orderIndex: 0, state: null, sourceAgendaId: 301, lines: [
    line({ id: 210, agendaId: 40, track: "ai", kind: "decision", content: "AI: 도입 사례는 3건만", detail: "도입 사례 6건 중 3건이 서로 유사해 …", evidence: [{ fromMs: 574_000, toMs: 576_000 }], createdAt: "2026-08-27T00:41:02Z" }),
    line({ id: 214, agendaId: 40, track: "ai", kind: "task", content: "제품 소개서 내용 업데이트", taskId: 101, task: TASK_SUMMARY, payload: { dueDate: "2026-09-02", status: "in_progress", note: "검수 일정 변경" }, createdAt: "2026-08-27T00:41:03Z" }),
  ] },
  { id: 41, track: "ai", title: "경쟁사 요금제 비교", orderIndex: 5, state: null, sourceAgendaId: null, lines: [
    line({ id: 220, agendaId: 41, track: "ai", kind: "discussion", content: "AI: 경쟁사 요금제를 비교했다", evidence: [{ fromMs: 900_000, toMs: 905_000 }], createdAt: "2026-08-27T00:50:00Z" }),
  ] },
];

/**
 * **최종 회의록**(`track='merged'`) — ② 가 재전사 스크립트를 다시 읽고 한 벌로 낸 것(MF-56).
 * 통합 규칙(사람 줄 계승 · `source_*_line_id`)은 없어졌다 — 안건 넷 · 줄 다섯(논의 2 · 결정 1 · 액션 1 · 업무 1)이고
 * `mergedSummary` 다섯이 **이 트리와 정확히 같은 수**다(MF-25).
 */
export const MERGED: MeetingAgenda[] = [
  { id: 71, track: "merged", title: "개정 대상 섹션 확정", orderIndex: 0, state: "done", sourceAgendaId: 301, lines: [
    line({ id: 300, agendaId: 71, track: "merged", kind: "discussion", content: "제품 개요 · 기능은 유지, 도입 사례 분량이 과다", orderIndex: 0 }),
    line({ id: 301, agendaId: 71, track: "merged", kind: "decision", content: "도입 사례는 3건만 유지하고 나머지는 별도 페이지로 분리한다.", orderIndex: 1, detail: "도입 사례 6건 중 3건이 서로 유사해 …", evidence: [{ fromMs: 574_000, toMs: 576_000 }], createdAt: "2026-08-27T00:36:00Z" }),
    line({ id: 305, agendaId: 71, track: "merged", kind: "task", content: "제품 소개서 내용 업데이트", orderIndex: 2, taskId: 101, task: TASK_SUMMARY, payload: { dueDate: "2026-09-02", status: "in_progress", note: "검수 일정 변경" }, createdAt: "2026-08-27T00:41:03Z" }),
  ] },
  { id: 72, track: "merged", title: "디자인 반영 일정과 검수 방식", orderIndex: 1, state: "done", sourceAgendaId: 302, lines: [
    line({ id: 310, agendaId: 72, track: "merged", kind: "action", content: "소개서 개정본 검수 일정 잡기", orderIndex: 0 }),
  ] },
  { id: 73, track: "merged", title: "가격 표기 문구 처리 방향", orderIndex: 2, state: "next", sourceAgendaId: 303, lines: [] },
  { id: 74, track: "merged", title: "경쟁사 요금제 비교", orderIndex: 3, state: null, sourceAgendaId: 41, lines: [
    line({ id: 320, agendaId: 74, track: "merged", kind: "discussion", content: "AI: 경쟁사 요금제를 비교했다", orderIndex: 0, evidence: [{ fromMs: 900_000, toMs: 905_000 }], createdAt: "2026-08-27T00:50:00Z" }),
  ] },
];

export const TRANSCRIPT: TranscriptResponse = {
  recordingStartedAt: STARTED,
  speakerCount: 2,
  items: [
    { id: 298, speakerLabel: "1", atMs: 181_200, endMs: 187_900, content: "개정 대상 섹션부터 정리하고 가죠." },
    { id: 299, speakerLabel: "2", atMs: 574_000, endMs: 576_300, content: "도입 사례가 너무 길어요." },
    { id: 300, speakerLabel: "1", atMs: 3_500_000, endMs: 3_540_000, content: "그럼 여기까지 하죠." },
  ],
};

export const HEADLINE = "개정 범위를 4개 섹션으로 확정하고, 디자인 반영본은 8/29 오전 수령 후 같은 날 검수하기로 했습니다.";

export function generatingMeeting(overrides: Partial<MeetingDetail> = {}): MeetingDetail {
  return meetingDetail({
    status: "generating", integrationState: "running", recordingStartedAt: STARTED, latestBatchSeq: 2, activeJobId: 123,
    agendas: { human: HUMAN, ai: AI, merged: [] }, ...overrides,
  });
}

export function endedSucceeded(overrides: Partial<MeetingDetail> = {}): MeetingDetail {
  return meetingDetail({
    status: "ended", integrationState: "succeeded", recordingStartedAt: STARTED, latestBatchSeq: 3, activeJobId: null,
    headline: HEADLINE,
    // 다섯은 `MERGED` 트리를 그대로 센 값이다 — 화면에 그리는 그것과 어긋나면 안 된다(MF-25 · F-11)
    mergedSummary: { agendaCount: 4, discussionCount: 2, decisionCount: 1, actionCount: 1, taskCount: 1 },
    agendas: { human: HUMAN, ai: AI, merged: MERGED }, ...overrides,
  });
}

export function endedFailed(overrides: Partial<MeetingDetail> = {}): MeetingDetail {
  return meetingDetail({
    status: "ended", integrationState: "failed", recordingStartedAt: STARTED, latestBatchSeq: 2, activeJobId: null,
    headline: null, mergedSummary: null, agendas: { human: HUMAN, ai: AI, merged: [] }, ...overrides,
  });
}
