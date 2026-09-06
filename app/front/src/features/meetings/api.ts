/**
 * 회의록 영역의 **엔드포인트 호출 함수만** 둔다(frontend/README.md §2).
 * 모든 호출은 `lib/api/client.ts` 를 지난다(§2 규칙 5).
 *
 * SPEC-006 §4 API Contract 의 11 표면. **쓰기 응답은 전부 `MeetingDetail`** · 삭제만 `204`.
 * `/end`·줄·`/stream`·트랜스크립트는 SPEC-007·008 이 **이 파일에 더한다**.
 */

import { apiFetch } from "@/lib/api/client";
import type {
  AddMeetingAttachmentInput,
  CreateMeetingInput,
  MeetingDetail,
  MeetingListResponse,
  MeetingsListQuery,
  UpdateMeetingInput,
} from "@/features/meetings/types";

/** `?` 에 실제로 값이 있는 것만 싣는다 — 서버가 「없음」과 「빈 값」을 구분한다. */
function toSearch(query: MeetingsListQuery): string {
  const search = new URLSearchParams({ from: query.from, to: query.to, sort: query.sort });
  if (query.projectId !== null) {
    search.set("projectId", String(query.projectId));
  }
  return search.toString();
}

export function fetchMeetings(query: MeetingsListQuery): Promise<MeetingListResponse> {
  return apiFetch<MeetingListResponse>(`/api/meetings?${toSearch(query)}`, { cache: "no-store" });
}

/** **한 요청**이다 — 안건·첨부·`schedule` 파생이 같은 트랜잭션(§5). */
export function createMeeting(input: CreateMeetingInput): Promise<MeetingDetail> {
  return apiFetch<MeetingDetail>("/api/meetings", { method: "POST", body: input });
}

export function fetchMeeting(id: number): Promise<MeetingDetail> {
  return apiFetch<MeetingDetail>(`/api/meetings/${id}`, { cache: "no-store" });
}

/** 캘린더 드래그·상세 드로어의 **유일한 쓰기 표면**. 이 work 의 화면은 아직 부르지 않는다. */
export function updateMeeting(id: number, input: UpdateMeetingInput): Promise<MeetingDetail> {
  return apiFetch<MeetingDetail>(`/api/meetings/${id}`, { method: "PATCH", body: input });
}

/** **소프트 딜리트** — 녹음 원본은 서버에 남는다(M-13). 복원 표면은 없다. */
export function deleteMeeting(id: number): Promise<void> {
  return apiFetch<void>(`/api/meetings/${id}`, { method: "DELETE" });
}

/** `scheduled → recording` — **상태 전이만.** 본문 없음. WS·마이크는 이 응답 뒤 SPEC-007 순서다. */
export function startMeeting(id: number): Promise<MeetingDetail> {
  return apiFetch<MeetingDetail>(`/api/meetings/${id}/start`, { method: "POST" });
}

// --- 안건(사람 트랙) — 세 SPEC 이 공유하는 표면 ----------------------------

export function addAgenda(meetingId: number, title: string): Promise<MeetingDetail> {
  return apiFetch<MeetingDetail>(`/api/meetings/${meetingId}/agendas`, {
    method: "POST",
    body: { title },
  });
}

/** **보낸 필드만** — 이 work 는 `title`. WORK-007 이 `state` 를 더한다. */
export function updateAgenda(
  meetingId: number,
  agendaId: number,
  input: { title: string },
): Promise<MeetingDetail> {
  return apiFetch<MeetingDetail>(`/api/meetings/${meetingId}/agendas/${agendaId}`, {
    method: "PATCH",
    body: input,
  });
}

/** 없는 안건은 **404** — 멱등 삭제가 아니다. */
export function deleteAgenda(meetingId: number, agendaId: number): Promise<void> {
  return apiFetch<void>(`/api/meetings/${meetingId}/agendas/${agendaId}`, { method: "DELETE" });
}

// --- 첨부 ------------------------------------------------------------------

export function addMeetingAttachment(
  meetingId: number,
  input: AddMeetingAttachmentInput,
): Promise<MeetingDetail> {
  return apiFetch<MeetingDetail>(`/api/meetings/${meetingId}/attachments`, {
    method: "POST",
    body: input,
  });
}

/** 첨부 행만 지운다 — 문서·링크 원본은 그대로. */
export function deleteMeetingAttachment(meetingId: number, attachmentId: number): Promise<void> {
  return apiFetch<void>(`/api/meetings/${meetingId}/attachments/${attachmentId}`, {
    method: "DELETE",
  });
}
