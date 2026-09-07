/**
 * 회의록 영역의 **엔드포인트 호출 함수만** 둔다(frontend/README.md §2).
 * 모든 호출은 `lib/api/client.ts` 를 지난다(§2 규칙 5).
 *
 * SPEC-006 §4 API Contract 의 11 표면. **쓰기 응답은 전부 `MeetingDetail`** · 삭제만 `204`.
 * `/end`·줄·`/stream`·트랜스크립트는 SPEC-007·008 이 **이 파일에 더한다**.
 */

import { apiFetch } from "@/lib/api/client";
import type {
  AddLineInput,
  AddMeetingAttachmentInput,
  CreateMeetingInput,
  JobAccepted,
  JobItem,
  MeetingDetail,
  MeetingLine,
  MeetingListResponse,
  MeetingsListQuery,
  NewTaskInput,
  TaskUpdateInput,
  TranscriptResponse,
  UpdateAgendaInput,
  UpdateLineInput,
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

// --- 종료 파이프라인(SPEC-008 §4) ------------------------------------------------

/**
 * **회의 종료** — `recording → generating` + job. `202 { jobId }` 가 오면 화면은 그 자리에서 「생성중」이 된다(U-1).
 * 사전 조건은 `recording` 하나 — 스트림이 끊겨 있어도 받는다. 응답에 결과가 없다(BE §6).
 */
export function endMeeting(id: number): Promise<JobAccepted> {
  return apiFetch<JobAccepted>(`/api/meetings/${id}/end`, { method: "POST" });
}

/**
 * **「다시 시도」** — `ended`+`failed` 에서만(그 밖은 409). **①(재전사)부터 다시 돈다**(MF-58 — 부분 재시도 갈래가 없다).
 * 옛 `POST …/integrate` 를 대체한다 — 통합 단계가 사라졌다(MF-56).
 */
export function finalizeMeeting(id: number): Promise<JobAccepted> {
  return apiFetch<JobAccepted>(`/api/meetings/${id}/finalize`, { method: "POST" });
}

/** 종료 job 폴링 — 2초 간격 · 종결에서 멈춘다(`useMeetingFinalizeJob`). 남의 job 은 404. */
export function fetchJob(jobId: number): Promise<JobItem> {
  return apiFetch<JobItem>(`/api/jobs/${jobId}`, { cache: "no-store" });
}

// --- 안건(사람 트랙) — 세 SPEC 이 공유하는 표면 ----------------------------

export function addAgenda(meetingId: number, title: string): Promise<MeetingDetail> {
  return apiFetch<MeetingDetail>(`/api/meetings/${meetingId}/agendas`, {
    method: "POST",
    body: { title },
  });
}

/**
 * **보낸 필드만** — 시작 전 `title`(SPEC-006) · 회의 중 `state`(SPEC-007). 표면·응답은 하나다(SPEC-007 §7-A).
 * `state:"active"` 가 성공하면 서버가 안건 전환 배치 트리거를 평가한다 — 화면은 모른다.
 */
export function updateAgenda(
  meetingId: number,
  agendaId: number,
  input: UpdateAgendaInput,
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

// --- 회의 중(SPEC-007) — 줄 · 트랜스크립트 ------------------------------------

/**
 * 사람 줄 하나 — 회의 중(SPEC-007)과 종료 후 편집(SPEC-008 확장 갈래 — `detail` · 액션·업무 줄의 `payload` · 업무 줄의 `taskId`)이 한 표면.
 * 응답은 **`LineItem`(201)** 이지 상세 전체가 아니다(SPEC-007 §4). 회의 중 사람 줄은 항상 `detail:null · evidence:[] · taskId:null` 이다(M-14).
 */
export function addLine(meetingId: number, input: AddLineInput): Promise<MeetingLine> {
  return apiFetch<MeetingLine>(`/api/meetings/${meetingId}/lines`, { method: "POST", body: input });
}

/**
 * **인라인 수정 · `payload` 저장**(SPEC-008 U-7 · U-9 · U-10) — `ended` 에서 편집 대상 트랙의 줄만.
 * 응답은 **`MeetingDetail` 전체**(`mergedSummary` 가 함께 갱신돼 온다 — 화면이 세지 않는다).
 * **`kind` 를 보내지 않는다**(MF-60 — 줄 종류를 바꾸는 표면이 없다).
 */
export function updateLine(
  meetingId: number,
  lineId: number,
  input: UpdateLineInput,
): Promise<MeetingDetail> {
  return apiFetch<MeetingDetail>(`/api/meetings/${meetingId}/lines/${lineId}`, {
    method: "PATCH",
    body: input,
  });
}

/**
 * **「제거」**(SPEC-008 U-7 · M-20) — 회의록 탭이 그리는 트랙의 행 하나만 **하드 삭제**. `204`.
 * 원본 줄 · AI 트랙 · 트랜스크립트 · 녹음 · 업무는 그대로다. 없는 줄은 404(멱등 삭제가 아니다).
 */
export function deleteLine(meetingId: number, lineId: number): Promise<void> {
  return apiFetch<void>(`/api/meetings/${meetingId}/lines/${lineId}`, { method: "DELETE" });
}

// --- 업무 연동(SPEC-008 §4 · U-6 · U-9 · U-10) — 완료 게이트의 네 번째 진입점 ---------------------
//
// **업무 API 를 직접 부르지 않는다.** 줄과 업무를 한 트랜잭션으로 묶는 입구가 아래 둘이고, 판정(그래프 · 게이트 · 로그)은
// 서버의 `task_service` 하나가 한다. 기한 · 상태 · 메모를 따로 보내면 둘째에서 거부됐을 때 첫째만 남는다(§7 정합 표 #1).

/**
 * **액션 줄 「넣기」 — 업무 생성**(U-10 보기 모드) — `201 MeetingDetail`. 업무는 `POST /api/tasks` 규칙 그대로 만들어지고
 * 같은 트랜잭션에서 그 줄이 업무 줄(`kind='task'` · `taskId`)이 된다. 업무만 생기고 줄이 안 바뀌는 상태가 없다.
 */
export function createTaskFromLine(meetingId: number, lineId: number, input: NewTaskInput): Promise<MeetingDetail> {
  return apiFetch<MeetingDetail>(`/api/meetings/${meetingId}/lines/${lineId}/task`, { method: "POST", body: input });
}

/**
 * **업무 줄 「넣기」 — 업무 갱신**(U-6 · U-9 보기 모드) — `PATCH …/lines/{id}/task`.
 * 본문은 **드로어가 만든다**(`taskId` + 채워진 변경분만) — 줄에 저장된 `payload` 를 서버가 다시 읽지 않는다.
 * 서버가 ①~⑧ 을 한 트랜잭션으로 돌리고 거부되면 전부 롤백이다. **한 번에 요청은 이것 하나**다.
 */
export function applyLineTaskUpdate(meetingId: number, lineId: number, input: TaskUpdateInput): Promise<MeetingDetail> {
  return apiFetch<MeetingDetail>(`/api/meetings/${meetingId}/lines/${lineId}/task`, { method: "PATCH", body: input });
}

/** 확정 발화 블록 전량 — 진입 시 1회. 이후는 WS `transcript.final` 로 append 한다(WP 캐시 키 행). */
export function fetchTranscript(meetingId: number): Promise<TranscriptResponse> {
  return apiFetch<TranscriptResponse>(`/api/meetings/${meetingId}/transcript`, { cache: "no-store" });
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
