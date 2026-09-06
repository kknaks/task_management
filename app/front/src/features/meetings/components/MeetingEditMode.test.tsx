/**
 * **편집 모드 · 논의/결정 드로어 · 줄 삭제 모달 · 안건 이름 — 앱 창 확인 항목의 테스트 판**(WP Phase 4 검증 · SPEC-008 U-7 · U-8).
 *
 * - 「편집」 → 줄 본문 · 안건 제목이 입력 상자 · 종류 셀렉터 · 「제거」 · 「+」 칩 4. 헤더 「변경은 자동 저장됩니다 · 편집 완료」 — **「되돌리기」 없음**
 * - 본문 blur → `PATCH …/lines/{id} {content}` **1회** · 실패(5xx) → 토스트 + 「다시 저장」 + 값 유지 + **재요청 0** · 롤백
 * - 종류 → 「결정」 → `PATCH {kind}` · 「업무」는 `taskId` 없는 줄에서 비활성 + 캡션 · 업무 줄 → 「논의」 는 응답 뒤 반영(낙관적 아님)
 * - 「제거」 → 모달 「이 줄을 삭제할까요?」 → 「취소」 = 요청 0 · 「삭제」 → `DELETE` → 줄 사라짐 · 업무 줄 경고 슬롯 · 실패 → 줄 그대로 + 「삭제하지 못했습니다」
 * - 안건 제목 blur → `PATCH …/agendas/{id} {title}`(`state` 없음) · 빈 값은 되돌림 + 캡션 · 안건 추가 · 삭제 버튼 **없음**
 * - 「+ 결정」 → 드로어 「결정 추가」 — 근거 구간 · 「구간 추가」 · 「비워두면 …」 캡션 **없음** → 「추가」 → `POST …/lines` → 안건 맨 아래
 * - 「편집 완료」 → 요청 없이 보기 모드
 */

import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MeetingDetailPage } from "@/features/meetings/components/MeetingDetailPage";
import { endedFailed, endedSucceeded, line, MERGED, TRANSCRIPT } from "@/features/meetings/closeFixtures";
import { renderWithProviders } from "@/features/meetings/testUtils";
import type { MeetingDetail, MeetingLine } from "@/features/meetings/types";
import { tokenStore } from "@/lib/auth/tokenStore";
import { API_BASE, server } from "@/test/server";

vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    ...actual,
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
    usePathname: () => "/meetings/detail/",
    useSearchParams: () => new URLSearchParams("id=21"),
  };
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function harness(detail: MeetingDetail) {
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
  renderWithProviders(<MeetingDetailPage />);
  return state;
}

/** 캐시에 있는 통합본 줄 하나를 바꾼 상세 — 서버 응답 흉내. */
function withLine(detail: MeetingDetail, lineId: number, update: (current: MeetingLine) => MeetingLine): MeetingDetail {
  return {
    ...detail,
    agendas: {
      ...detail.agendas,
      merged: detail.agendas.merged.map((agenda) => ({ ...agenda, lines: agenda.lines.map((current) => (current.id === lineId ? update(current) : current)) })),
    },
  };
}

async function enterEdit() {
  await userEvent.click(await screen.findByRole("button", { name: "편집" }));
  expect(await screen.findByRole("button", { name: "편집 완료" })).toBeInTheDocument();
}

const row = (id: number) => document.querySelector(`[data-line-id="${id}"]`) as HTMLElement;
const agendaEl = (id: number) => document.querySelector(`[data-agenda-id="${id}"]`) as HTMLElement;

beforeEach(() => {
  tokenStore.setAccess("A1");
});

afterEach(async () => {
  await tokenStore.clear();
});

describe("진입 · 어포던스", () => {
  it("「편집」 → 입력 상자 · 셀렉터 · 「제거」 · 「+」 칩 · 안건 제목 입력 · 「되돌리기」 없음 · 안건 추가/삭제 없음 · 「편집 완료」 는 요청 없이 보기 모드", async () => {
    const state = harness(endedSucceeded());
    await enterEdit();
    expect(screen.getByText("변경은 자동 저장됩니다")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "되돌리기" })).not.toBeInTheDocument();
    expect(screen.queryByText("되돌리기")).not.toBeInTheDocument();
    // 통합본 줄 5개가 전부 입력 상자 · 셀렉터 · 「제거」
    expect(screen.getAllByRole("textbox", { name: "줄 내용" })).toHaveLength(5);
    expect(screen.getAllByRole("button", { name: "줄 종류" })).toHaveLength(5);
    expect(screen.getAllByRole("button", { name: "줄 제거" })).toHaveLength(5);
    // 안건 제목 입력 상자(결정 ②) — 4개 · 「안건 n」 라벨 · 배지는 그대로
    expect(screen.getAllByRole("textbox", { name: /안건 \d 제목/ })).toHaveLength(4);
    expect(screen.getByText("다음 논의로")).toBeInTheDocument();
    expect(screen.getByText("AI 안건")).toBeInTheDocument();
    // 안건 추가 · 삭제 · 상태 변경 어포던스 없음
    expect(screen.queryByRole("button", { name: /안건 \d 제거/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /안건 \d 완료/ })).not.toBeInTheDocument();
    expect(screen.queryByText("새 안건")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "줄 입력" })).not.toBeInTheDocument();
    // 「+」 칩 4 — 논의 · 결정은 산다. 연관 업무 · 액션 아이템은 Phase 5 자리(비활성)
    const footer = within(agendaEl(71));
    expect(footer.getByRole("button", { name: "논의" })).toBeEnabled();
    expect(footer.getByRole("button", { name: "결정" })).toBeEnabled();
    expect(footer.getByRole("button", { name: "연관 업무" })).toBeDisabled();
    expect(footer.getByRole("button", { name: "액션 아이템" })).toBeDisabled();

    const reads = state.reads;
    await userEvent.click(screen.getByRole("button", { name: "편집 완료" }));
    expect(screen.getByRole("button", { name: "편집" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "줄 내용" })).not.toBeInTheDocument();
    await sleep(50);
    expect(state.reads).toBe(reads);
  });

  it("실패 상태(`ended`+`failed`)의 편집은 사람 원본 트랙이다 — `PATCH` 가 사람 줄 id 로 나간다", async () => {
    const bodies: string[] = [];
    harness(endedFailed());
    server.use(
      http.patch(`${API_BASE}/api/meetings/21/lines/:lineId`, async ({ params, request }) => {
        bodies.push(`${params.lineId}:${JSON.stringify(await request.json())}`);
        return HttpResponse.json(endedFailed());
      }),
    );
    await enterEdit();
    const input = within(row(120)).getByRole("textbox", { name: "줄 내용" });
    await userEvent.clear(input);
    await userEvent.type(input, "고친 문장");
    await userEvent.tab();
    await waitFor(() => expect(bodies).toEqual(['120:{"content":"고친 문장"}']));
  });
});

describe("자동 저장 — 본문 · 종류 · 안건 이름", () => {
  it("본문을 고치고 바깥 클릭 → `PATCH {content}` 1회 · 값이 그대로면 요청 0 · `Esc` 는 되돌리고 저장 안 함", async () => {
    const bodies: unknown[] = [];
    const state = harness(endedSucceeded());
    server.use(
      http.patch(`${API_BASE}/api/meetings/21/lines/300`, async ({ request }) => {
        const body = (await request.json()) as { content: string };
        bodies.push(body);
        state.detail = withLine(state.detail, 300, (current) => ({ ...current, content: body.content }));
        return HttpResponse.json(state.detail);
      }),
    );
    await enterEdit();
    const input = within(row(300)).getByRole("textbox", { name: "줄 내용" });
    await userEvent.click(input);
    await userEvent.tab();
    await sleep(30);
    expect(bodies).toEqual([]);
    await userEvent.clear(input);
    await userEvent.type(input, "제품 개요 · 기능 유지");
    await userEvent.tab();
    await waitFor(() => expect(bodies).toEqual([{ content: "제품 개요 · 기능 유지" }]));
    expect(within(row(300)).getByRole("textbox", { name: "줄 내용" })).toHaveValue("제품 개요 · 기능 유지");
    // Esc — 되돌리고 저장 안 함
    await userEvent.type(input, " 더");
    await userEvent.keyboard("{Escape}");
    await sleep(30);
    expect(bodies).toHaveLength(1);
    expect(input).toHaveValue("제품 개요 · 기능 유지");
  });

  it("서버가 내려가 있으면(5xx) 토스트 「저장하지 못했습니다 · 줄 내용」 + 필드 실패 표시 + 값 유지 + 「다시 저장」 · **재요청 0** · 「다시 저장」이 한 번만", async () => {
    let calls = 0;
    harness(endedSucceeded());
    server.use(
      http.patch(`${API_BASE}/api/meetings/21/lines/300`, () => {
        calls += 1;
        return HttpResponse.json({ detail: "서버 오류", code: "internal_error" }, { status: 500 });
      }),
    );
    await enterEdit();
    const input = within(row(300)).getByRole("textbox", { name: "줄 내용" });
    await userEvent.clear(input);
    await userEvent.type(input, "실패할 문장");
    await userEvent.tab();
    expect(await screen.findByText("저장하지 못했습니다 · 줄 내용")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "다시 저장" })).toBeInTheDocument();
    await waitFor(() => expect(within(row(300)).getByRole("textbox", { name: "줄 내용" })).toHaveAttribute("aria-invalid", "true"));
    expect(within(row(300)).getByRole("textbox", { name: "줄 내용" })).toHaveValue("실패할 문장");
    await sleep(120);
    expect(calls).toBe(1);
    await userEvent.click(screen.getByRole("button", { name: "다시 저장" }));
    await waitFor(() => expect(calls).toBe(2));
  });

  it("빈 본문으로 벗어나면 저장하지 않고 되돌린다 + 「내용을 비울 수 없습니다」", async () => {
    let calls = 0;
    harness(endedSucceeded());
    server.use(http.patch(`${API_BASE}/api/meetings/21/lines/300`, () => {
      calls += 1;
      return HttpResponse.json(endedSucceeded());
    }));
    await enterEdit();
    const input = within(row(300)).getByRole("textbox", { name: "줄 내용" });
    await userEvent.clear(input);
    await userEvent.tab();
    expect(await screen.findByText("내용을 비울 수 없습니다")).toBeInTheDocument();
    expect(input).toHaveValue("제품 개요 · 기능은 유지, 도입 사례 분량이 과다");
    await sleep(30);
    expect(calls).toBe(0);
  });

  it("종류 셀렉터 → 「결정」 → `PATCH {kind:'decision'}` · 「업무」는 업무 없는 줄에서 비활성 + 캡션 · 업무 줄 → 「논의」 는 응답 뒤 배지가 사라진다(낙관적 아님)", async () => {
    const bodies: string[] = [];
    let release: () => void = () => undefined;
    const state = harness(endedSucceeded());
    server.use(
      http.patch(`${API_BASE}/api/meetings/21/lines/:lineId`, async ({ params, request }) => {
        const body = (await request.json()) as { kind: string };
        bodies.push(`${params.lineId}:${body.kind}`);
        if (params.lineId === "305") {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          state.detail = withLine(state.detail, 305, (current) => ({ ...current, kind: body.kind, taskId: null, task: null, pendingChange: null }));
        } else {
          state.detail = withLine(state.detail, 300, (current) => ({ ...current, kind: body.kind }));
        }
        return HttpResponse.json(state.detail);
      }),
    );
    await enterEdit();
    await userEvent.click(within(row(300)).getByRole("button", { name: "줄 종류" }));
    const task = await screen.findByRole("option", { name: /업무/ });
    expect(task).toBeDisabled();
    expect(screen.getByText("연관 업무는 「+ 연관 업무」로 추가합니다")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: /결정/ }));
    await waitFor(() => expect(bodies).toEqual(["300:decision"]));
    expect(within(row(300)).getByRole("button", { name: "줄 종류" })).toHaveTextContent("결정");

    // 업무 줄 → 「논의」 — 응답까지 배지 · 라벨이 그대로다
    expect(within(row(305)).getByText("문서·보고")).toBeInTheDocument();
    await userEvent.click(within(row(305)).getByRole("button", { name: "줄 종류" }));
    await userEvent.click(await screen.findByRole("option", { name: /논의/ }));
    await waitFor(() => expect(bodies).toEqual(["300:decision", "305:discussion"]));
    expect(within(row(305)).getByRole("button", { name: "줄 종류" })).toHaveTextContent("업무");
    expect(within(row(305)).getByText("문서·보고")).toBeInTheDocument();
    release();
    await waitFor(() => expect(within(row(305)).getByRole("button", { name: "줄 종류" })).toHaveTextContent("논의"));
    expect(within(row(305)).queryByText("문서·보고")).not.toBeInTheDocument();
  });

  it("안건 제목을 고치고 바깥 클릭 → `PATCH …/agendas/71 {title}`(`state` 없음) · 보기 모드에도 같은 이름 · 빈 이름은 되돌림 + 캡션", async () => {
    const bodies: unknown[] = [];
    const state = harness(endedSucceeded());
    server.use(
      http.patch(`${API_BASE}/api/meetings/21/agendas/71`, async ({ request }) => {
        const body = (await request.json()) as { title: string };
        bodies.push(body);
        state.detail = { ...state.detail, agendas: { ...state.detail.agendas, merged: state.detail.agendas.merged.map((a) => (a.id === 71 ? { ...a, title: body.title } : a)) } };
        return HttpResponse.json(state.detail);
      }),
    );
    await enterEdit();
    const input = screen.getByRole("textbox", { name: "안건 1 제목" });
    await userEvent.clear(input);
    await userEvent.type(input, "개정 대상 확정");
    await userEvent.tab();
    await waitFor(() => expect(bodies).toEqual([{ title: "개정 대상 확정" }]));
    await userEvent.clear(input);
    await userEvent.tab();
    expect(await screen.findByText("안건 이름을 비울 수 없습니다")).toBeInTheDocument();
    expect(input).toHaveValue("개정 대상 확정");
    await userEvent.click(screen.getByRole("button", { name: "편집 완료" }));
    expect(screen.getByText("개정 대상 확정")).toBeInTheDocument();
    expect(bodies).toHaveLength(1);
  });
});

describe("줄 삭제 — 확인 모달", () => {
  it("「제거」 → 모달 「이 줄을 삭제할까요?」 · 「취소」면 요청 0 · 「삭제」 → `DELETE` → 줄 사라짐 · 카운트 갱신 · AI 탭 원본 그대로", async () => {
    const calls: string[] = [];
    const state = harness(endedSucceeded());
    server.use(
      http.delete(`${API_BASE}/api/meetings/21/lines/320`, () => {
        calls.push("delete");
        state.detail = {
          ...endedSucceeded(),
          mergedSummary: { agendaCount: 4, decisionCount: 1, actionCount: 2, integratedAt: "2026-08-27T01:31:00Z" },
          agendas: { ...endedSucceeded().agendas, merged: MERGED.map((a) => (a.id === 74 ? { ...a, lines: [] } : a)) },
        };
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await enterEdit();
    await userEvent.click(within(row(320)).getByRole("button", { name: "줄 제거" }));
    expect(await screen.findByRole("dialog", { name: "이 줄을 삭제할까요?" })).toHaveTextContent("회의록에서 사라지고 되돌릴 수 없습니다. AI 요약과 스크립트는 그대로 남습니다.");
    expect(screen.queryByText(/연결된 업무는 삭제되지 않습니다/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    await sleep(30);
    expect(calls).toEqual([]);
    expect(row(320)).toBeInTheDocument();

    await userEvent.click(within(row(320)).getByRole("button", { name: "줄 제거" }));
    await userEvent.click(await screen.findByRole("button", { name: "삭제" }));
    await waitFor(() => expect(calls).toEqual(["delete"]));
    await waitFor(() => expect(document.querySelector('[data-line-id="320"]')).toBeNull());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // AI 탭 원본 줄 · 근거 칩 그대로
    await userEvent.click(screen.getByRole("tab", { name: "AI 요약" }));
    expect(screen.getByText("AI: 경쟁사 요금제를 비교했다")).toBeInTheDocument();
  });

  it("업무 줄 「제거」 → 경고 슬롯 「연결된 업무는 삭제되지 않습니다」 · 실패(5xx)면 모달은 닫히고 줄은 **그대로** + 「삭제하지 못했습니다」", async () => {
    let calls = 0;
    harness(endedSucceeded());
    server.use(
      http.delete(`${API_BASE}/api/meetings/21/lines/305`, () => {
        calls += 1;
        return HttpResponse.json({ detail: "서버 오류", code: "internal_error" }, { status: 500 });
      }),
    );
    await enterEdit();
    await userEvent.click(within(row(305)).getByRole("button", { name: "줄 제거" }));
    const dialog = await screen.findByRole("dialog", { name: "이 줄을 삭제할까요?" });
    expect(dialog).toHaveTextContent("연결된 업무는 삭제되지 않습니다. 반영하지 않은 변경(기한 · 상태 · 메모)은 함께 사라집니다.");
    await userEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(await screen.findByText("삭제하지 못했습니다")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(row(305)).toBeInTheDocument();
    expect(calls).toBe(1);
    // 낙관적으로 지우지 않았다 — 「다시 저장」 표시도 없다(다시 「제거」를 누른다)
    expect(screen.queryByRole("button", { name: "다시 저장" })).not.toBeInTheDocument();
  });
});

describe("U-8 논의 · 결정 추가 드로어", () => {
  it("「+ 결정」 → 드로어 「결정 추가」(근거 구간 · 「구간 추가」 · 「비워두면 …」 없음) → 「추가」 → `POST …/lines {agendaId, kind, content, detail}` → 안건 맨 아래", async () => {
    const bodies: unknown[] = [];
    const state = harness(endedSucceeded());
    server.use(
      http.post(`${API_BASE}/api/meetings/21/lines`, async ({ request }) => {
        const body = (await request.json()) as { agendaId: number; kind: "decision"; content: string; detail: string | null };
        bodies.push(body);
        const created = line({ id: 999, agendaId: body.agendaId, track: "merged", kind: body.kind, content: body.content, detail: body.detail, orderIndex: 9, createdAt: "2026-08-27T02:00:00Z" });
        state.detail = { ...state.detail, agendas: { ...state.detail.agendas, merged: state.detail.agendas.merged.map((a) => (a.id === 72 ? { ...a, lines: [...a.lines, created] } : a)) } };
        return HttpResponse.json(created, { status: 201 });
      }),
    );
    await enterEdit();
    await userEvent.click(within(agendaEl(72)).getByRole("button", { name: "결정" }));
    expect(await screen.findByRole("heading", { name: "결정 추가" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "결정" })).toBeChecked();
    expect(screen.getByRole("button", { name: "안건" })).toHaveTextContent("안건 2 · 디자인 반영 일정과 검수 방식");
    expect(screen.queryByText(/근거 구간/)).not.toBeInTheDocument();
    expect(screen.queryByText("구간 추가")).not.toBeInTheDocument();
    expect(screen.queryByText(/비워두면/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "추가" })).toBeDisabled();
    // 내용에 포커스가 잡혀 있다
    expect(screen.getByLabelText("내용")).toHaveFocus();
    await userEvent.type(screen.getByLabelText("내용"), "디자인 반영본 검수는 8월 29일 오전에 진행한다.");
    await userEvent.type(screen.getByLabelText("상세 설명"), "검수 일정 합의");
    // 세그먼트를 바꾸면 헤더도 따라간다
    await userEvent.click(screen.getByRole("radio", { name: "논의" }));
    expect(screen.getByRole("heading", { name: "논의 추가" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "결정" }));
    await userEvent.click(screen.getByRole("button", { name: "추가" }));
    await waitFor(() => expect(bodies).toEqual([{ agendaId: 72, kind: "decision", content: "디자인 반영본 검수는 8월 29일 오전에 진행한다.", detail: "검수 일정 합의" }]));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "결정 추가" })).not.toBeInTheDocument());
    const rows = within(agendaEl(72)).getAllByRole("textbox", { name: "줄 내용" });
    expect(rows.at(-1)).toHaveValue("디자인 반영본 검수는 8월 29일 오전에 진행한다.");
  });

  it("추가 실패 — 422 는 그 필드 인라인 · 5xx 는 드로어 유지 + 문구(「추가」가 다시 시도)", async () => {
    let calls = 0;
    harness(endedSucceeded());
    server.use(
      http.post(`${API_BASE}/api/meetings/21/lines`, () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ detail: "2000자까지 입력할 수 있습니다", code: "validation_error", field: "content" }, { status: 422 })
          : HttpResponse.json({ detail: "서버 오류", code: "internal_error" }, { status: 500 });
      }),
    );
    await enterEdit();
    await userEvent.click(within(agendaEl(71)).getByRole("button", { name: "논의" }));
    await userEvent.type(await screen.findByLabelText("내용"), "실패할 줄");
    await userEvent.click(screen.getByRole("button", { name: "추가" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("2000자까지 입력할 수 있습니다");
    expect(screen.getByLabelText("내용")).toHaveAttribute("aria-invalid", "true");
    await userEvent.click(screen.getByRole("button", { name: "추가" }));
    expect(await screen.findByText("추가하지 못했습니다 · 다시 시도해 주세요")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "논의 추가" })).toBeInTheDocument();
    expect(calls).toBe(2);
  });
});
