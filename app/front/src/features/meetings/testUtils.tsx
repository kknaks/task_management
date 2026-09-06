/**
 * 회의록 테스트 공용 — 시드 픽스처와 Provider 래퍼. **테스트 파일이 아니다**(`*.test.tsx` 만 돈다).
 *
 * WP 의 「앱 창 확인」 항목을 테스트 코드로 옮기는 데 쓰는 시드다 — `recording` · `generating` ·
 * `ended + failed` · `ended + headline` 행이 여기 있다(Phase 4 검증 「시드로 … 행을 두면」).
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactNode } from "react";

import { OverlayHost } from "@/components/shared/OverlayHost";
import { Toaster } from "@/components/ui/sonner";
import type {
  MeetingDetail,
  MeetingListItem,
  MeetingListResponse,
} from "@/features/meetings/types";
import { OverlayProvider } from "@/lib/overlay/OverlayProvider";

export const WORK_TYPE = {
  id: 1,
  name: "미팅·회의",
  kind: "meeting" as const,
  colorToken: "indigo",
  isDeleted: false,
};

export const PROJECT = { id: 5, name: "소개서 개정", colorToken: "violet", isDeleted: false };

export function meetingDetail(overrides: Partial<MeetingDetail> = {}): MeetingDetail {
  return {
    id: 21,
    title: "제품 소개서 리뷰",
    status: "scheduled",
    integrationState: "not_started",
    workType: WORK_TYPE,
    project: PROJECT,
    startAt: "2026-08-27T00:30:00Z",
    endAt: "2026-08-27T01:30:00Z",
    durationMinutes: 60,
    recordingStartedAt: null,
    headline: null,
    mergedSummary: null,
    agendas: {
      human: [
        { id: 301, track: "human", title: "개정 대상 섹션 확정", orderIndex: 0, state: null, sourceAgendaId: null, lines: [] },
        { id: 302, track: "human", title: "디자인 반영 일정과 검수 방식", orderIndex: 1, state: null, sourceAgendaId: null, lines: [] },
      ],
      ai: [],
      merged: [],
    },
    attachments: [
      {
        id: 42,
        kind: "link",
        name: "경쟁사 요금제 비교",
        documentId: null,
        folderPath: null,
        sizeBytes: null,
        updatedAt: "2026-08-20T01:00:00Z",
        url: "https://example.com/pricing",
        isDeleted: false,
      },
    ],
    latestBatchSeq: 0,
    finalBatchState: null,
    activeJobId: null,
    createdAt: "2026-08-20T01:00:00Z",
    updatedAt: "2026-08-20T01:00:00Z",
    ...overrides,
  };
}

export function listItem(overrides: Partial<MeetingListItem> = {}): MeetingListItem {
  return {
    id: 21,
    title: "제품 소개서 리뷰",
    status: "scheduled",
    integrationState: "not_started",
    startAt: "2026-08-27T00:30:00Z",
    endAt: "2026-08-27T01:30:00Z",
    workType: WORK_TYPE,
    project: PROJECT,
    headline: null,
    agendaTitles: ["개정 대상 섹션 확정", "디자인 반영 일정과 검수 방식"],
    attachmentCount: 1,
    updatedAt: "2026-08-20T01:00:00Z",
    ...overrides,
  };
}

/** 시드 — 상태 표기 4종 + 한 줄 요약이 있는 종료 회의 + 무소속 회의. */
export const SEED_ITEMS: MeetingListItem[] = [
  listItem({ id: 21, status: "scheduled" }),
  listItem({ id: 22, title: "고객 인터뷰 4차", status: "recording", startAt: "2026-08-28T05:00:00Z", endAt: "2026-08-28T06:00:00Z", project: null, agendaTitles: [], attachmentCount: 0 }),
  listItem({ id: 23, title: "디자인 싱크", status: "generating", startAt: "2026-08-26T07:00:00Z", endAt: "2026-08-26T08:00:00Z" }),
  listItem({ id: 24, title: "온보딩 킥오프", status: "ended", integrationState: "failed", startAt: "2026-08-20T01:00:00Z", endAt: "2026-08-20T02:00:00Z", project: null }),
  listItem({
    id: 25,
    title: "주간 제품 스크럼",
    status: "ended",
    integrationState: "succeeded",
    startAt: "2026-08-17T02:00:00Z",
    endAt: "2026-08-17T03:00:00Z",
    headline: "소개서 개정 범위를 4개 섹션으로 확정했고, 디자인 반영본은 8월 29일까지 받기로 했습니다.",
  }),
];

export const SEED_LIST: MeetingListResponse = {
  items: SEED_ITEMS,
  total: 5,
  projectCounts: [
    { projectId: null, name: null, colorToken: null, count: 2 },
    { projectId: 5, name: "소개서 개정", colorToken: "violet", count: 3 },
  ],
};

export function createTestClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/** Provider 한 벌 — 쿼리 · 오버레이(드로어·모달을 실제로 그린다) · 토스트. */
export function renderWithProviders(
  ui: ReactNode,
  client: QueryClient = createTestClient(),
): RenderResult & { client: QueryClient } {
  const result = render(
    <QueryClientProvider client={client}>
      <OverlayProvider>
        {ui}
        <OverlayHost />
      </OverlayProvider>
      <Toaster />
    </QueryClientProvider>,
  );
  return { ...result, client };
}
