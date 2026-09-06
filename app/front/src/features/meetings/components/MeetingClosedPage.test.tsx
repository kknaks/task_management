/**
 * **생성중 · 실패 배너 · 상세 페이지 · 한 줄 요약 바 · 폴링 — 앱 창 확인 항목의 테스트 판**(WP Phase 3 검증 · SPEC-008 U-1 ~ U-3 · U-5).
 *
 * - 「회의 종료」 → `POST /end` 202 → **그 자리에서** 상태 칩 「회의록 생성중」(페이지 이동 없음)
 * - 생성중: 스피너 + 「AI 요약을 정리하고 있습니다」 → (`integration`) 「회의록을 통합하고 있습니다 · 다시 시도 중 (1/2)」 · 사람 원본 노출 · 「편집」 없음 · 「삭제」 비활성 · 캡션
 * - 폴링: **2초 간격** · 종결에서 멈춤 · 종결 뒤 상세 GET **한 번** · 실패 시 재요청 0 + 「상태를 확인하지 못했습니다 · 다시 확인」
 * - `ended`+`failed`: 배너 + 「다시 생성」 · 한 줄 요약 없음 · 사람 원본 + 「편집」 활성 · 「다시 생성」 → `POST /integrate` → 생성중
 * - `ended`+`succeeded`: 한 줄 요약 바(배지 + 문장 + 「안건 n · 결정 n · 액션 n」) · 「다시 생성」 없음 · `headline` null 이면 바 없음 · 문단 요약 0
 * - 배지 「다음 논의로」(「대기」·「다음으로」 0) · AI 탭 「종결 · HH:MM」 · 회의록 탭 화살표는 `detail`/`evidence` 있는 줄만 · 하단 프롬프트 바 없음
 */

import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MeetingDetailPage } from "@/features/meetings/components/MeetingDetailPage";
import { endedFailed, endedSucceeded, generatingMeeting, HEADLINE, HUMAN, AI, STARTED, TRANSCRIPT } from "@/features/meetings/closeFixtures";
import { createTestClient, meetingDetail, renderWithProviders } from "@/features/meetings/testUtils";
import type { JobItem, MeetingDetail } from "@/features/meetings/types";
import { queryKeys } from "@/lib/api/queryKeys";
import { tokenStore } from "@/lib/auth/tokenStore";
import { FakeWebSocket } from "@/test/fakeWebSocket";
import { installMedia } from "@/test/mediaMock";
import { API_BASE, server } from "@/test/server";

const push = vi.fn();
vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    ...actual,
    useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
    usePathname: () => "/meetings/detail/",
    useSearchParams: () => new URLSearchParams("id=21"),
  };
});

function job(partial: Partial<JobItem> = {}): JobItem {
  return { id: 123, kind: "meeting_finalize", status: "running", progress: { phase: "final_batch", attempt: 0 }, errorCode: null, errorMessage: null, finishedAt: null, ...partial };
}

interface Harness {
  detail: MeetingDetail;
  job: JobItem;
  detailReads: number;
  jobReads: number[];
}

function renderClosed(detail: MeetingDetail, current: JobItem = job()) {
  const state: Harness = { detail, job: current, detailReads: 0, jobReads: [] };
  server.use(
    http.get(`${API_BASE}/api/meetings/21`, () => {
      state.detailReads += 1;
      return HttpResponse.json(state.detail);
    }),
    http.get(`${API_BASE}/api/meetings/21/transcript`, () => HttpResponse.json(TRANSCRIPT)),
    http.get(`${API_BASE}/api/jobs/123`, () => {
      state.jobReads.push(Date.now());
      return HttpResponse.json(state.job);
    }),
    http.get(`${API_BASE}/api/work-types`, () => HttpResponse.json({ items: [] })),
    http.get(`${API_BASE}/api/projects`, () => HttpResponse.json({ items: [] })),
  );
  const result = renderWithProviders(<MeetingDetailPage />, createTestClient());
  return { ...result, state };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  tokenStore.setAccess("A1");
  push.mockReset();
});

afterEach(async () => {
  await tokenStore.clear();
});

describe("U-1 생성중 · 폴링", () => {
  it("스피너 칩 「회의록 생성중」 · 단계 문구 ① → ② · 사람 원본 노출 · 편집 잠금 · 2초 폴링 · 종결 뒤 상세 GET 한 번 · 이후 폴링 0", async () => {
    const { state } = renderClosed(generatingMeeting());
    expect(await screen.findByText("회의록 생성중")).toBeInTheDocument();
    expect(await screen.findByRole("status", { name: "회의록 생성중" })).toHaveTextContent("AI 요약을 정리하고 있습니다");
    // 사람 원본 그대로 + 캡션 · 「편집」 없음 · 「삭제」 비활성 · 하단 프롬프트 바 없음
    expect(screen.getByText("제품 개요 · 기능은 유지, 도입 사례 분량이 과다")).toBeInTheDocument();
    expect(screen.getByText("통합이 끝나면 이 탭이 통합본으로 바뀝니다")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "편집" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "삭제" })).toBeDisabled();
    expect(screen.queryByRole("combobox", { name: "줄 입력" })).not.toBeInTheDocument();
    // 제목 · 메타가 잠겨 있다 — 입력이 없다
    expect(screen.queryByRole("textbox", { name: "제목" })).not.toBeInTheDocument();
    // 안건 배지는 종료 후 어휘
    expect(screen.getByText("다음 논의로")).toBeInTheDocument();
    expect(screen.queryByText("대기")).not.toBeInTheDocument();

    // ② 통합 단계 · 재시도 표기 — 다음 폴링(2초)에 반영된다
    state.job = job({ progress: { phase: "integration", attempt: 2 } });
    await waitFor(() => expect(screen.getByRole("status", { name: "회의록 생성중" })).toHaveTextContent("회의록을 통합하고 있습니다 · 다시 시도 중 (1/2)"), { timeout: 4000 });
    expect(state.jobReads.length).toBeGreaterThanOrEqual(2);
    expect(state.jobReads[1] - state.jobReads[0]).toBeGreaterThanOrEqual(1900);
    // AI 탭 안내 바 「배치 2회 반영 · 종결 정리 중」
    await userEvent.click(screen.getByRole("tab", { name: "AI 요약" }));
    expect(screen.getByTestId("batch-caption")).toHaveTextContent("배치 2회 반영 · 종결 정리 중");
    await userEvent.click(screen.getByRole("tab", { name: "회의록" }));

    // 종결 → 상세 GET 한 번 → 통합본 · 한 줄 요약 · 「종료된 회의」
    state.job = job({ status: "succeeded", progress: { phase: "integration", attempt: 2 }, finishedAt: "2026-08-27T01:31:00Z" });
    state.detail = endedSucceeded();
    expect(await screen.findByText("종료된 회의", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole("note", { name: "AI 한 줄 요약" })).toHaveTextContent(HEADLINE);
    expect(screen.getByRole("note", { name: "AI 한 줄 요약" })).toHaveTextContent("안건 4 · 결정 1 · 액션 2");
    expect(state.detailReads).toBe(2);
    const settledReads = state.jobReads.length;
    await sleep(2600);
    expect(state.jobReads.length).toBe(settledReads);
    expect(state.detailReads).toBe(2);
    expect(push).not.toHaveBeenCalled();
  }, 15_000);

  it("폴링 실패(5xx) → 스피너 유지 + 「상태를 확인하지 못했습니다 · 다시 확인」 · 재요청 0 · 「다시 확인」이 한 번만 더 읽는다", async () => {
    let reads = 0;
    server.use(
      http.get(`${API_BASE}/api/meetings/21`, () => HttpResponse.json(generatingMeeting())),
      http.get(`${API_BASE}/api/meetings/21/transcript`, () => HttpResponse.json(TRANSCRIPT)),
      http.get(`${API_BASE}/api/jobs/123`, () => {
        reads += 1;
        return HttpResponse.json({ detail: "서버 오류", code: "internal_error" }, { status: 500 });
      }),
      http.get(`${API_BASE}/api/work-types`, () => HttpResponse.json({ items: [] })),
      http.get(`${API_BASE}/api/projects`, () => HttpResponse.json({ items: [] })),
    );
    renderWithProviders(<MeetingDetailPage />);
    expect(await screen.findByText("상태를 확인하지 못했습니다")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "회의록 생성중" })).toHaveTextContent("AI 요약을 정리하고 있습니다");
    expect(screen.getByText("회의록 생성중")).toBeInTheDocument();
    await sleep(2600);
    expect(reads).toBe(1);
    await userEvent.click(screen.getByRole("button", { name: "다시 확인" }));
    await waitFor(() => expect(reads).toBe(2));
    await sleep(300);
    expect(reads).toBe(2);
  }, 10_000);

  it("회의 중 「회의 종료」 → `POST /end` 202 → 그 자리에서 「회의록 생성중」 · 페이지 이동 없음 · job 폴링 시작", async () => {
    const media = installMedia();
    FakeWebSocket.reset();
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const calls: string[] = [];
    const state = { detail: meetingDetail({ status: "recording", recordingStartedAt: STARTED, latestBatchSeq: 2, agendas: { human: HUMAN, ai: AI, merged: [] } }) };
    server.use(
      http.get(`${API_BASE}/api/meetings/21`, () => HttpResponse.json(state.detail)),
      http.get(`${API_BASE}/api/meetings/21/transcript`, () => HttpResponse.json(TRANSCRIPT)),
      http.post(`${API_BASE}/api/meetings/21/end`, () => {
        calls.push("end");
        state.detail = generatingMeeting();
        return HttpResponse.json({ jobId: 123 }, { status: 202 });
      }),
      http.get(`${API_BASE}/api/jobs/123`, () => {
        calls.push("job");
        return HttpResponse.json(job());
      }),
      http.get(`${API_BASE}/api/work-types`, () => HttpResponse.json({ items: [] })),
      http.get(`${API_BASE}/api/projects`, () => HttpResponse.json({ items: [] })),
    );
    try {
      renderWithProviders(<MeetingDetailPage />);
      await userEvent.click(await screen.findByRole("button", { name: "회의 종료" }));
      expect(await screen.findByText("회의록 생성중")).toBeInTheDocument();
      expect(screen.getByRole("status", { name: "회의록 생성중" })).toHaveTextContent("AI 요약을 정리하고 있습니다");
      await waitFor(() => expect(calls).toEqual(["end", "job"]));
      expect(push).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "회의 종료" })).not.toBeInTheDocument();
    } finally {
      media.restore();
      vi.unstubAllGlobals();
    }
  });
});

describe("U-2 실패 배너 · 「다시 생성」", () => {
  it("`ended`+`failed` → 배너 + 「다시 생성」 · 한 줄 요약 없음 · 사람 원본 + 「편집」 활성 · AI 탭 「배치 2회 반영 · 종결 정리 실패」 · 「다시 생성」 → `POST /integrate` → 생성중", async () => {
    const calls: string[] = [];
    const { state } = renderClosed(endedFailed());
    server.use(
      http.post(`${API_BASE}/api/meetings/21/integrate`, () => {
        calls.push("integrate");
        state.detail = generatingMeeting({ latestBatchSeq: 2 });
        return HttpResponse.json({ jobId: 123 }, { status: 202 });
      }),
    );
    expect(await screen.findByRole("alert", { name: "통합 정리 실패" })).toHaveTextContent("통합 정리 실패 · 회의록 탭에 회의 중 작성한 원본을 보여 드립니다");
    expect(screen.queryByRole("note", { name: "AI 한 줄 요약" })).not.toBeInTheDocument();
    expect(screen.getByText("종료된 회의")).toBeInTheDocument();
    expect(screen.getByText("제품 개요 · 기능은 유지, 도입 사례 분량이 과다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "편집" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "삭제" })).toBeEnabled();
    await userEvent.click(screen.getByRole("tab", { name: "AI 요약" }));
    expect(screen.getByTestId("batch-caption")).toHaveTextContent("배치 2회 반영 · 종결 정리 실패");
    // AI 탭 내용은 남아 있다
    expect(screen.getByText("AI: 도입 사례는 3건만")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "다시 생성" }));
    await waitFor(() => expect(calls).toEqual(["integrate"]));
    expect(await screen.findByText("회의록 생성중")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다시 생성" })).not.toBeInTheDocument();
  });

  it("「다시 생성」 409 → 토스트 「지금 상태에서는 할 수 없습니다」 + 상세 재조회", async () => {
    const { state } = renderClosed(endedFailed());
    server.use(
      http.post(`${API_BASE}/api/meetings/21/integrate`, () =>
        HttpResponse.json({ detail: "지금 상태에서는 할 수 없는 요청입니다", code: "invalid_meeting_status" }, { status: 409 }),
      ),
    );
    await userEvent.click(await screen.findByRole("button", { name: "다시 생성" }));
    expect(await screen.findByText("지금 상태에서는 할 수 없습니다")).toBeInTheDocument();
    await waitFor(() => expect(state.detailReads).toBeGreaterThanOrEqual(2));
  });
});

describe("U-3 상세 페이지 — 통합본 · 한 줄 요약 바 · 근거", () => {
  it("한 줄 요약 바 **한 개**(배지 + 문장 + 카운트 · 「생성」 시각 없음) · 「다시 생성」 없음 · 통합본 문장 그대로 · 「다음 논의로」 · 「AI 안건」 · AI 탭 「종결 · HH:MM」 · 스크립트 푸터", async () => {
    renderClosed(endedSucceeded());
    const bar = await screen.findByRole("note", { name: "AI 한 줄 요약" });
    expect(screen.getAllByRole("note", { name: "AI 한 줄 요약" })).toHaveLength(1);
    expect(bar).toHaveTextContent(HEADLINE);
    expect(bar).toHaveTextContent("안건 4 · 결정 1 · 액션 2");
    expect(bar.textContent).not.toMatch(/\d\d\.\d\d \d\d:\d\d 생성/);
    expect(screen.queryByRole("button", { name: "다시 생성" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // 문단 요약(「요약 · AI 생성」)은 없다 — 한 줄 요약과 다른 것이다(§7)
    expect(screen.queryByText(/요약 · AI 생성/)).not.toBeInTheDocument();

    // 통합본 = `agendas.merged` — 사람 문장 글자 그대로 + AI 에만 있던 줄 + AI 신설 안건
    expect(screen.getByText("도입 사례는 3건만 유지하고 나머지는 별도 페이지로 분리한다.")).toBeInTheDocument();
    expect(screen.getByText("AI: 경쟁사 요금제를 비교했다")).toBeInTheDocument();
    expect(screen.getByText("AI 안건")).toBeInTheDocument();
    expect(screen.getAllByText("완료")).toHaveLength(2);
    expect(screen.getByText("다음 논의로")).toBeInTheDocument();
    expect(screen.queryByText("대기")).not.toBeInTheDocument();
    expect(screen.queryByText("다음으로")).not.toBeInTheDocument();
    // 업무 줄 — 유형 배지가 붙는다(줄 버튼은 Phase 5)
    expect(screen.getByText("문서·보고")).toBeInTheDocument();
    // 하단 프롬프트 바 · 「편집」 은 보기 모드 헤더에
    expect(screen.queryByRole("combobox", { name: "줄 입력" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "편집" })).toBeInTheDocument();
    // 메타 한 줄 — 동적 유형명 · 60분 · 프로젝트
    expect(screen.getByText("60분")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "유형 바꾸기" })).toHaveTextContent("미팅·회의");
    expect(screen.getByRole("button", { name: "프로젝트 바꾸기" })).toHaveTextContent("소개서 개정");

    // 회의록 탭 화살표 — `detail`/`evidence` 있는 줄(301 · 320)에만
    const merged = screen.getByRole("region", { name: "회의록" });
    expect(within(merged).getAllByRole("button", { name: "펼치기" })).toHaveLength(2);
    expect(within(document.querySelector('[data-line-id="300"]') as HTMLElement).queryByRole("button", { name: "펼치기" })).toBeNull();
    // 펼침 → 상세 + 칩 「09:39 – 09:39」 → 클릭 → 스크립트 탭 강조 「근거 구간」
    await userEvent.click(within(document.querySelector('[data-line-id="301"]') as HTMLElement).getByRole("button", { name: "펼치기" }));
    expect(screen.getByText("도입 사례 6건 중 3건이 서로 유사해 …")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /근거 구간 09:39 – 09:39/ }));
    expect(await screen.findByText("근거 구간")).toBeInTheDocument();
    expect(document.querySelector('[data-transcript-id="299"]')).toHaveAttribute("data-highlighted", "true");
    // 스크립트 푸터 「전체 스크립트 59분 · 화자 2명」(마지막 endMs 3,540,000 → 올림 59)
    expect(screen.getByText("전체 스크립트 59분 · 화자 2명")).toBeInTheDocument();

    // AI 탭 — 「종결 · 10:31」(통합 시각) · 버튼 없음
    await userEvent.click(screen.getByRole("tab", { name: "AI 요약" }));
    expect(screen.getByTestId("batch-caption")).toHaveTextContent("종결 · 10:31");
    expect(screen.queryByText("회의 종료 시 안건별 요약이 회의록에 반영됩니다")).not.toBeInTheDocument();
  });

  it("`headline` 이 null 이면 바를 그리지 않는다(빈 바 없음) — 통합본은 그대로", async () => {
    renderClosed(endedSucceeded({ headline: null, mergedSummary: null }));
    expect(await screen.findByText("종료된 회의")).toBeInTheDocument();
    expect(screen.queryByRole("note", { name: "AI 한 줄 요약" })).not.toBeInTheDocument();
    expect(screen.getByText("AI: 경쟁사 요금제를 비교했다")).toBeInTheDocument();
  });

  it("제목 인라인 편집 → `PATCH {title}` · 일시 겹침 409 → 토스트 「그 시간에 다른 일정이 있습니다」 + 값 원복 + 재요청 0", async () => {
    const bodies: unknown[] = [];
    const { state } = renderClosed(endedSucceeded());
    server.use(
      http.patch(`${API_BASE}/api/meetings/21`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push(body);
        if ("startAt" in body) {
          return HttpResponse.json({ detail: "그 시간에 다른 일정이 있습니다", code: "schedule_overlap" }, { status: 409 });
        }
        state.detail = { ...state.detail, title: String(body.title) };
        return HttpResponse.json(state.detail);
      }),
    );
    const title = await screen.findByRole("textbox", { name: "제목" });
    await userEvent.clear(title);
    await userEvent.type(title, "제품 소개서 리뷰 v2");
    await userEvent.tab();
    await waitFor(() => expect(bodies).toEqual([{ title: "제품 소개서 리뷰 v2" }]));

    // 일시 — 팝오버에서 시작 시각을 바꾸고 닫으면 둘을 함께 보낸다 → 409 → 토스트 + 원복
    await userEvent.click(screen.getByRole("button", { name: "일시" }));
    await userEvent.click(screen.getByRole("button", { name: "시작 시각" }));
    await userEvent.click(screen.getByRole("option", { name: "10:00" }));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toEqual({ startAt: "2026-08-27T01:00:00.000Z", endAt: "2026-08-27T01:30:00.000Z" });
    expect(await screen.findByText("그 시간에 다른 일정이 있습니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "일시" })).toHaveTextContent("09:30 – 10:30");
    await sleep(100);
    expect(bodies).toHaveLength(2);
    // 「다시 저장」이 남는다 — 자동 재시도 없음
    expect(screen.getByRole("button", { name: "다시 저장" })).toBeInTheDocument();
  });

  it("없는 회의록이면 「없는 회의록입니다」 + 「목록으로」 · 상세 조회 실패면 「다시 시도」", async () => {
    server.use(http.get(`${API_BASE}/api/meetings/21`, () => HttpResponse.json({ detail: "없음", code: "not_found" }, { status: 404 })));
    const { unmount } = renderWithProviders(<MeetingDetailPage />);
    expect(await screen.findByText("없는 회의록입니다")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "목록으로" })).toBeInTheDocument();
    unmount();
    server.use(http.get(`${API_BASE}/api/meetings/21`, () => HttpResponse.json({ detail: "서버 오류", code: "internal_error" }, { status: 500 })));
    renderWithProviders(<MeetingDetailPage />);
    expect(await screen.findByText("회의록을 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });

  it("스켈레톤 — 빈 화면을 먼저 그리지 않는다", async () => {
    server.use(http.get(`${API_BASE}/api/meetings/21`, async () => {
      await sleep(80);
      return HttpResponse.json(endedSucceeded());
    }));
    const client = createTestClient();
    client.setQueryData(queryKeys.workTypes(), []);
    renderWithProviders(<MeetingDetailPage />, client);
    expect(screen.getByLabelText("불러오는 중")).toBeInTheDocument();
    expect(await screen.findByText("종료된 회의")).toBeInTheDocument();
  });
});
