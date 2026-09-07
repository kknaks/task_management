/**
 * **회의 상세 드로어 — 앱 창 확인 항목의 테스트 판**(WP Phase 6 검증 · SPEC-008 U-4).
 *
 * - 드로어와 전체 페이지가 **같은 `MeetingDetailBody`** 를 쓴다(컴포넌트 동일성 — 같은 모듈 export 가 `mode` 만 다르게 불린다)
 * - `ended`+`succeeded`: 한 줄 요약 **두 줄 배치**(같은 값 다섯) · 최종 회의록 트리 · 첨부 n · 캡션 「편집과 업무 연동은 전체 페이지에서 합니다」 ·
 *   **줄 버튼 · 「편집」 · 「제거」 · 스크립트 패널 없음** · 칩은 표시만 + 캡션
 * - ⤢ → 전체 페이지 라우트 · `⋯` → 「삭제」 → 드로어가 닫힌 뒤 모달
 * - 헤더 제목 인라인 편집 → `PATCH {title}` · `generating` 은 메타 · 삭제 잠금
 * - `scheduled`: 안건 목록 + 캡션 · `recording`: 스냅숏 + 캡션 + **WS 연결 0** · `generating`: 스피너 + 폴링
 */

import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";

import * as BodyModule from "@/features/meetings/components/MeetingDetailBody";
import { MeetingDetailPage } from "@/features/meetings/components/MeetingDetailPage";
import { endedSucceeded, generatingMeeting, HEADLINE, HUMAN, STARTED, TRANSCRIPT } from "@/features/meetings/closeFixtures";
import { openMeetingDetailDrawer } from "@/features/meetings/openMeetingDrawers";
import { createTestClient, meetingDetail, renderWithProviders } from "@/features/meetings/testUtils";
import type { MeetingDetail } from "@/features/meetings/types";
import { useOverlay } from "@/lib/overlay/OverlayProvider";
import { tokenStore } from "@/lib/auth/tokenStore";
import { FakeWebSocket } from "@/test/fakeWebSocket";
import { API_BASE, server } from "@/test/server";

const push = vi.fn();
vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    ...actual,
    useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
    usePathname: () => "/meetings/",
    useSearchParams: () => new URLSearchParams("id=21"),
  };
});

/** `MeetingDetailBody` 를 **감시**한다 — 두 껍데기가 같은 함수를 부르는지 본다. */
const bodySpy = vi.fn();
vi.mock("@/features/meetings/components/MeetingDetailBody", async () => {
  const actual = await vi.importActual<typeof import("@/features/meetings/components/MeetingDetailBody")>("@/features/meetings/components/MeetingDetailBody");
  return {
    ...actual,
    MeetingDetailBody: (props: Parameters<typeof actual.MeetingDetailBody>[0]) => {
      bodySpy(props.mode, props.meeting.id);
      return actual.MeetingDetailBody(props);
    },
  };
});

/** 목록 · 캘린더가 하는 일을 흉내 낸다 — 마운트되면 `openDrawer` 한 번. */
function Opener({ meetingId }: { meetingId: number }) {
  const overlay = useOverlay();
  useEffect(() => {
    openMeetingDetailDrawer(overlay, meetingId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <p>뒤 화면</p>;
}

function mockMeeting(detail: MeetingDetail) {
  const state = { detail, reads: 0 };
  server.use(
    http.get(`${API_BASE}/api/meetings/21`, () => {
      state.reads += 1;
      return HttpResponse.json(state.detail);
    }),
    http.get(`${API_BASE}/api/meetings/21/transcript`, () => HttpResponse.json(TRANSCRIPT)),
    http.get(`${API_BASE}/api/work-types`, () => HttpResponse.json({ items: [] })),
    http.get(`${API_BASE}/api/projects`, () => HttpResponse.json({ items: [] })),
  );
  return state;
}

beforeEach(() => {
  tokenStore.setAccess("A1");
  push.mockReset();
  bodySpy.mockReset();
  FakeWebSocket.reset();
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await tokenStore.clear();
});

describe("같은 본문 · 드로어에서 빠진 넷", () => {
  it("페이지와 드로어가 **같은 `MeetingDetailBody`** 를 `mode` 만 다르게 부른다", async () => {
    mockMeeting(endedSucceeded());
    const page = renderWithProviders(<MeetingDetailPage />);
    await screen.findByText("종료된 회의");
    expect(bodySpy).toHaveBeenCalledWith("page", 21);
    page.unmount();
    bodySpy.mockReset();

    renderWithProviders(<Opener meetingId={21} />);
    await screen.findByRole("note", { name: "AI 한 줄 요약" });
    expect(bodySpy).toHaveBeenCalledWith("drawer", 21);
    expect(document.querySelector('[data-testid="meeting-detail-body"][data-mode="drawer"]')).not.toBeNull();
    // 같은 모듈의 같은 export 다
    expect(typeof BodyModule.MeetingDetailBody).toBe("function");
  });

  it("`ended`+`succeeded` 드로어 — 두 줄 요약(같은 값 다섯 · 툴팁) · 최종 회의록 · 첨부 n · 캡션 · 「편집」·「제거」·줄 버튼·스크립트 패널 없음 · 칩은 표시만", async () => {
    mockMeeting(endedSucceeded());
    renderWithProviders(<Opener meetingId={21} />);
    const bar = await screen.findByRole("note", { name: "AI 한 줄 요약" });
    expect(bar).toHaveAttribute("data-layout", "stacked");
    expect(bar).toHaveTextContent(HEADLINE);
    expect(bar).toHaveTextContent("안건 4 · 논의 2 · 결정 1 · 액션 1 · 업무 1");
    expect(within(bar).getByTitle(HEADLINE)).toBeInTheDocument();
    expect(screen.getByText("편집과 업무 연동은 전체 페이지에서 합니다")).toBeInTheDocument();
    expect(screen.getByText("도입 사례는 3건만 유지하고 나머지는 별도 페이지로 분리한다.")).toBeInTheDocument();
    expect(screen.getByText("다음 논의로")).toBeInTheDocument();
    expect(screen.getByText("첨부 파일 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "편집" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /제거/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /업무 생성|업무 갱신/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "실시간 스크립트" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "줄 내용" })).not.toBeInTheDocument();
    // 근거 펼침은 되지만 칩은 표시만 + 캡션
    await userEvent.click(within(document.querySelector('[data-line-id="301"]') as HTMLElement).getByRole("button", { name: "펼치기" }));
    expect(screen.getByText("09:39 – 09:39")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /근거 구간/ })).not.toBeInTheDocument();
    expect(screen.getByText("스크립트는 전체 페이지에서 볼 수 있습니다")).toBeInTheDocument();
    // 헤더 — 유형 배지 · 프로젝트 칩 · 제목 · 일시 · 상태 칩
    expect(screen.getByRole("button", { name: "유형 바꾸기" })).toHaveTextContent("미팅·회의");
    expect(screen.getByRole("button", { name: "프로젝트 바꾸기" })).toHaveTextContent("소개서 개정");
    expect(screen.getByRole("button", { name: "일시" })).toHaveTextContent("08월 27일 (목) 09:30 – 10:30");
    expect(screen.getByText("종료된 회의")).toBeInTheDocument();
  });

  it("⤢ → 전체 페이지 라우트로 승격(드로어가 닫힌다) · `⋯` 「삭제」 → 드로어가 닫힌 뒤 모달", async () => {
    mockMeeting(endedSucceeded());
    renderWithProviders(<Opener meetingId={21} />);
    await screen.findByRole("note", { name: "AI 한 줄 요약" });
    await userEvent.click(screen.getByRole("button", { name: "전체 페이지로 열기" }));
    expect(push).toHaveBeenCalledWith("/meetings/detail/?id=21");
    await waitFor(() => expect(screen.queryByRole("note", { name: "AI 한 줄 요약" })).not.toBeInTheDocument());

    // 다시 열어 `⋯` → 「삭제」
    const { unmount } = renderWithProviders(<Opener meetingId={21} />);
    await screen.findByRole("note", { name: "AI 한 줄 요약" });
    await userEvent.click(screen.getByRole("button", { name: "더 보기" }));
    await userEvent.click(await screen.findByRole("button", { name: "삭제" }));
    expect(await screen.findByRole("dialog", { name: "'제품 소개서 리뷰' 회의록을 삭제할까요?" })).toBeInTheDocument();
    expect(screen.queryByRole("note", { name: "AI 한 줄 요약" })).not.toBeInTheDocument();
    unmount();
  });

  it("헤더 제목을 고치면 `PATCH {title}` 이 나간다(페이지와 같은 컨트롤)", async () => {
    const bodies: unknown[] = [];
    const state = mockMeeting(endedSucceeded());
    server.use(
      http.patch(`${API_BASE}/api/meetings/21`, async ({ request }) => {
        const body = (await request.json()) as { title: string };
        bodies.push(body);
        state.detail = { ...state.detail, title: body.title };
        return HttpResponse.json(state.detail);
      }),
    );
    renderWithProviders(<Opener meetingId={21} />);
    const title = await screen.findByRole("textbox", { name: "제목" });
    await userEvent.clear(title);
    await userEvent.type(title, "제품 소개서 리뷰 (드로어)");
    await userEvent.tab();
    await waitFor(() => expect(bodies).toEqual([{ title: "제품 소개서 리뷰 (드로어)" }]));
  });
});

describe("상태별 본문", () => {
  it("`scheduled` — 안건 목록 + 캡션 「회의 시작은 전체 페이지에서 합니다」 · 첨부 n", async () => {
    mockMeeting(meetingDetail({ status: "scheduled" }));
    renderWithProviders(<Opener meetingId={21} />);
    expect(await screen.findByText("회의 시작은 전체 페이지에서 합니다")).toBeInTheDocument();
    expect(screen.getByText("개정 대상 섹션 확정")).toBeInTheDocument();
    expect(screen.getByText("첨부 파일 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "회의 시작" })).not.toBeInTheDocument();
  });

  it("`recording` — 스냅숏 + 캡션 · **WS 연결 0** · 메타 잠금", async () => {
    mockMeeting(meetingDetail({ status: "recording", recordingStartedAt: STARTED, agendas: { human: HUMAN, ai: [], merged: [] } }));
    renderWithProviders(<Opener meetingId={21} />);
    expect(await screen.findByText("진행 중인 회의입니다 · 전체 페이지에서 보기")).toBeInTheDocument();
    expect(screen.getByText("제품 개요 · 기능은 유지, 도입 사례 분량이 과다")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(screen.queryByRole("textbox", { name: "제목" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "일시" })).not.toBeInTheDocument();
  });

  it("`generating` — 스피너 + 「녹음을 다시 받아쓰고 있습니다」 · job 폴링이 돈다 · 메타 · 삭제 잠금 · 끝나면 최종 회의록으로 바뀐다", async () => {
    let jobReads = 0;
    const state = mockMeeting(generatingMeeting());
    server.use(
      http.get(`${API_BASE}/api/jobs/123`, () => {
        jobReads += 1;
        if (jobReads >= 2) {
          state.detail = endedSucceeded();
          return HttpResponse.json({ id: 123, kind: "meeting_finalize", status: "succeeded", progress: { phase: "integration", attempt: 1 }, errorCode: null, errorMessage: null, finishedAt: "2026-08-27T01:31:00Z" });
        }
        return HttpResponse.json({ id: 123, kind: "meeting_finalize", status: "running", progress: { phase: "final_batch", attempt: 0 }, errorCode: null, errorMessage: null, finishedAt: null });
      }),
    );
    renderWithProviders(<Opener meetingId={21} />, createTestClient());
    expect(await screen.findByRole("status", { name: "회의록 생성중" })).toHaveTextContent("녹음을 다시 받아쓰고 있습니다");
    expect(screen.getByText("회의록 생성중")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "제목" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "더 보기" }));
    expect(await screen.findByRole("button", { name: "삭제" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(jobReads).toBeGreaterThanOrEqual(1));
    expect(await screen.findByRole("note", { name: "AI 한 줄 요약" }, { timeout: 5000 })).toHaveAttribute("data-layout", "stacked");
    expect(screen.getByText("종료된 회의")).toBeInTheDocument();
  }, 10_000);
});
