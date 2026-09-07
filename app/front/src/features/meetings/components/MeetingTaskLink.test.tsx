/**
 * **payload 드로어 둘 — 줄 버튼(U-6) · 업무 payload(U-9) · 액션 payload(U-10)**(WORK-013 Phase 3 검증).
 *
 * - 줄 버튼 세 상태(「업무 생성」/「업무 갱신」/「갱신 완료」) · **`payload` 가 있으면 dot + 툴팁**(같은 상태는 툴팁에서 뺀다) · AI 탭에는 없다
 * - **드로어는 하나다**(MF-65) — AI 가 채운 줄과 사람이 「저장」한 줄이 **같은 드로어 · 같은 값 · 같은 화면**이고,
 *   갈래는 `payload` 가 차 있나뿐이다. **모드가 푸터를 가른다**(MF-66) — 편집 모드 「저장」 · 보기 모드 「넣기」
 * - 액션 payload(U-10): 안건 고정 + 일곱 필드 · 「시작 상태」·참고자료·연관·첨부 0건 · `workTypeId=null` 이면 **저장은 되고 넣기는 비활성**
 * - 업무 payload(U-9): 헤더 셀렉터가 업무를 물고 변경분이 채워진다 · **상태에 「완료」·「취소」 없음** · 빈 셀렉터면 본문 비활성
 * - 「저장」 = `PATCH …/lines/{id}`(**업무 API 요청 0**) · 「넣기」 = `POST …/lines/{id}/task` / `PATCH …/lines/{id}/task` 하나
 * - **인라인 자동 저장 0** — 포커스를 벗어나도 요청이 없다 · 어느 모드에서도 **푸터 버튼은 둘**
 */

import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { MeetingDetailPage } from "@/features/meetings/components/MeetingDetailPage";
import { endedSucceeded, line, MERGED, TASK_SUMMARY, TRANSCRIPT } from "@/features/meetings/closeFixtures";
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
const row = (id: number) => document.querySelector(`[data-line-id="${id}"]`) as HTMLElement;
const agendaEl = (id: number) => document.querySelector(`[data-agenda-id="${id}"]`) as HTMLElement;
/** 상세가 그려질 때까지 기다린 뒤 그 줄 — `waitFor` 는 throw 로만 재시도한다. */
const findRow = (id: number) =>
  waitFor(() => {
    const element = row(id);
    if (!element) {
      throw new Error(`line ${id} not rendered yet`);
    }
    return element;
  });
/** 헤더를 통째로 그리는 드로어(`renderHeader`)는 프레임 타이틀이 없다 — 제목(heading)으로 확인한 뒤 dialog 를 잡는다.
 *  U-9 는 제목 자리가 셀렉터라 **화면에 안 보이는 제목**이 그 자리를 대신한다. */
async function findDrawer(title: string): Promise<HTMLElement> {
  await screen.findByRole("heading", { name: title });
  return screen.getByRole("dialog");
}

const WORK_TYPES = { items: [{ id: 1, name: "미팅·회의", kind: "meeting", colorToken: "indigo", isDefault: true }, { id: 3, name: "문서·보고", kind: "task", colorToken: "steel", isDefault: true }] };
const PROJECTS = { items: [{ id: 5, name: "소개서 개정", colorToken: "violet" }, { id: 6, name: "온보딩", colorToken: "mint" }] };
const CANDIDATES = {
  items: [
    { id: 101, title: "제품 소개서 내용 업데이트", status: "in_progress", projectName: "소개서 개정", dueDate: "2026-08-29" },
    { id: 102, title: "요금제 비교표 정리", status: "todo", projectName: "소개서 개정", dueDate: null },
  ],
  total: 2,
};

/** 최종 회의록에 줄을 더한 상세 — 변경 없는 업무 줄(306) · 삭제된 업무 줄(307) · 같은 상태만 남은 줄(308). */
function seeded(overrides: Partial<MeetingDetail> = {}): MeetingDetail {
  const merged = MERGED.map((agenda) =>
    agenda.id === 72
      ? {
          ...agenda,
          lines: [
            ...agenda.lines,
            line({ id: 306, agendaId: 72, track: "merged", kind: "task", content: "변경 없는 업무", orderIndex: 1, taskId: 102, task: { ...TASK_SUMMARY, id: 102, title: "변경 없는 업무", status: "todo" } }),
            line({ id: 307, agendaId: 72, track: "merged", kind: "task", content: "지워진 업무", orderIndex: 2, taskId: 103, task: { ...TASK_SUMMARY, id: 103, title: "지워진 업무", isDeleted: true }, payload: { note: "n" } }),
            line({ id: 308, agendaId: 72, track: "merged", kind: "task", content: "같은 상태 줄", orderIndex: 3, taskId: 104, task: { ...TASK_SUMMARY, id: 104, title: "같은 상태 줄", status: "in_progress" }, payload: { status: "in_progress", note: "메모" } }),
            // **AI 가 채운 액션 줄** — 생성분 일곱이 그대로 저장돼 있다(사람이 「저장」한 줄과 같은 모양이다)
            line({
              id: 311, agendaId: 72, track: "merged", kind: "action", content: "요금제 비교표 만들기", orderIndex: 4,
              payload: {
                title: "요금제 비교표 만들기", workTypeId: 3, projectId: 5, startDate: "2026-09-01", dueDate: "2026-09-05",
                description: "경쟁사 3곳", todos: ["자료 모으기", "표 만들기"],
              },
            }),
          ],
        }
      : agenda,
  );
  return endedSucceeded({ agendas: { ...endedSucceeded().agendas, merged }, ...overrides });
}

function withLine(detail: MeetingDetail, lineId: number, update: (current: MeetingLine) => MeetingLine): MeetingDetail {
  return {
    ...detail,
    agendas: {
      ...detail.agendas,
      merged: detail.agendas.merged.map((agenda) => ({ ...agenda, lines: agenda.lines.map((current) => (current.id === lineId ? update(current) : current)) })),
    },
  };
}

interface Harness {
  detail: MeetingDetail;
  /** 나간 요청 전부 — `METHOD path` 순서대로. 업무 API 로 새는 요청이 있으면 MSW 가 에러로 세운다. */
  requests: string[];
}

function harness(detail: MeetingDetail): Harness {
  const state: Harness = { detail, requests: [] };
  server.use(
    http.get(`${API_BASE}/api/meetings/21`, () => HttpResponse.json(state.detail)),
    http.get(`${API_BASE}/api/meetings/21/transcript`, () => HttpResponse.json(TRANSCRIPT)),
    http.get(`${API_BASE}/api/work-types`, () => HttpResponse.json(WORK_TYPES)),
    http.get(`${API_BASE}/api/projects`, () => HttpResponse.json(PROJECTS)),
  );
  server.events.on("request:start", ({ request }) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/meetings/21/transcript") && url.pathname !== "/api/meetings/21" && !/\/api\/(work-types|projects)$/.test(url.pathname)) {
      state.requests.push(`${request.method} ${url.pathname}${url.search}`);
    }
  });
  renderWithProviders(<MeetingDetailPage />);
  return state;
}

beforeEach(() => {
  // sonner 의 토스트가 pointerdown 에서 `setPointerCapture` 를 부른다 — jsdom 에 없어 토스트 액션(「결과 입력」 · 「실행취소」) 클릭이 unhandled 로 샌다
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => undefined;
    HTMLElement.prototype.releasePointerCapture = () => undefined;
    HTMLElement.prototype.hasPointerCapture = () => false;
  }
  tokenStore.setAccess("A1");
  // sonner 는 토스트를 모듈 전역에 든다 — 앞 테스트의 「완료 처리했습니다」가 다음 Toaster 에 다시 떠서 「없다」 검사를 흐린다
  toast.dismiss();
});

afterEach(async () => {
  server.events.removeAllListeners();
  await tokenStore.clear();
});

describe("줄 버튼(U-6) — 세 상태 · dot · 툴팁", () => {
  it("업무 줄 「업무 갱신」(툴팁 · 같은 상태 제외 · dot) · 넣기 뒤 「갱신 완료」 비활성 · 삭제된 업무는 캡션 + 「업무 갱신」 · 액션 줄 「업무 생성」 · AI 탭에는 없다", async () => {
    harness(seeded());
    const apply = await within(await findRow(305)).findByRole("button", { name: "업무 갱신" });
    expect(apply).toBeEnabled();
    // `status` 가 업무의 현재 상태(진행중)와 같아 **툴팁에서 빠진다**(같은 상태로의 전이는 요청에도 안 실린다)
    expect(apply).toHaveAttribute("title", "기한 → 09.02 · 메모 1건");
    // **dot** — 「채워진 값이 있다」
    expect(apply.querySelector("[data-payload-dot]")).not.toBeNull();

    expect(within(row(306)).getByRole("button", { name: "갱신 완료" })).toBeDisabled();
    expect(within(row(306)).getByRole("button", { name: "갱신 완료" }).querySelector("[data-payload-dot]")).toBeNull();
    // 삭제된 업무 — 캡션은 뜨지만 **버튼은 「업무 갱신」 그대로**다(헤더 셀렉터에서 다른 업무로 바꾼다 — U-6)
    expect(within(row(307)).getByText("삭제된 업무")).toBeInTheDocument();
    expect(within(row(307)).getByRole("button", { name: "업무 갱신" })).toBeEnabled();
    // 같은 상태(진행중 → 진행중)는 툴팁에서 빠진다 — 메모만 남는다
    expect(within(row(308)).getByRole("button", { name: "업무 갱신" })).toHaveAttribute("title", "메모 1건");
    expect(within(row(310)).getByRole("button", { name: "업무 생성" })).toBeEnabled();
    expect(within(row(311)).getByRole("button", { name: "업무 생성" }).querySelector("[data-payload-dot]")).not.toBeNull();
    // 논의 · 결정 줄에는 버튼이 없다
    expect(within(row(300)).queryByRole("button", { name: /업무/ })).toBeNull();

    await userEvent.click(screen.getByRole("tab", { name: "AI 요약" }));
    expect(screen.queryByRole("button", { name: /업무 생성|업무 갱신|갱신 완료/ })).not.toBeInTheDocument();
  });
});

describe("액션 payload 드로어(U-10)", () => {
  it("**AI 액션 줄** 「업무 생성」(보기 모드) → 안건 고정 + 일곱이 「회의에서 반영」으로 채워짐 · 필드가 그 일곱뿐 · 푸터 「취소 · 넣기」 → `POST …/lines/311/task` 하나", async () => {
    const state = harness(seeded());
    server.use(
      http.post(`${API_BASE}/api/meetings/21/lines/311/task`, async ({ request }) => {
        state.requests.push(`BODY ${JSON.stringify(await request.json())}`);
        state.detail = withLine(state.detail, 311, (current) => ({ ...current, kind: "task", taskId: 200, payload: null, task: { ...TASK_SUMMARY, id: 200, title: "요금제 비교표 만들기" } }));
        return HttpResponse.json(state.detail, { status: 201 });
      }),
    );
    await userEvent.click(await within(await findRow(311)).findByRole("button", { name: "업무 생성" }));
    const drawer = await findDrawer("액션 아이템");

    // ① 안건 고정 · ②~⑦ 채워진 값
    expect(drawer.querySelector("[data-agenda-fixed]")).toHaveTextContent("안건 2 · 디자인 반영 일정과 검수 방식");
    expect(within(drawer).getByLabelText("제목")).toHaveValue("요금제 비교표 만들기");
    expect(within(drawer).getByRole("button", { name: "유형" })).toHaveTextContent("문서·보고");
    expect(within(drawer).getByRole("button", { name: "프로젝트" })).toHaveTextContent("소개서 개정");
    expect(within(drawer).getByLabelText("계획 시작")).toHaveTextContent("09.01");
    expect(within(drawer).getByLabelText("계획 종료")).toHaveTextContent("09.05");
    expect(within(drawer).getByLabelText("설명")).toHaveValue("경쟁사 3곳");
    expect(within(drawer).getByText("자료 모으기")).toBeInTheDocument();
    expect(within(drawer).getByText("표 만들기")).toBeInTheDocument();
    // 「회의에서 반영」 표시가 채워진 칸에 붙는다
    expect(within(drawer).getAllByText("회의에서 반영").length).toBeGreaterThanOrEqual(6);
    // **없는 것** — 「시작 상태」 · 참고자료 · 연관 업무 · 첨부 · 로그
    expect(within(drawer).queryByText(/시작 상태|참고자료|결과자료|연관 업무|첨부|로그/)).toBeNull();

    // 푸터는 **둘**(취소 + 넣기)
    const footer = within(drawer).getByRole("button", { name: "넣기" }).parentElement as HTMLElement;
    expect(within(footer).getAllByRole("button")).toHaveLength(2);
    expect(within(drawer).queryByRole("button", { name: "저장" })).toBeNull();

    await userEvent.click(within(drawer).getByRole("button", { name: "넣기" }));
    await waitFor(() => expect(within(row(311)).getByRole("button", { name: "갱신 완료" })).toBeInTheDocument());
    expect(state.requests.filter((request) => !request.startsWith("BODY"))).toEqual(["POST /api/meetings/21/lines/311/task"]);
    expect(state.requests.find((request) => request.startsWith("BODY"))).toBe(
      `BODY ${JSON.stringify({ title: "요금제 비교표 만들기", workTypeId: 3, projectId: 5, startDate: "2026-09-01", dueDate: "2026-09-05", description: "경쟁사 3곳", todos: ["자료 모으기", "표 만들기"] })}`,
    );
  });

  it("**사람이 적은 액션 줄**을 편집 모드에서 열면 같은 드로어에 제목 · 프로젝트만 채워진다 · 「저장」 = `PATCH …/lines/310` 하나(**업무 요청 0**) · 보기 모드에서 다시 열면 값 그대로 + 「넣기」", async () => {
    const state = harness(seeded());
    server.use(
      http.patch(`${API_BASE}/api/meetings/21/lines/310`, async ({ request }) => {
        const body = (await request.json()) as { payload: Record<string, unknown> };
        state.requests.push(`BODY ${JSON.stringify(body)}`);
        state.detail = withLine(state.detail, 310, (current) => ({ ...current, payload: body.payload as never }));
        return HttpResponse.json(state.detail);
      }),
    );
    await findRow(310);
    await userEvent.click(screen.getByRole("button", { name: "편집" }));
    await userEvent.click(within(row(310)).getByRole("button", { name: "업무 생성" }));

    let drawer = await findDrawer("액션 아이템");
    // 프리필이 없다 — 제목 = 줄 본문 · 프로젝트 = 회의의 프로젝트(MF-61). 「회의에서 반영」 표시가 하나도 없다
    expect(within(drawer).getByLabelText("제목")).toHaveValue("소개서 개정본 검수 일정 잡기");
    expect(within(drawer).getByRole("button", { name: "프로젝트" })).toHaveTextContent("소개서 개정");
    expect(within(drawer).getByRole("button", { name: "유형" })).toHaveTextContent("유형");
    expect(within(drawer).queryByText("회의에서 반영")).toBeNull();
    // 편집 모드라 푸터는 「취소 · 저장」이고 **유형이 비어도 저장은 된다**
    expect(within(drawer).queryByRole("button", { name: "넣기" })).toBeNull();
    const save = within(drawer).getByRole("button", { name: "저장" });
    expect(save).toBeEnabled();

    await userEvent.click(save);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // **업무 API 로 나간 요청 0** — 줄에 `payload` 만 붙었다
    expect(state.requests.filter((request) => !request.startsWith("BODY"))).toEqual(["PATCH /api/meetings/21/lines/310"]);
    expect(state.requests.find((request) => request.startsWith("BODY"))).toContain('"title":"소개서 개정본 검수 일정 잡기"');
    // dot 이 켜진다 — 이 시점에 AI 가 채운 줄과 완전히 같은 상태다
    await waitFor(() => expect(within(row(310)).getByRole("button", { name: "업무 생성" }).querySelector("[data-payload-dot]")).not.toBeNull());

    // 보기 모드로 돌아와 다시 열면 **값 그대로 + 「넣기」**
    await userEvent.click(screen.getByRole("button", { name: "편집 완료" }));
    await userEvent.click(within(row(310)).getByRole("button", { name: "업무 생성" }));
    drawer = await findDrawer("액션 아이템");
    expect(within(drawer).getByLabelText("제목")).toHaveValue("소개서 개정본 검수 일정 잡기");
    expect(within(drawer).getAllByText("회의에서 반영").length).toBeGreaterThan(0);
    // **유형이 비어 있으면 「넣기」는 비활성**(저장은 됐다)
    expect(within(drawer).getByRole("button", { name: "넣기" })).toBeDisabled();
  });

  it("**인라인 자동 저장이 없다** — 값을 고치고 포커스를 벗어나도 요청 0 · 「취소」로 닫으면 아무것도 저장되지 않는다", async () => {
    const state = harness(seeded());
    await userEvent.click(await within(await findRow(311)).findByRole("button", { name: "업무 생성" }));
    const drawer = await findDrawer("액션 아이템");

    const title = within(drawer).getByLabelText("제목");
    await userEvent.clear(title);
    await userEvent.type(title, "고친 제목");
    await userEvent.tab();
    await sleep(60);
    expect(state.requests).toEqual([]);

    await userEvent.click(within(drawer).getByRole("button", { name: "취소" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(state.requests).toEqual([]);
  });
});

describe("업무 payload 드로어(U-9)", () => {
  it("**AI 업무 줄** 「업무 갱신」 → 헤더 셀렉터가 그 업무를 물고 변경분이 채워진다 · **상태에 「완료」가 없다** · 필드가 변경분 일곱뿐", async () => {
    harness(seeded());
    await userEvent.click(await within(await findRow(305)).findByRole("button", { name: "업무 갱신" }));
    const drawer = await findDrawer("연관 업무");

    // 헤더 제목 자리가 셀렉터다 — 줄의 `taskId` 가 가리키는 업무를 물고 있다
    expect(screen.getByRole("button", { name: "업무 고르기" })).toHaveTextContent("제품 소개서 내용 업데이트");
    expect(within(drawer).getByLabelText("기한")).toHaveTextContent("09.02");
    expect(within(drawer).getByRole("button", { name: "상태" })).toHaveTextContent("진행중");
    expect(within(drawer).getByLabelText("진행 메모")).toHaveValue("검수 일정 변경");
    // 줄에서 열었으므로 내용은 읽기 전용
    expect(within(drawer).queryByRole("textbox", { name: "내용" })).toBeNull();

    // 상태 셀렉터 — **「완료」·「취소」가 없다**(MF-59)
    await userEvent.click(within(drawer).getByRole("button", { name: "상태" }));
    const options = within(await screen.findByRole("listbox", { name: "상태" })).getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["진행중 유지", "시작전", "진행중"]);
    expect(options.join()).not.toMatch(/완료|취소/);
    await userEvent.keyboard("{Escape}");

    // **제목 · 유형 · 설명 · 시작일이 없다**(회의록에서 못 바꾼다 — MF-14)
    expect(within(drawer).queryByLabelText("제목")).toBeNull();
    expect(within(drawer).queryByRole("button", { name: "유형" })).toBeNull();
    expect(within(drawer).queryByLabelText("설명")).toBeNull();
    expect(within(drawer).queryByLabelText("계획 시작")).toBeNull();
    expect(within(drawer).queryByText(/참고자료|결과자료|첨부|로그/)).toBeNull();
  });

  it("**사람이 적은 업무 줄**은 셀렉터가 빈 채로 열리고 본문이 비활성이다 — 「업무 연결」 같은 앞 단계가 없다", async () => {
    const state = harness(seeded());
    state.detail = withLine(state.detail, 306, (current) => ({ ...current, taskId: null, task: null }));
    // 줄 목록을 다시 읽게 한다
    harness(state.detail);
    await userEvent.click(await within(await findRow(306)).findByRole("button", { name: "업무 갱신" }));
    const drawer = await findDrawer("연관 업무");

    expect(screen.getByRole("button", { name: "업무 고르기" })).toHaveTextContent("업무 고르기");
    // 캡션이 블록 머리와 각 칸에 붙는다 — 업무를 고르기 전에는 「현재 값」이 없다
    expect(within(drawer).getAllByText("업무를 고르면 현재 값이 보입니다").length).toBeGreaterThan(0);
    expect(within(drawer).getByLabelText("진행 메모")).toBeDisabled();
    expect(within(drawer).getByRole("button", { name: "상태" })).toBeDisabled();
    expect(within(drawer).queryByRole("button", { name: /연결하고 갱신|업무 연결/ })).toBeNull();
  });

  it("「넣기」 → `PATCH …/lines/305/task { taskId, …채워진 키만 }` **하나** → 「갱신 완료」 · 게이트 거부(422)면 줄이 그대로이고 「결과 입력」이 뜬다", async () => {
    const state = harness(seeded());
    let attempt = 0;
    server.use(
      http.patch(`${API_BASE}/api/meetings/21/lines/305/task`, async ({ request }) => {
        state.requests.push(`BODY ${JSON.stringify(await request.json())}`);
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json({ detail: "완료하려면 결과자료 1건 또는 완료 결과가 필요합니다", code: "task_completion_blocked" }, { status: 422 });
        }
        state.detail = withLine(state.detail, 305, (current) => ({ ...current, payload: null }));
        return HttpResponse.json(state.detail);
      }),
      http.get(`${API_BASE}/api/tasks/101`, () => HttpResponse.json({ detail: "x", code: "internal_error" }, { status: 500 })),
    );
    await userEvent.click(await within(await findRow(305)).findByRole("button", { name: "업무 갱신" }));
    let drawer = await findDrawer("연관 업무");
    await userEvent.click(within(drawer).getByRole("button", { name: "넣기" }));

    // 거부 — **드로어는 열린 채**이고 줄도 그대로다(전부 롤백)
    expect(await screen.findByText("완료하려면 결과자료 1건 또는 완료 결과가 필요합니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "넣기" })).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole("button", { name: "취소" }));
    expect(within(row(305)).getByRole("button", { name: "업무 갱신" })).toBeEnabled();

    // 다시 — 이번에는 통과. **요청은 하나**이고 본문은 `taskId` + 채워진 키만이다
    await userEvent.click(within(row(305)).getByRole("button", { name: "업무 갱신" }));
    drawer = await findDrawer("연관 업무");
    await userEvent.click(within(drawer).getByRole("button", { name: "넣기" }));
    await waitFor(() => expect(within(row(305)).getByRole("button", { name: "갱신 완료" })).toBeDisabled());

    const bodies = state.requests.filter((request) => request.startsWith("BODY"));
    expect(bodies).toHaveLength(2);
    // `status` 는 업무의 현재 상태(진행중)와 같아 **실리지 않는다** · `null` 키도 없다
    expect(JSON.parse(bodies[1].slice(5))).toEqual({ taskId: 101, dueDate: "2026-09-02", note: "검수 일정 변경" });
    expect(state.requests.filter((request) => !request.startsWith("BODY") && !request.startsWith("GET /api/tasks/101"))).toEqual([
      "PATCH /api/meetings/21/lines/305/task",
      "PATCH /api/meetings/21/lines/305/task",
    ]);
  });
});
