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

/** `kind='task'` 줄의 업무 요약(SPEC-008). 이 work 는 읽기만 한다. */
export interface LineTaskSummary {
  id: number;
  title: string;
  status: string;
  dueDate: string | null;
  isDeleted: boolean;
}

/** 줄 — 형태만 고정한다. **의미·표시·쓰기 표면은 SPEC-007·008**(§4). */
export interface MeetingLine {
  id: number;
  track: MeetingTrack;
  agendaId: number;
  kind: string;
  content: string;
  detail: string | null;
  evidence: unknown[];
  orderIndex: number;
  taskId: number | null;
  pendingChange: Record<string, unknown> | null;
  sourceHumanLineId: number | null;
  sourceAiLineId: number | null;
  task: LineTaskSummary | null;
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
