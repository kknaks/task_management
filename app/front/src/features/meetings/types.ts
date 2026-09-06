/**
 * 회의록 영역의 응답·요청 타입 — **백엔드 `schemas/meeting.py` 의 미러**(SPEC-006 §4 · FE §3-6).
 * **여기 없는 필드를 컴포넌트가 지어내지 않는다.** `any` 를 쓰지 않는다(§11).
 *
 * 필드 이름의 정본은 **SPEC-006 §4 필드 소유 표**다 — `agendas.{human, ai, merged}` ·
 * `latestBatchSeq`(코디 확정). SPEC-007·008 이 이 형태에 필드를 **더한다**.
 */

import type { ColorToken } from "@/lib/palette";

/** 상태 4종 — 한 방향(DEC-003 §4). 「예정」·「기록 중」·「생성중」은 표시 매핑이다(G-4). */
export type MeetingStatus = "scheduled" | "recording" | "generating" | "ended";

/** `status` 와 **다른 축**(M-4). `ended + failed` 만 「통합 실패」다. */
export type IntegrationState = "not_started" | "running" | "succeeded" | "failed";

export type MeetingTrack = "human" | "ai" | "merged";

/** 시작 전에는 `null`. 값은 회의 중·종료 후의 것이다(SPEC-007·008). */
export type AgendaState = "next" | "active" | "done";

export type MeetingAttachmentKind = "doc" | "link";

/** 회의가 참조하는 유형·프로젝트 요약 — 업무와 같은 형태(삭제분은 `isDeleted: true`). */
export interface MeetingRefSummary {
  id: number;
  name: string;
  colorToken: ColorToken | string;
  isDeleted: boolean;
}

export interface MeetingWorkTypeSummary extends MeetingRefSummary {
  kind: "meeting" | "task";
}

/** `kind='task'` 줄의 업무 요약(SPEC-008). 이 work 는 읽기만 한다. `workType` 은 AI 업무 줄 유형 배지의 원천(SPEC-007 §4 · U-4). */
export interface LineTaskSummary {
  id: number;
  title: string;
  status: string;
  dueDate: string | null;
  isDeleted: boolean;
  workType: MeetingRefSummary;
}

/** 줄 종류 **4종**(DEC-003 §1 표 · SPEC-007 §4 Validation). 「논의」·「업무」는 표시 매핑이다(G-4). */
export type LineKind = "discussion" | "decision" | "task" | "action";

/** AI 줄의 근거 구간 — `recordingStartedAt` 기준 오프셋(ms). 사람 줄은 회의 중 항상 `[]`. */
export interface LineEvidence {
  fromMs: number;
  toMs: number;
}

/**
 * 업무 줄이 들고 있는 **반영 대기 변경** — 키는 `dueDate` · `status` · `note` **셋뿐**(DEC-003 §4 · M-14-a).
 * `cancelled` 는 담을 수 없다(사유 필수). 적용은 Phase 5 의 「업무 갱신」 버튼이 한다 — 이 work 는 읽기만.
 */
export interface PendingChange {
  dueDate?: string;
  status?: "todo" | "in_progress" | "done";
  note?: string;
}

/** 줄 — 형태만 고정한다. **의미·표시·쓰기 표면은 SPEC-007·008**(§4). */
export interface MeetingLine {
  id: number;
  track: MeetingTrack;
  agendaId: number;
  kind: LineKind | string;
  content: string;
  detail: string | null;
  evidence: LineEvidence[];
  orderIndex: number;
  taskId: number | null;
  pendingChange: PendingChange | null;
  sourceHumanLineId: number | null;
  sourceAiLineId: number | null;
  task: LineTaskSummary | null;
  /** 줄 우측 시각(SPEC-007 U-2). 안건 우측 시각은 화면이 `min(createdAt)` 으로 파생한다. */
  createdAt: string;
}

export interface MeetingAgenda {
  id: number;
  track: MeetingTrack;
  title: string;
  orderIndex: number;
  state: AgendaState | null;
  sourceAgendaId: number | null;
  /** **안건 안에 중첩**된다. 시작 전에는 비어 있다. */
  lines: MeetingLine[];
}

/** 세 키가 **항상 있고** 비어 있으면 `[]` — 화면이 키 유무로 분기하지 않는다(§4). */
export interface AgendaTracks {
  human: MeetingAgenda[];
  ai: MeetingAgenda[];
  merged: MeetingAgenda[];
}

export interface MeetingAttachment {
  id: number;
  kind: MeetingAttachmentKind;
  name: string;
  documentId: number | null;
  folderPath: string | null;
  sizeBytes: number | null;
  /** 문서면 문서 수정 시각, 링크면 첨부 시각(§4 필드 소유 표). */
  updatedAt: string;
  url: string | null;
  /** 문서가 소프트 딜리트됐다(U-7 흐림 표시). 링크는 항상 `false`. */
  isDeleted: boolean;
}

/** 요약 바 우측 「안건 n · 결정 n · 액션 n」 — **파생**, 통합 전 `null`(SPEC-008 이 채운다). */
export interface MergedSummary {
  agendaCount: number;
  decisionCount: number;
  actionCount: number;
  integratedAt: string;
}

/** `GET /api/meetings/{id}` — SPEC-006 §4 `MeetingDetail`. 상세·생성·PATCH·`/start`·안건·첨부가 전부 이 형태다. */
export interface MeetingDetail {
  id: number;
  title: string;
  status: MeetingStatus;
  integrationState: IntegrationState;
  workType: MeetingWorkTypeSummary;
  project: MeetingRefSummary | null;
  startAt: string;
  endAt: string;
  /** 파생 — 화면이 다시 계산하지 않는다(G-7). */
  durationMinutes: number;
  /** `/start` 가 성공한 실제 시각. 시작 전 `null`. */
  recordingStartedAt: string | null;
  /** AI 한 줄 요약(`ai_headline`). 통합 전·실패 시 `null` — **바를 그리지 않는다**. */
  headline: string | null;
  mergedSummary: MergedSummary | null;
  agendas: AgendaTracks;
  attachments: MeetingAttachment[];
  /** 성공한 배치의 최대 `seq`(파생). 시작 전 `0`. */
  latestBatchSeq: number;
  finalBatchState: "succeeded" | "failed" | null;
  activeJobId: number | null;
  createdAt: string;
  updatedAt: string;
}

/** `GET /api/meetings` 의 목록 항목. 상세와 **다른 형태** — 파생 표시값만 든다. */
export interface MeetingListItem {
  id: number;
  title: string;
  status: MeetingStatus;
  integrationState: IntegrationState;
  startAt: string;
  endAt: string;
  workType: MeetingWorkTypeSummary;
  project: MeetingRefSummary | null;
  headline: string | null;
  /** 사람 트랙 안건 제목 — 셋째 줄 대체 문구 재료. **화면이 트리를 다시 조립하지 않는다.** */
  agendaTitles: string[];
  attachmentCount: number;
  updatedAt: string;
}

/** `projectId: null` 이 「미정」. 삭제된 프로젝트도 이름·색 그대로 남는다(DEC-001 §4). */
export interface MeetingProjectCount {
  projectId: number | null;
  name: string | null;
  colorToken: string | null;
  count: number;
}

export interface MeetingListResponse {
  items: MeetingListItem[];
  /** **`projectId` 필터 적용 후** 건수 — 헤더 「n건」. */
  total: number;
  /** **필터 적용 전** 그 달 전체 — 칩 숫자(필터 자신을 반영하지 않는다). */
  projectCounts: MeetingProjectCount[];
}

/** 정렬 2종(§4). 기본 `latest`(`startAt` 내림차순). */
export type MeetingSort = "latest" | "oldest";

/** `?projectId=` — 숫자면 그 프로젝트, `"none"` 이면 무소속(「미정」 칩), `null` 이면 전체. */
export type MeetingProjectFilter = number | "none" | null;

/** `GET /api/meetings` 쿼리. **전부 `?` 에 남는다.** */
export interface MeetingsListQuery {
  from: string;
  to: string;
  projectId: MeetingProjectFilter;
  sort: MeetingSort;
}

/** `POST /api/meetings` — 드로어에 넣은 것이 **한 번에** 간다(§5). **`status` 가 없다.** */
export interface CreateMeetingInput {
  title: string;
  workTypeId: number;
  projectId?: number | null;
  startAt: string;
  endAt: string;
  agendas?: { title: string }[];
  /** 이 work 는 `kind='link'` 만 보낸다 — `doc` 은 문서함 전까지 서버가 거부한다(§Open Issues). */
  attachments?: { kind: "link"; url: string; label: string | null }[];
}

/** `PATCH /api/meetings/{id}` — 보낸 필드만. 일시는 **항상 둘을 함께**. `status` 없음. */
export type UpdateMeetingInput =
  | { title: string }
  | { workTypeId: number }
  | { projectId: number | null }
  | { startAt: string; endAt: string };

export interface AddMeetingAttachmentInput {
  kind: "link";
  url: string;
  label: string | null;
}

// --- 회의 중(SPEC-007 §4) ----------------------------------------------------

/**
 * `POST /api/meetings/{id}/lines` — 사람 줄 하나. 응답은 `MeetingLine`(201 — 코디 판정, 상세 전체가 아니다).
 * `detail` 은 **종료 후 편집(SPEC-008 U-8)만** 보낸다 — 회의 중에 실으면 서버가 `validation_error` 다.
 * `taskId` · `pendingChange` · `newTask` 갈래(U-9 · U-10)는 Phase 5 가 더한다.
 */
export interface AddLineInput {
  agendaId: number;
  kind: LineKind;
  content: string;
  detail?: string | null;
}

/** `PATCH /api/meetings/{id}/lines/{lineId}` — 보낸 필드만(SPEC-008 §4). 응답은 `MeetingDetail` 전체. */
export type UpdateLineInput = { content: string } | { kind: LineKind };

/**
 * `PATCH …/agendas/{agendaId}` 는 **한 표면**이다 — 시작 전 `title`(SPEC-006) · 회의 중 `state`(SPEC-007).
 * 보낸 필드만 바뀌고 응답은 `MeetingDetail` 전체다.
 */
export type UpdateAgendaInput = { title: string } | { state: AgendaState };

/** 확정 발화 블록 — `speakerLabel` 은 `"1"`·`"2"` 번호 문자열(익명 — M-10). 「화자 1」 접두는 화면 매핑이다. */
export interface TranscriptItem {
  id: number;
  speakerLabel: string;
  atMs: number;
  endMs: number;
  content: string;
}

/** `GET /api/meetings/{id}/transcript` — `atMs` 순 전량. 페이지 없음(v1 규모). */
export interface TranscriptResponse {
  recordingStartedAt: string | null;
  speakerCount: number;
  items: TranscriptItem[];
}

/** WS `transcript.partial` 의 조각 — **교체 렌더**용. 저장·복원되지 않는다(M-9). */
export interface PartialSegment {
  speakerLabel: string;
  atMs: number;
  text: string;
}

/** 서버 → 클라이언트 프레임 5종(SPEC-007 §4 WS 계약). 백엔드 `schemas/meeting_stream.py` 의 미러. */
export type StreamServerFrame =
  | { type: "ready"; recordingStartedAt: string; latestBatchSeq: number; speakerCount: number }
  | { type: "transcript.partial"; segments: PartialSegment[] }
  | { type: "transcript.final"; item: TranscriptItem }
  | { type: "ai.batch"; seq: number; agendas: MeetingAgenda[]; lines: MeetingLine[] }
  | { type: "error"; code: "meeting_stream_disconnected"; reason: "upstream" | "write_failed" };

/** 클라이언트 → 서버 텍스트 프레임 3종. 오디오는 바이너리다. */
export type StreamClientFrame =
  | {
      type: "auth";
      accessToken: string;
      audio: { format: string; sampleRate: number; channels: number };
    }
  | { type: "pause"; reason: "user" | "mic" }
  | { type: "resume" };

// --- 종료 파이프라인(SPEC-008 §4 · BE §6) — 백엔드 `schemas/job.py` 의 미러 --------------------

export type JobStatus = "queued" | "running" | "succeeded" | "failed";
export type JobPhase = "final_batch" | "integration";
export type JobErrorCode = "integration_failed" | "integration_timeout" | "job_timeout";

/** `POST …/end` · `POST …/integrate` → `202 { jobId }`. 결과를 담지 않는다 — 종결 뒤 상세를 다시 읽는다. */
export interface JobAccepted {
  jobId: number;
}

/** `GET /api/jobs/{jobId}` — `progress` 는 **파생**(`kind≠meeting_finalize` 면 `null`). */
export interface JobItem {
  id: number;
  kind: string;
  status: JobStatus;
  progress: { phase: JobPhase; attempt: number } | null;
  errorCode: JobErrorCode | null;
  errorMessage: string | null;
  finishedAt: string | null;
}

// --- 클라이언트 세션 상태(SPEC-007 §4 stateDiagram) — DB 상태가 아니다 ---------------

/**
 * 일시정지 사유. 상태 바 문구가 여기서 갈린다(U-1).
 * `stream:elsewhere` 는 WS `4409 meeting_stream_active` — 「다른 창에서 기록 중입니다」 + 재개 비활성(Case Matrix).
 */
export type PauseReason = "user" | "mic" | "stream:upstream" | "stream:write_failed" | "stream:elsewhere";

/** `connecting`(ready 전) · `live` · `paused`(사유 5종). 새로고침·재실행은 **`paused/stream`** 으로 시작한다. */
export type StreamStatus =
  | { kind: "connecting" }
  | { kind: "live" }
  | { kind: "paused"; reason: PauseReason };
