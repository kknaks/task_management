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
  it("「편집」 → 본문 입력 상자 · **종류 셀렉터 없음** · 「제거」 · 「+」 칩 4 · 안건 제목 입력 · 「되돌리기」 없음 · 안건 추가/삭제 없음 · 「편집 완료」 는 요청 없이 보기 모드", async () => {
    const state = harness(endedSucceeded());
    await enterEdit();
    expect(screen.getByText("변경은 자동 저장됩니다")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "되돌리기" })).not.toBeInTheDocument();
    expect(screen.queryByText("되돌리기")).not.toBeInTheDocument();
    // 최종 회의록 줄 5개가 전부 **본문만** 입력 상자 + 「제거」 — **라벨 자리에 종류 셀렉터가 없다**(MF-60)
    expect(screen.getAllByRole("textbox", { name: "줄 내용" })).toHaveLength(5);
    expect(screen.queryByRole("button", { name: "줄 종류" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "줄 제거" })).toHaveLength(5);
    // 라벨은 그대로 라벨이다
    expect(within(row(300)).getByText("논의")).toBeInTheDocument();
    // 안건 제목 입력 상자(결정 ②) — 4개 · 「안건 n」 라벨 · 배지는 그대로
    expect(screen.getAllByRole("textbox", { name: /안건 \d 제목/ })).toHaveLength(4);
    expect(screen.getByText("다음 논의로")).toBeInTheDocument();
    expect(screen.getByText("AI 안건")).toBeInTheDocument();
    // 안건 추가 · 삭제 · 상태 변경 어포던스 없음
    expect(screen.queryByRole("button", { name: /안건 \d 제거/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /안건 \d 완료/ })).not.toBeInTheDocument();
    expect(screen.queryByText("새 안건")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "줄 입력" })).not.toBeInTheDocument();
    // 「+」 칩 4 — 논의 · 결정 · 연관 업무(U-9) · 액션 아이템(U-10) 전부 산다(드로어 둘은 `MeetingTaskLink.test`)
    const footer = within(agendaEl(71));
    expect(footer.getByRole("button", { name: "논의" })).toBeEnabled();
    expect(footer.getByRole("button", { name: "결정" })).toBeEnabled();
    expect(footer.getByRole("button", { name: "연관 업무" })).toBeEnabled();
    expect(footer.getByRole("button", { name: "액션 아이템" })).toBeEnabled();

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

  it("**줄 종류를 바꾸는 표면이 없다**(MF-60) — 본문을 고쳐도 `PATCH` 본문에 `kind` 가 실리지 않는다", async () => {
    const bodies: unknown[] = [];
    const state = harness(endedSucceeded());
    server.use(
      http.patch(`${API_BASE}/api/meetings/21/lines/:lineId`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(state.detail);
      }),
    );
    await enterEdit();
    // 라벨을 눌러도 아무 일이 없다 — 셀렉터가 아니다
    await userEvent.click(within(row(300)).getByText("논의"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    const input = within(row(300)).getByRole("textbox", { name: "줄 내용" });
    await userEvent.clear(input);
    await userEvent.type(input, "고친 본문");
    await userEvent.click(document.body);
    await waitFor(() => expect(bodies).toEqual([{ content: "고친 본문" }]));
    expect(JSON.stringify(bodies)).not.toContain("kind");
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
          mergedSummary: { agendaCount: 4, discussionCount: 2, decisionCount: 1, actionCount: 1, taskCount: 1 },
          agendas: { ...endedSucceeded().agendas, merged: MERGED.map((a) => (a.id === 74 ? { ...a, lines: [] } : a)) },
        };
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await enterEdit();
    await userEvent.click(within(row(320)).getByRole("button", { name: "줄 제거" }));
    const modal = await screen.findByRole("dialog", { name: "이 줄을 삭제할까요?" });
    // **한 문장**이다 — 안 지워지는 것(AI 요약 · 스크립트 · 연결된 업무)을 적지 않는다(MF-63)
    expect(modal).toHaveTextContent("되돌릴 수 없습니다.");
    expect(modal.textContent).not.toMatch(/AI 요약|스크립트|연결된 업무/);
    expect(modal).toHaveAttribute("data-modal-size", "light");
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

  it("**업무 줄이어도 같은 420 모달 · 경고 슬롯 없음** · 실패(5xx)면 모달은 닫히고 줄은 **그대로** + 「삭제하지 못했습니다」", async () => {
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
    // 업무 줄이어도 **갈래를 만들지 않는다** — 같은 한 문장이다(U-7)
    expect(dialog).toHaveTextContent("되돌릴 수 없습니다.");
    expect(dialog.textContent).not.toMatch(/연결된 업무/);
    expect(dialog).toHaveAttribute("data-modal-size", "light");
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

describe("추가 칩 둘 갈래(U-7 · MF-64 정정)", () => {
  /** 유형 · 프로젝트가 있어야 payload 드로어의 셀렉터가 값을 그린다. */
  function chipHarness(detail: MeetingDetail) {
    const state = { detail, requests: [] as string[], bodies: [] as unknown[] };
    server.use(
      http.get(`${API_BASE}/api/meetings/21`, () => HttpResponse.json(state.detail)),
      http.get(`${API_BASE}/api/meetings/21/transcript`, () => HttpResponse.json(TRANSCRIPT)),
      http.get(`${API_BASE}/api/work-types`, () =>
        HttpResponse.json({ items: [{ id: 3, name: "문서·보고", kind: "task", colorToken: "steel", isDefault: true, description: null }] }),
      ),
      http.get(`${API_BASE}/api/projects`, () => HttpResponse.json({ items: [{ id: 5, name: "소개서 개정", colorToken: "violet" }] })),
      http.post(`${API_BASE}/api/meetings/21/lines`, async ({ request }) => {
        state.bodies.push(await request.json());
        return HttpResponse.json(line({ id: 900, agendaId: 71, track: "merged", kind: "action", content: "새 액션" }), { status: 201 });
      }),
    );
    server.events.on("request:start", ({ request }) => {
      const url = new URL(request.url);
      if (/^\/api\/(tasks|meetings\/21\/lines\/)/.test(url.pathname)) {
        state.requests.push(`${request.method} ${url.pathname}`);
      }
    });
    renderWithProviders(<MeetingDetailPage />);
    return state;
  }

  afterEach(() => server.events.removeAllListeners());

  it("「+ 액션 아이템」 → **줄 추가 드로어를 거치지 않고** 액션 payload 드로어가 바로 뜬다 · 「저장」 = `POST …/lines` **하나** · 업무 요청 0", async () => {
    const state = chipHarness(endedSucceeded());
    await enterEdit();
    await userEvent.click(within(agendaEl(71)).getByRole("button", { name: "액션 아이템" }));

    // **드로어가 연달아 둘 뜨지 않는다** — 「논의/결정 추가」를 거치지 않는다
    await screen.findByRole("heading", { name: "액션 아이템" });
    expect(screen.queryByRole("heading", { name: /논의 추가|결정 추가/ })).not.toBeInTheDocument();
    const drawer = screen.getByRole("dialog");
    expect(drawer.querySelector("[data-agenda-fixed]")).toHaveTextContent("안건 1 · 개정 대상 섹션 확정");
    // 편집 모드라 푸터는 「취소 · 저장」 **둘**이다
    expect(within(drawer).queryByRole("button", { name: "넣기" })).toBeNull();

    await userEvent.type(within(drawer).getByLabelText("제목"), "분리 초안 만들기");
    await userEvent.click(within(drawer).getByRole("button", { name: "저장" }));

    await waitFor(() => expect(state.bodies).toHaveLength(1));
    expect(state.bodies[0]).toEqual({
      agendaId: 71,
      kind: "action",
      content: "분리 초안 만들기",
      payload: { title: "분리 초안 만들기", workTypeId: null, projectId: 5, startDate: null, dueDate: null, description: null, todos: [] },
    });
    // **업무는 생기지 않는다** — 「넣기」는 보기 모드의 것이다
    expect(state.requests.filter((request) => request.startsWith("POST /api/tasks"))).toEqual([]);
  });

  it("「+ 연관 업무」도 payload 드로어가 바로 뜬다 · **「취소」로 닫으면 줄이 생기지 않는다**", async () => {
    const state = chipHarness(endedSucceeded());
    await enterEdit();
    await userEvent.click(within(agendaEl(71)).getByRole("button", { name: "연관 업무" }));

    await screen.findByRole("heading", { name: "연관 업무" });
    const drawer = screen.getByRole("dialog");
    // 업무를 아직 안 골랐으니 본문이 비활성이고, 내용 칸만 입력이다(칩 진입)
    expect(within(drawer).getByRole("textbox", { name: "내용" })).toBeEnabled();
    expect(within(drawer).getByRole("button", { name: "상태" })).toBeDisabled();

    await userEvent.click(within(drawer).getByRole("button", { name: "취소" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(state.bodies).toEqual([]);
  });

  it("회의 삭제 모달은 **600 그대로**다(`heavy`) — 줄 삭제만 420 이다", async () => {
    chipHarness(endedSucceeded());
    await userEvent.click(await screen.findByRole("button", { name: "삭제" }));
    const modal = await screen.findByRole("dialog");
    expect(modal).toHaveAttribute("data-modal-size", "heavy");
  });
});

