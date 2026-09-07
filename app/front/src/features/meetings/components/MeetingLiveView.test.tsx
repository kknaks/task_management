/**
 * **회의 중 화면 조립 — 앱 창 확인 항목의 테스트 판**(WP Phase 6 검증 · SPEC-007 §6 순서).
 *
 * 대역 WS + 목 마이크로 옮긴 것. 마이크·Tauri·반응형 실측은 「실물 확인 필요」 목록이다.
 *
 * - 새로고침·재실행 → **`paused/stream`「서버 연결이 끊겼습니다」로 시작** + 트랜스크립트·두 트랙·「배치 n회」 복원 · 연결 0건
 * - 「회의 시작」 표지가 있으면 → 「연결 중」 → `ready` → 「기록 중」 · 파형·「자동 저장」이 상태 바에 없다 · 백엔드가 끊기면 「서버 연결이 끊겼습니다」 + 「회의 종료」 활성 + 재연결 0
 * - 부제에 장소 없음 · 「회의 종료」는 `connecting` 빼고 활성 · 「일시정지」/「재개」 토글
 * - 회의록 탭: 배지 3종 · **AI 안건·줄 없음** · 삭제·제목 수정 어포던스 없음 · 사람 줄 클릭해도 편집 안 됨
 * - 줄 전송 → `POST lines` → 활성 안건 아래 + 「자동 저장 · HH:MM」 · `/` → 업무 · 새 안건 = `POST agendas` → `PATCH state:active`
 * - **슬래시 명령어**(WORK-011) — `/결정 ` 은 `kind` 로만 나가고 본문에 명령어 문자열이 없다 · `/api …` 는 본문 · `/새안건 ` 은 두 요청
 * - **AI 탭은 배치마다 통째로 교체**된다(MF-53) · **줄에 시각이 없다**(MF-9)
 * - 안건 체크 → `PATCH state:done` → 다음 「대기」가 「논의 중」 · 칩이 바뀐다
 * - AI 탭: 「배치 2회 반영」 · **트리(카드 아님)** · 「AI 안건」 · 펼침 → 칩 → 스크립트 탭 전환 + 강조 → `Esc`
 * - 첨부 탭: PNG·PDF·「회의 중 작성」 없음 · 문서 행 → 드로어(이동 없음) · 트랜스크립트 실패 → 「불러오지 못했습니다」 + 「다시 시도」
 */

import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MeetingDetailPage } from "@/features/meetings/components/MeetingDetailPage";
import { createTestClient, meetingDetail, renderWithProviders } from "@/features/meetings/testUtils";
import type { MeetingAgenda, MeetingDetail, MeetingLine, TranscriptResponse } from "@/features/meetings/types";
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

const STARTED = "2026-08-27T00:30:00Z";

function line(partial: Partial<MeetingLine> & Pick<MeetingLine, "id" | "agendaId" | "track" | "kind" | "content">): MeetingLine {
  return {
    detail: null, evidence: [], orderIndex: partial.id, taskId: null, payload: null,
    task: null, createdAt: "2026-08-27T00:34:00Z", ...partial,
  };
}

const HUMAN: MeetingAgenda[] = [
  { id: 301, track: "human", title: "개정 대상 섹션 확정", orderIndex: 0, state: "done", sourceAgendaId: null, lines: [line({ id: 1, agendaId: 301, track: "human", kind: "decision", content: "3건만 유지한다" })] },
  { id: 302, track: "human", title: "디자인 반영 일정", orderIndex: 1, state: "active", sourceAgendaId: null, lines: [line({ id: 2, agendaId: 302, track: "human", kind: "discussion", content: "8/29 오전 수령" })] },
  { id: 303, track: "human", title: "가격 표기", orderIndex: 2, state: "next", sourceAgendaId: null, lines: [] },
];
const AI: MeetingAgenda[] = [
  { id: 40, track: "ai", title: "개정 대상 섹션 확정", orderIndex: 0, state: null, sourceAgendaId: 301, lines: [line({ id: 620, agendaId: 40, track: "ai", kind: "decision", content: "AI: 도입 사례는 3건만", detail: "유사 사례 지적.", evidence: [{ fromMs: 241_000, toMs: 247_300 }], createdAt: "2026-08-27T00:41:02Z" })] },
  { id: 41, track: "ai", title: "경쟁사 요금제 비교", orderIndex: 5, state: null, sourceAgendaId: null, lines: [] },
];
const TRANSCRIPT: TranscriptResponse = {
  recordingStartedAt: STARTED,
  speakerCount: 2,
  items: [
    { id: 298, speakerLabel: "1", atMs: 181_200, endMs: 187_900, content: "개정 대상 섹션부터 정리하고 가죠." },
    { id: 299, speakerLabel: "2", atMs: 241_000, endMs: 247_300, content: "도입 사례가 너무 길어요." },
  ],
};

function recording(overrides: Partial<MeetingDetail> = {}): MeetingDetail {
  return meetingDetail({
    status: "recording",
    recordingStartedAt: STARTED,
    latestBatchSeq: 2,
    agendas: { human: HUMAN, ai: AI, merged: [] },
    attachments: [
      { id: 42, kind: "link", name: "경쟁사 요금제 비교", documentId: null, folderPath: null, sizeBytes: null, updatedAt: "2026-08-20T01:00:00Z", url: "https://example.com/pricing", isDeleted: false },
      { id: 43, kind: "doc", name: "소개서-개정-메모.md", documentId: 7, folderPath: "자료함 › 소개서 개정", sizeBytes: 4096, updatedAt: "2026-08-27T00:20:00Z", url: null, isDeleted: false },
    ],
    ...overrides,
  });
}

let media: ReturnType<typeof installMedia>;

async function renderLive(detail: MeetingDetail = recording(), options: { startIntent?: boolean } = {}) {
  const state = { detail };
  server.use(
    http.get(`${API_BASE}/api/meetings/21`, () => HttpResponse.json(state.detail)),
    http.get(`${API_BASE}/api/meetings/21/transcript`, () => HttpResponse.json(TRANSCRIPT)),
  );
  const client = createTestClient();
  if (options.startIntent) {
    client.setQueryData(queryKeys.meetingStartIntent(21), true);
  }
  const result = renderWithProviders(<MeetingDetailPage />, client);
  await screen.findByRole("button", { name: "회의 종료" });
  return { ...result, state };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  tokenStore.setAccess("A1");
  push.mockReset();
  FakeWebSocket.reset();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  media = installMedia();
});

afterEach(async () => {
  media.restore();
  vi.unstubAllGlobals();
  await tokenStore.clear();
});

describe("진입 · 헤더 · 상태 바", () => {
  it("새로고침 진입 — 「서버 연결이 끊겼습니다」로 시작 · 연결 0건 · 두 트랙·「배치 2회」·스크립트 복원 · 부제에 장소 없음", async () => {
    await renderLive();
    expect(screen.getByRole("status", { name: "일시정지 · 서버 연결이 끊겼습니다" })).toBeInTheDocument();
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(media.getUserMedia).not.toHaveBeenCalled();
    // 메타 한 줄은 **일시만** — 유형 · 프로젝트는 배지 줄로 올라갔다(MF-8)
    expect(screen.getByText("08월 27일 (목) 09:30 시작")).toBeInTheDocument();
    expect(screen.queryByText(/회의실/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "재개" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "회의 종료" })).toBeEnabled();
    // 상태 바에는 문구 + 경과 시간만 — 「자동 저장」 없음
    expect(screen.getByRole("status").textContent).not.toMatch(/자동 저장/);

    // 회의록 탭 — 배지 3종 · AI 안건·줄 없음 · 삭제·제목 수정 어포던스 없음
    expect(screen.getByText("완료")).toBeInTheDocument();
    expect(screen.getByText("논의 중")).toBeInTheDocument();
    expect(screen.getByText("대기")).toBeInTheDocument();
    expect(screen.queryByText("AI 안건")).not.toBeInTheDocument();
    expect(screen.queryByText("AI: 도입 사례는 3건만")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /제거/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /제목/ })).not.toBeInTheDocument();
    // 사람 줄을 클릭해도 편집되지 않는다
    await userEvent.click(screen.getByText("8/29 오전 수령"));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    // 스크립트 복원 + 「화자 2명」 · 잠정 없음
    expect(screen.getByText("도입 사례가 너무 길어요.")).toBeInTheDocument();
    expect(screen.getByText("화자 2명")).toBeInTheDocument();
    expect(document.querySelector("[data-partial]")).toBeNull();
    // 「배치 2회 반영」은 AI 탭 안내 바
    await userEvent.click(screen.getByRole("tab", { name: "AI 요약" }));
    expect(screen.getByTestId("batch-caption")).toHaveTextContent("배치 2회 반영");
  });

  it("「회의 시작」 표지 → 마이크 → 「연결 중」(두 버튼 비활성) → `ready` → 「기록 중」 · 서버가 끊으면 「서버 연결이 끊겼습니다」 + 「회의 종료」 활성 + 재연결 0", async () => {
    await renderLive(recording({ latestBatchSeq: 0 }), { startIntent: true });
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    expect(screen.getByRole("status", { name: "연결 중" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "일시정지" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "회의 종료" })).toBeDisabled();

    const ws = FakeWebSocket.last;
    act(() => {
      ws.serverOpen();
      ws.serverSend({ type: "ready", recordingStartedAt: STARTED, latestBatchSeq: 0, speakerCount: 0 });
    });
    expect(screen.getByRole("status", { name: "기록 중" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "일시정지" })).toBeEnabled();
    expect(ws.sentFrames[0]).toMatchObject({ type: "auth", accessToken: "A1" });

    // 잠정 → 확정(진입 조회가 끝난 뒤 — 그 전에 오면 재조회로 따라잡는다)
    await screen.findByText("도입 사례가 너무 길어요.");
    act(() => ws.serverSend({ type: "transcript.partial", segments: [{ speakerLabel: "1", atMs: 300_000, text: "그럼 별도" }] }));
    expect(document.querySelector("[data-partial]")).toHaveTextContent("그럼 별도");
    act(() => ws.serverSend({ type: "transcript.final", item: { id: 300, speakerLabel: "1", atMs: 300_000, endMs: 305_000, content: "그럼 별도 페이지로." } }));
    // 캐시 갱신은 관찰자에게 비동기로 닿는다 — 기다린다.
    expect(await screen.findByText("그럼 별도 페이지로.")).toBeInTheDocument();

    // 사용자 일시정지 → 「재개」 · 잠정 사라짐 · 줄 입력 가능
    await userEvent.click(screen.getByRole("button", { name: "일시정지" }));
    expect(screen.getByRole("status", { name: "일시정지" })).toBeInTheDocument();
    expect(document.querySelector("[data-partial]")).toBeNull();
    expect(screen.getByRole("combobox", { name: "줄 입력" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "재개" }));
    expect(ws.sentFrames.at(-1)).toEqual({ type: "resume" });
    act(() => ws.serverSend({ type: "ready", recordingStartedAt: STARTED, latestBatchSeq: 0, speakerCount: 1 }));
    expect(screen.getByRole("status", { name: "기록 중" })).toBeInTheDocument();

    // 백엔드가 내려간다
    act(() => {
      ws.serverSend({ type: "error", code: "meeting_stream_disconnected", reason: "upstream" });
      ws.serverClose(1011, "meeting_stream_disconnected");
    });
    expect(screen.getByRole("status", { name: "일시정지 · 서버 연결이 끊겼습니다" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "회의 종료" })).toBeEnabled();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(FakeWebSocket.instances).toHaveLength(1);
    // 「재개」를 눌러야 새 연결
    await userEvent.click(screen.getByRole("button", { name: "재개" }));
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
  });

  it("다른 창에서 기록 중이면(`4409 meeting_stream_active`) 「다른 창에서 기록 중입니다」 + 「재개」 비활성", async () => {
    await renderLive(recording(), { startIntent: true });
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    act(() => FakeWebSocket.last.serverClose(4409, "meeting_stream_active"));
    expect(screen.getByRole("status", { name: "다른 창에서 기록 중입니다" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "재개" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "회의 종료" })).toBeEnabled();
  });
});

describe("회의록 탭 — 줄 · 안건", () => {
  it("그냥 치고 `Enter` → `POST lines {agendaId:302, kind:'discussion'}` → 활성 안건 아래 + 「자동 저장 · HH:MM」 · 자동 재시도 없음", async () => {
    const bodies: unknown[] = [];
    await renderLive();
    server.use(
      http.post(`${API_BASE}/api/meetings/21/lines`, async ({ request }) => {
        const body = (await request.json()) as { agendaId: number; kind: string; content: string };
        bodies.push(body);
        return HttpResponse.json(line({ id: 501, agendaId: body.agendaId, track: "human", kind: body.kind, content: body.content, createdAt: "2026-08-27T00:45:10Z" }), { status: 201 });
      }),
    );
    expect(screen.getByTestId("autosave-caption")).toHaveTextContent("");
    await userEvent.type(screen.getByRole("combobox", { name: "줄 입력" }), "가격은 현행 유지{Enter}");
    await waitFor(() => expect(bodies).toEqual([{ agendaId: 302, kind: "discussion", content: "가격은 현행 유지" }]));
    expect(await screen.findByText("가격은 현행 유지")).toBeInTheDocument();
    expect(screen.getByTestId("autosave-caption")).toHaveTextContent(/자동 저장 · \d\d:\d\d/);
    // 새 줄이 안건 2 아래 마지막이다
    const agenda2 = document.querySelector('[data-agenda-id="302"]') as HTMLElement;
    expect(within(agenda2).getAllByText(/수령|현행/).map((el) => el.textContent)).toEqual(["8/29 오전 수령", "가격은 현행 유지"]);
  });

  it("**슬래시 명령어**(U-3) — `/결정 ` → `kind:'decision'` · 본문에 `/결정` 0건 · `/api …` 는 본문 · `/새안건 ` → `POST agendas` → `PATCH state:active` 순서", async () => {
    const calls: string[] = [];
    const bodies: { kind: string; content: string }[] = [];
    const { state } = await renderLive();
    server.use(
      http.post(`${API_BASE}/api/meetings/21/lines`, async ({ request }) => {
        const body = (await request.json()) as { agendaId: number; kind: string; content: string };
        bodies.push({ kind: body.kind, content: body.content });
        calls.push(`line:${body.kind}`);
        return HttpResponse.json(line({ id: 510 + bodies.length, agendaId: body.agendaId, track: "human", kind: body.kind, content: body.content }), { status: 201 });
      }),
      http.post(`${API_BASE}/api/meetings/21/agendas`, async ({ request }) => {
        const body = (await request.json()) as { title: string };
        calls.push("agendas");
        state.detail = {
          ...state.detail,
          agendas: { ...state.detail.agendas, human: [...HUMAN, { id: 304, track: "human", title: body.title, orderIndex: 3, state: "next", sourceAgendaId: null, lines: [] }] },
        };
        return HttpResponse.json(state.detail, { status: 201 });
      }),
      http.patch(`${API_BASE}/api/meetings/21/agendas/304`, async ({ request }) => {
        calls.push(`patch:${JSON.stringify(await request.json())}`);
        return HttpResponse.json(state.detail);
      }),
    );

    const input = screen.getByRole("combobox", { name: "줄 입력" });
    await userEvent.type(input, "/결정 3건만 유지한다{Enter}");
    await waitFor(() => expect(bodies).toEqual([{ kind: "decision", content: "3건만 유지한다" }]));
    expect(JSON.stringify(bodies)).not.toContain("/결정");

    // 5개 밖의 `/…` 는 그대로 본문이다
    await userEvent.type(input, "/api 경로를 바꾸자{Enter}");
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toEqual({ kind: "discussion", content: "/api 경로를 바꾸자" });

    await userEvent.type(input, "/새안건 ");
    await userEvent.type(screen.getByRole("combobox", { name: "안건 제목" }), "가격 표기 처리{Enter}");
    await waitFor(() => expect(calls).toEqual(["line:decision", "line:discussion", "agendas", 'patch:{"state":"active"}']));
  });

  it("전송 5xx → 토스트 「저장하지 못했습니다 · 다시 보내 주세요」 + 입력 유지 · 재요청 0건 · `422` 는 인라인", async () => {
    let calls = 0;
    await renderLive();
    server.use(
      http.post(`${API_BASE}/api/meetings/21/lines`, () => {
        calls += 1;
        return HttpResponse.json({ detail: "서버 오류", code: "internal_error" }, { status: 500 });
      }),
    );
    const input = screen.getByRole("combobox", { name: "줄 입력" });
    await userEvent.type(input, "실패할 줄{Enter}");
    expect(await screen.findByText("저장하지 못했습니다 · 다시 보내 주세요")).toBeInTheDocument();
    expect(input).toHaveValue("실패할 줄");
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(calls).toBe(1);

    server.use(
      http.post(`${API_BASE}/api/meetings/21/lines`, () =>
        HttpResponse.json({ detail: "2000자까지 입력할 수 있습니다", code: "validation_error" }, { status: 422 }),
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "전송" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("2000자까지 입력할 수 있습니다");
    expect(input).toHaveValue("실패할 줄");
  });

  it("`/` → 「업무」 → `Enter` → `kind:'task'` · 「새 안건」 → `POST agendas` 뒤 `PATCH state:active` 순서 · 새 안건이 「논의 중」, 이전은 「대기」", async () => {
    const calls: string[] = [];
    const { state } = await renderLive();
    server.use(
      http.post(`${API_BASE}/api/meetings/21/lines`, async ({ request }) => {
        const body = (await request.json()) as { kind: string; content: string; agendaId: number };
        calls.push(`line:${body.kind}`);
        return HttpResponse.json(line({ id: 502, agendaId: body.agendaId, track: "human", kind: body.kind, content: body.content }), { status: 201 });
      }),
      http.post(`${API_BASE}/api/meetings/21/agendas`, async ({ request }) => {
        const body = (await request.json()) as { title: string };
        calls.push("agendas");
        state.detail = {
          ...state.detail,
          agendas: { ...state.detail.agendas, human: [...HUMAN, { id: 304, track: "human", title: body.title, orderIndex: 3, state: "next", sourceAgendaId: null, lines: [] }] },
        };
        return HttpResponse.json(state.detail, { status: 201 });
      }),
      http.patch(`${API_BASE}/api/meetings/21/agendas/304`, async ({ request }) => {
        calls.push(`patch:${JSON.stringify(await request.json())}`);
        state.detail = {
          ...state.detail,
          agendas: {
            ...state.detail.agendas,
            human: state.detail.agendas.human.map((a) => (a.id === 304 ? { ...a, state: "active" } : a.id === 302 ? { ...a, state: "next" } : a)),
          },
        };
        return HttpResponse.json(state.detail);
      }),
    );
    const input = screen.getByRole("combobox", { name: "줄 입력" });
    await userEvent.type(input, "/");
    await userEvent.click(await screen.findByRole("option", { name: "업무" }));
    await userEvent.type(input, "소개서 v2 문구 정리{Enter}");
    await waitFor(() => expect(calls).toEqual(["line:task"]));
    const taskRow = (await screen.findByText("소개서 v2 문구 정리")).closest("[data-line-kind]");
    expect(taskRow).toHaveAttribute("data-line-kind", "task");
    expect(within(taskRow as HTMLElement).queryByRole("button")).not.toBeInTheDocument();

    await userEvent.type(input, "/");
    await userEvent.click(await screen.findByRole("option", { name: /새 안건/ }));
    await userEvent.type(screen.getByRole("combobox", { name: "안건 제목" }), "가격 표기 처리{Enter}");
    await waitFor(() => expect(calls).toEqual(["line:task", "agendas", 'patch:{"state":"active"}']));
    await waitFor(() => expect(screen.getByRole("button", { name: /^안건 4 ·/ })).toBeInTheDocument());
    const agenda4 = document.querySelector('[data-agenda-id="304"]') as HTMLElement;
    expect(within(agenda4).getByText("논의 중")).toBeInTheDocument();
    expect(within(document.querySelector('[data-agenda-id="302"]') as HTMLElement).getByText("대기")).toBeInTheDocument();
  });

  it("안건 체크 → `PATCH state:done` → 「완료」 + 취소선, 다음 「대기」 안건이 「논의 중」, 칩이 「안건 3」 · 실패면 토스트 + 배지 그대로(낙관적 없음)", async () => {
    const bodies: unknown[] = [];
    const { state } = await renderLive();
    server.use(
      http.patch(`${API_BASE}/api/meetings/21/agendas/302`, async ({ request }) => {
        bodies.push(await request.json());
        if (bodies.length === 1) {
          return HttpResponse.json({ detail: "서버 오류", code: "internal_error" }, { status: 500 });
        }
        state.detail = {
          ...state.detail,
          agendas: { ...state.detail.agendas, human: HUMAN.map((a) => (a.id === 302 ? { ...a, state: "done" } : a.id === 303 ? { ...a, state: "active" } : a)) },
        };
        return HttpResponse.json(state.detail);
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "안건 2 완료" }));
    expect(await screen.findByText("저장하지 못했습니다 · 안건")).toBeInTheDocument();
    expect(within(document.querySelector('[data-agenda-id="302"]') as HTMLElement).getByText("논의 중")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "안건 2 완료" }));
    await waitFor(() => expect(bodies).toEqual([{ state: "done" }, { state: "done" }]));
    await waitFor(() => expect(screen.getByRole("button", { name: "안건 2 완료 해제" })).toBeInTheDocument());
    expect(within(document.querySelector('[data-agenda-id="302"]') as HTMLElement).getByText("디자인 반영 일정")).toHaveClass("line-through");
    expect(within(document.querySelector('[data-agenda-id="303"]') as HTMLElement).getByText("논의 중")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^안건 3 ·/ })).toBeInTheDocument();
  });
});

describe("AI 요약 탭 · 근거 칩 · 미확인 점", () => {
  it("트리(카드 아님) · 「AI 안건」 캡션 · 펼침 → 칩 → **스크립트 탭 전환 + 강조** → `Esc` 해제 · 회의록 탭에는 AI 없음", async () => {
    await renderLive();
    // 첨부 탭을 보고 있어도 칩은 스크립트 탭으로 바꾼다
    await userEvent.click(screen.getByRole("tab", { name: "첨부 파일 2" }));
    await userEvent.click(screen.getByRole("tab", { name: "AI 요약" }));
    expect(screen.getByText("AI 안건")).toBeInTheDocument();
    expect(screen.getByText("AI: 도입 사례는 3건만")).toBeInTheDocument();
    expect(screen.queryByText(/결정 1/)).not.toBeInTheDocument();
    expect(screen.getByText("회의 종료 시 안건별 요약이 회의록에 반영됩니다")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "펼치기" }));
    expect(screen.getByText("유사 사례 지적.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "근거 구간 09:34 – 09:34" }));
    expect(screen.getByRole("tab", { name: "실시간 스크립트" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(document.querySelectorAll("[data-highlighted]")).toHaveLength(1));
    expect(screen.getByText("근거 구간")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(document.querySelectorAll("[data-highlighted]")).toHaveLength(0);
  });

  it("`ai.batch` 가 오면 회의록 탭을 보고 있어도 AI 탭 옆 **파란 점** · 열면 「배치 3회 반영 · HH:MM」 + 트리가 **통째로 교체**(옛 줄 사라짐 · 펼침 접힘) · 점 꺼짐", async () => {
    await renderLive(recording(), { startIntent: true });
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const ws = FakeWebSocket.last;
    act(() => {
      ws.serverOpen();
      ws.serverSend({ type: "ready", recordingStartedAt: STARTED, latestBatchSeq: 2, speakerCount: 2 });
    });
    expect(screen.queryByTestId("ai-unseen")).not.toBeInTheDocument();

    // 먼저 AI 탭에서 첫 배치 줄을 펼쳐 둔다 — 새 배치가 오면 id 가 새로 생겨 접힌다(MF-53)
    await userEvent.click(screen.getByRole("tab", { name: "AI 요약" }));
    await userEvent.click(screen.getByRole("button", { name: "펼치기" }));
    expect(screen.getByText("유사 사례 지적.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "회의록" }));

    // 둘째 배치 = AI 트랙 전량(안건 안에 줄이 중첩). 앞 배치가 가른 안건이 하나로 합쳐져 온다
    act(() =>
      ws.serverSend({
        type: "ai.batch",
        seq: 3,
        agendas: [
          {
            id: 60, track: "ai", title: "개정 대상 섹션 확정", orderIndex: 0, state: null, sourceAgendaId: 301,
            lines: [
              line({ id: 700, agendaId: 60, track: "ai", kind: "decision", content: "AI: 도입 사례는 3건만 유지", detail: "다시 정리한 상세.", evidence: [{ fromMs: 241_000, toMs: 247_300 }], createdAt: "2026-08-27T00:44:00Z" }),
              line({ id: 701, agendaId: 60, track: "ai", kind: "action", content: "AI: 분리 초안 만들기", createdAt: "2026-08-27T00:44:00Z" }),
            ],
          },
        ],
      }),
    );
    expect(screen.getByTestId("ai-unseen")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "AI 요약" }));
    expect(screen.getByTestId("batch-caption")).toHaveTextContent(/배치 3회 반영 · \d\d:\d\d/);
    // 첫 배치의 안건·줄은 캐시에 남지 않는다 — 트리가 새 전체다
    expect(screen.queryByText("AI: 도입 사례는 3건만")).not.toBeInTheDocument();
    expect(screen.queryByText("AI 안건")).not.toBeInTheDocument();
    expect(document.querySelector('[data-agenda-id="40"]')).toBeNull();
    expect(document.querySelector('[data-line-id="620"]')).toBeNull();
    expect(screen.getByText("AI: 도입 사례는 3건만 유지")).toBeInTheDocument();
    expect(screen.getByText("AI: 분리 초안 만들기")).toBeInTheDocument();
    // 펼쳐 둔 줄이 접혔다
    expect(screen.queryByText("유사 사례 지적.")).not.toBeInTheDocument();
    expect(screen.queryByText("다시 정리한 상세.")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ai-unseen")).not.toBeInTheDocument();
  });

  it("**줄에 시각이 없다**(MF-9) — 회의록 탭·AI 탭 줄 행에 `HH:MM` 0건 · 안건 헤더 시각과 안내 바 시각은 남는다", async () => {
    await renderLive();
    const clocked = () => [...document.querySelectorAll("[data-line-id]")].filter((row) => /\d\d:\d\d/.test(row.textContent ?? ""));
    expect(document.querySelectorAll("[data-line-id]").length).toBeGreaterThan(0);
    expect(clocked()).toHaveLength(0);
    // 안건 헤더의 시각은 남는다(첫 줄 09:34)
    const agenda1 = document.querySelector('[data-agenda-id="301"]') as HTMLElement;
    expect(within(agenda1).getByText("09:34")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "AI 요약" }));
    expect(document.querySelectorAll("[data-line-id]").length).toBeGreaterThan(0);
    expect(clocked()).toHaveLength(0);
    expect(screen.getByTestId("batch-caption")).toHaveTextContent(/배치 2회 반영/);
  });

  it("첫 배치 전 — 「첫 배치를 기다리는 중」 + 「기록이 쌓이면 요약이 생성됩니다」", async () => {
    await renderLive(recording({ latestBatchSeq: 0, agendas: { human: HUMAN, ai: [], merged: [] } }));
    await userEvent.click(screen.getByRole("tab", { name: "AI 요약" }));
    expect(screen.getByText("첫 배치를 기다리는 중")).toBeInTheDocument();
    expect(screen.getByText("기록이 쌓이면 요약이 생성됩니다")).toBeInTheDocument();
  });
});

describe("우 패널 — 첨부 · 트랜스크립트 실패", () => {
  it("첨부 탭: MD·링크 행만(PNG·PDF·「회의 중 작성」 없음) · 문서 행 → 드로어(미리보기/원문 텍스트) · 이동 없음 · 드롭은 토스트만", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await renderLive();
    await userEvent.click(screen.getByRole("tab", { name: "첨부 파일 2" }));
    expect(screen.queryByText(/PNG|PDF|회의 중 작성/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "경쟁사 요금제 비교" })).toHaveAttribute("target", "_blank");

    await userEvent.click(screen.getByRole("button", { name: /소개서-개정-메모\.md/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("tab", { name: "미리보기" })).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: "원문 텍스트" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("tab", { name: /편집/ })).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("tab", { name: "첨부 파일 2" })).toHaveAttribute("aria-selected", "true");

    const before = fetchSpy.mock.calls.length;
    const footer = screen.getByText("끌어다 놓아도 첨부됩니다 · 최대 50MB");
    footer.dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
    footer.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
    expect(await screen.findByText("v2에서 제공됩니다")).toBeInTheDocument();
    expect(fetchSpy.mock.calls.length).toBe(before);
    fetchSpy.mockRestore();
  });

  it("트랜스크립트 조회 실패 → 「불러오지 못했습니다」 + 「다시 시도」 — 빈 목록으로 대체하지 않는다", async () => {
    let calls = 0;
    server.use(
      http.get(`${API_BASE}/api/meetings/21`, () => HttpResponse.json(recording())),
      http.get(`${API_BASE}/api/meetings/21/transcript`, () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ detail: "서버 오류", code: "internal_error" }, { status: 500 })
          : HttpResponse.json(TRANSCRIPT);
      }),
    );
    renderWithProviders(<MeetingDetailPage />);
    expect(await screen.findByText("불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.queryByText("아직 발화가 없습니다")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("도입 사례가 너무 길어요.")).toBeInTheDocument();
  });
});

void flush;
describe("헤더 순서 · 「←」(WORK-014 · MF-8 · FE §6-3)", () => {
  it("① breadcrumb(+「←」) → ② 배지 줄 → ③ 제목 → ④ 메타 순서다 · 메타에 유형 · 프로젝트가 없다", async () => {
    await renderLive();
    const back = screen.getByRole("link", { name: "뒤로" });
    expect(back.getAttribute("href")).toMatch(/^\/meetings\/?$/);
    // breadcrumb 「홈」·「회의록」이 링크다(마지막 제목만 아니다)
    const nav = screen.getByRole("navigation", { name: "현재 위치" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual(["홈", "회의록"]);

    const badges = document.querySelector("[data-header-badges]") as HTMLElement;
    const title = screen.getByRole("heading", { level: 1 });
    const meta = document.querySelector("[data-header-meta]") as HTMLElement;
    // **제목이 배지 줄 위에 오면 반려**다 — DOM 순서로 고정한다
    expect(badges.compareDocumentPosition(title)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(title.compareDocumentPosition(meta)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // ④ 메타에는 유형 · 프로젝트가 없다 — ② 로 올라갔다
    expect(meta.textContent).not.toMatch(/미팅·회의|소개서 개정/);
    // ② 배지 줄에 유형 · 프로젝트 · 그 화면의 액션이 **같은 줄**에 있다
    expect(badges.textContent).toContain("미팅·회의");
    expect(within(badges).getByRole("button", { name: "회의 종료" })).toBeInTheDocument();
    expect(within(badges).getByRole("button", { name: /재개|일시정지/ })).toBeInTheDocument();
  });
});

