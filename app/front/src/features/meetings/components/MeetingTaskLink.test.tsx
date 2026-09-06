/**
 * **업무 연동 — 줄 버튼(U-6) · 연관 업무 드로어(U-9) · 업무 생성 드로어(U-10) — 앱 창 확인 항목의 테스트 판**(WP Phase 5 검증).
 *
 * - 업무 줄 「업무 갱신」(툴팁 = `pendingChange` 키 · **같은 상태 제외**) · 변경 없는 줄 「갱신 완료」 비활성 · 삭제된 업무 「삭제된 업무」 비활성 · 액션 줄 「업무 생성」
 * - 「업무 갱신」 한 번 = **요청 하나**(`PATCH …/lines/{id}/task`) — 업무 API(`/api/tasks/...`)로 나가는 요청 **0**(MSW 가 미등록 요청을 에러로 세운다)
 * - 게이트 거부(422) → 토스트 「완료하려면 …」 + 「결과 입력」 → 업무 상세 드로어 · 줄은 「업무 갱신」 그대로
 * - 통과(200) → 「갱신 완료」 + 「완료 처리했습니다 · 실행취소」 → 실행취소 = `POST /api/tasks/{id}/status/undo`(SPEC-004 그대로)
 * - 전이 거부(409) 토스트 · 5xx 토스트 + 버튼 복귀
 * - 액션 줄 「업무 생성」 → 드로어(제목 프리필 · 안건 고정 · **「시작 상태」 없음 · 토글 없음**) → `POST …/lines/{id}/task` → 줄이 업무 줄
 * - 「+ 연관 업무」 → 후보 목록(`GET /api/tasks/relations/candidates` — 회의 프로젝트 기본) · 검색 · 「연결하고 갱신」 = `POST …/lines` → 변경 있으면 `PATCH …/task`, 없으면 요청 하나
 * - 「+ 액션 아이템」 → `POST …/lines { newTask }`
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
/** 헤더를 통째로 그리는 드로어(`renderHeader`)는 프레임 타이틀이 없다 — 제목(heading)으로 확인한 뒤 dialog 를 잡는다. */
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

/** 통합본에 줄을 더한 상세 — 변경 없는 업무 줄(306) · 삭제된 업무 줄(307) · 같은 상태만 남은 줄(308). */
function seeded(overrides: Partial<MeetingDetail> = {}): MeetingDetail {
  const merged = MERGED.map((agenda) =>
    agenda.id === 72
      ? {
          ...agenda,
          lines: [
            ...agenda.lines,
            line({ id: 306, agendaId: 72, track: "merged", kind: "task", content: "변경 없는 업무", orderIndex: 1, taskId: 102, task: { ...TASK_SUMMARY, id: 102, title: "변경 없는 업무", status: "todo" } }),
            line({ id: 307, agendaId: 72, track: "merged", kind: "task", content: "지워진 업무", orderIndex: 2, taskId: 103, task: { ...TASK_SUMMARY, id: 103, title: "지워진 업무", isDeleted: true }, pendingChange: { note: "n" } }),
            line({ id: 308, agendaId: 72, track: "merged", kind: "task", content: "같은 상태 줄", orderIndex: 3, taskId: 104, task: { ...TASK_SUMMARY, id: 104, title: "같은 상태 줄", status: "in_progress" }, pendingChange: { status: "in_progress", note: "메모" } }),
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

describe("줄 버튼(U-6)", () => {
  it("업무 줄 「업무 갱신」(툴팁 · 같은 상태 제외) · 변경 없음 「갱신 완료」 비활성 · 삭제된 업무 「삭제된 업무」 비활성 · 액션 줄 「업무 생성」 · AI 탭에는 없다", async () => {
    harness(seeded());
    const apply = await within(await findRow(305)).findByRole("button", { name: "업무 갱신" });
    expect(apply).toBeEnabled();
    expect(apply).toHaveAttribute("title", "기한 → 09.02 · 상태 → 완료 · 메모 1건");
    expect(within(row(306)).getByRole("button", { name: "갱신 완료" })).toBeDisabled();
    expect(within(row(307)).getByRole("button", { name: "삭제된 업무" })).toBeDisabled();
    expect(within(row(307)).getByText("문서·보고")).toBeInTheDocument(); // 배지 · 제목 그대로
    // 같은 상태(진행중 → 진행중)는 툴팁에서 빠진다 — 메모만 남는다
    expect(within(row(308)).getByRole("button", { name: "업무 갱신" })).toHaveAttribute("title", "메모 1건");
    expect(within(row(310)).getByRole("button", { name: "업무 생성" })).toBeEnabled();
    // 논의 · 결정 줄에는 버튼이 없다
    expect(within(row(300)).queryByRole("button", { name: /업무/ })).toBeNull();

    await userEvent.click(screen.getByRole("tab", { name: "AI 요약" }));
    expect(screen.queryByRole("button", { name: /업무 생성|업무 갱신|갱신 완료/ })).not.toBeInTheDocument();
  });

  it("「업무 갱신」 = `PATCH …/lines/305/task` **요청 하나** · 게이트 거부(422) → 토스트 + 「결과 입력」 → 업무 상세 드로어 · 줄은 그대로", async () => {
    const state = harness(seeded());
    server.use(
      http.patch(`${API_BASE}/api/meetings/21/lines/305/task`, () =>
        HttpResponse.json({ detail: "완료하려면 결과자료 1건 또는 완료 결과가 필요합니다", code: "task_completion_blocked" }, { status: 422 }),
      ),
      http.get(`${API_BASE}/api/tasks/101`, () => HttpResponse.json({ detail: "x", code: "internal_error" }, { status: 500 })),
    );
    const apply = await within(await findRow(305)).findByRole("button", { name: "업무 갱신" });
    await userEvent.click(apply);

    expect(await screen.findByText("완료하려면 결과자료 1건 또는 완료 결과가 필요합니다")).toBeInTheDocument();
    expect(within(row(305)).getByRole("button", { name: "업무 갱신" })).toBeEnabled();
    expect(state.requests).toEqual(["PATCH /api/meetings/21/lines/305/task"]);

    await userEvent.click(screen.getByRole("button", { name: "결과 입력" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(await screen.findByText("업무를 불러오지 못했습니다")).toBeInTheDocument();
    // 「결과 입력」이 연 것은 **업무 상세 조회**뿐 — 상태 · 갱신 요청이 더 나가지 않았다
    expect(state.requests.filter((request) => !request.startsWith("GET /api/tasks/101"))).toEqual(["PATCH /api/meetings/21/lines/305/task"]);
  });

  it("통과(200) → 「갱신 완료」 + 「완료 처리했습니다 · 실행취소」 → 실행취소는 `POST /api/tasks/101/status/undo`", async () => {
    const state = harness(seeded());
    const applied = withLine(state.detail, 305, (current) => ({ ...current, pendingChange: null, task: { ...TASK_SUMMARY, status: "done", dueDate: "2026-09-02" } }));
    server.use(
      http.patch(`${API_BASE}/api/meetings/21/lines/305/task`, () => {
        state.detail = applied;
        return HttpResponse.json(applied);
      }),
      http.post(`${API_BASE}/api/tasks/101/status/undo`, () => HttpResponse.json({ id: 101, status: "in_progress" })),
    );
    await userEvent.click(await within(await findRow(305)).findByRole("button", { name: "업무 갱신" }));

    expect(await within(row(305)).findByRole("button", { name: "갱신 완료" })).toBeDisabled();
    expect(await screen.findByText("완료 처리했습니다")).toBeInTheDocument();
    expect(state.requests).toEqual(["PATCH /api/meetings/21/lines/305/task"]);

    await userEvent.click(screen.getByRole("button", { name: "실행취소" }));
    await waitFor(() => expect(state.requests).toContain("POST /api/tasks/101/status/undo"));
  });

  it("같은 상태만 남은 줄도 요청은 하나이고 완료 토스트가 없다 · 전이 거부(409) 토스트 · 5xx 토스트 + 버튼 복귀", async () => {
    const state = harness(seeded());
    const applied = withLine(state.detail, 308, (current) => ({ ...current, pendingChange: null }));
    let attempt = 0;
    server.use(
      http.patch(`${API_BASE}/api/meetings/21/lines/308/task`, () => {
        state.detail = applied;
        return HttpResponse.json(applied);
      }),
      http.patch(`${API_BASE}/api/meetings/21/lines/305/task`, () => {
        attempt += 1;
        return attempt === 1
          ? HttpResponse.json({ detail: "이 상태로는 바꿀 수 없습니다", code: "invalid_status_transition" }, { status: 409 })
          : HttpResponse.json({ detail: "boom", code: "internal_error" }, { status: 500 });
      }),
    );
    await userEvent.click(await within(await findRow(308)).findByRole("button", { name: "업무 갱신" }));
    expect(await within(row(308)).findByRole("button", { name: "갱신 완료" })).toBeDisabled();
    await sleep(30);
    expect(screen.queryByText("완료 처리했습니다")).not.toBeInTheDocument();

    await userEvent.click(within(row(305)).getByRole("button", { name: "업무 갱신" }));
    expect(await screen.findByText("이 상태로는 바꿀 수 없습니다")).toBeInTheDocument();
    await userEvent.click(within(row(305)).getByRole("button", { name: "업무 갱신" }));
    expect(await screen.findByText("업무를 갱신하지 못했습니다")).toBeInTheDocument();
    expect(within(row(305)).getByRole("button", { name: "업무 갱신" })).toBeEnabled();
    expect(state.requests).toEqual(["PATCH /api/meetings/21/lines/308/task", "PATCH /api/meetings/21/lines/305/task", "PATCH /api/meetings/21/lines/305/task"]);
  });
});

describe("업무 생성 드로어(U-10)", () => {
  it("액션 줄 「업무 생성」 → 제목 프리필 · 안건 고정 · 「시작 상태」 없음 · 토글 없음 → 유형 고르면 `POST …/lines/310/task` **하나** → 줄이 업무 줄", async () => {
    const state = harness(seeded());
    const bodies: unknown[] = [];
    const created = withLine(state.detail, 310, (current) => ({ ...current, kind: "task", taskId: 200, pendingChange: null, task: { ...TASK_SUMMARY, id: 200, title: "소개서 개정본 검수 일정 잡기", status: "todo", dueDate: null } }));
    server.use(
      http.post(`${API_BASE}/api/meetings/21/lines/310/task`, async ({ request }) => {
        bodies.push(await request.json());
        state.detail = created;
        return HttpResponse.json(created, { status: 201 });
      }),
    );
    await userEvent.click(await within(await findRow(310)).findByRole("button", { name: "업무 생성" }));

    const drawer = await findDrawer("업무 생성");
    expect(within(drawer).getByText("액션 아이템을 내 업무로 등록합니다")).toBeInTheDocument();
    expect(within(drawer).getByRole("textbox", { name: "업무 제목" })).toHaveValue("소개서 개정본 검수 일정 잡기");
    expect(within(drawer).getByRole("button", { name: "안건" })).toBeDisabled();
    expect(within(drawer).getByRole("button", { name: "안건" })).toHaveTextContent("안건 2 · 디자인 반영 일정과 검수 방식");
    expect(within(drawer).queryByText(/시작 상태/)).not.toBeInTheDocument();
    expect(within(drawer).queryByText(/연관 업무로 바꾸기/)).not.toBeInTheDocument();
    expect(within(drawer).queryByRole("switch")).not.toBeInTheDocument();
    expect(within(drawer).getByText("업무의 설명에 들어갑니다")).toBeInTheDocument();
    // 제출 조건 — 제목 1자 + 유형
    const submit = within(drawer).getByRole("button", { name: "업무 생성" });
    expect(submit).toBeDisabled();
    await userEvent.click(within(drawer).getByRole("button", { name: "유형" }));
    const options = await screen.findByRole("listbox", { name: "유형" });
    expect(within(options).queryByRole("option", { name: /미팅·회의/ })).toBeNull(); // 종류=업무만
    await userEvent.click(within(options).getByRole("option", { name: /문서·보고/ }));
    await userEvent.type(within(drawer).getByRole("textbox", { name: "메모" }), "9/12 오전");
    expect(submit).toBeEnabled();
    await userEvent.click(submit);

    await waitFor(() => expect(screen.queryByRole("heading", { name: "업무 생성" })).not.toBeInTheDocument());
    expect(bodies).toEqual([{ title: "소개서 개정본 검수 일정 잡기", workTypeId: 3, projectId: 5, dueDate: null, description: "9/12 오전" }]);
    expect(state.requests).toEqual(["POST /api/meetings/21/lines/310/task"]);
    expect(await within(row(310)).findByRole("button", { name: "갱신 완료" })).toBeDisabled();
    expect(within(row(310)).getByText("문서·보고")).toBeInTheDocument();
  });

  it("삭제된 유형(`invalid_work_type`) → 드로어 열린 채 유형 옆 인라인 · 줄 그대로", async () => {
    const state = harness(seeded());
    server.use(http.post(`${API_BASE}/api/meetings/21/lines/310/task`, () => HttpResponse.json({ detail: "사용할 수 없는 유형입니다", code: "invalid_work_type" }, { status: 422 })));
    await userEvent.click(await within(await findRow(310)).findByRole("button", { name: "업무 생성" }));
    const drawer = await findDrawer("업무 생성");
    await userEvent.click(within(drawer).getByRole("button", { name: "유형" }));
    await userEvent.click(within(await screen.findByRole("listbox", { name: "유형" })).getByRole("option", { name: /문서·보고/ }));
    await userEvent.click(await within(drawer).findByRole("button", { name: /업무 생성/ }));

    expect(await within(drawer).findByRole("alert")).toHaveTextContent("삭제됐거나 쓸 수 없는 유형입니다. 다시 골라 주세요");
    expect(screen.getByRole("heading", { name: "업무 생성" })).toBeInTheDocument();
    // 드로어(모달) 뒤의 줄은 aria-hidden 이다 — 줄 자체가 그대로(액션 줄 · 「업무 생성」)인지만 본다
    expect(within(row(310)).getByRole("button", { name: "업무 생성", hidden: true })).toBeEnabled();
    expect(row(310).getAttribute("data-line-kind")).toBe("action");
    expect(state.requests).toEqual(["POST /api/meetings/21/lines/310/task"]);
  });

  it("편집 모드 「+ 액션 아이템」 → 안건 셀렉터 기본값 = 그 안건 · `POST …/lines { newTask }` → 안건 맨 아래 업무 줄", async () => {
    const state = harness(seeded());
    const bodies: unknown[] = [];
    const added = line({ id: 330, agendaId: 73, track: "merged", kind: "task", content: "가격 표기 초안", orderIndex: 0, taskId: 201, task: { ...TASK_SUMMARY, id: 201, title: "가격 표기 초안", status: "todo", dueDate: null } });
    server.use(
      http.post(`${API_BASE}/api/meetings/21/lines`, async ({ request }) => {
        bodies.push(await request.json());
        state.detail = { ...state.detail, agendas: { ...state.detail.agendas, merged: state.detail.agendas.merged.map((agenda) => (agenda.id === 73 ? { ...agenda, lines: [added] } : agenda)) } };
        return HttpResponse.json(added, { status: 201 });
      }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "편집" }));
    await userEvent.click(within(agendaEl(73)).getByRole("button", { name: "액션 아이템" }));
    const drawer = await findDrawer("업무 생성");
    expect(within(drawer).getByRole("button", { name: "안건" })).toBeEnabled();
    expect(within(drawer).getByRole("button", { name: "안건" })).toHaveTextContent("안건 3 · 가격 표기 문구 처리 방향");
    expect(within(drawer).getByRole("textbox", { name: "업무 제목" })).toHaveValue("");
    await userEvent.type(within(drawer).getByRole("textbox", { name: "업무 제목" }), "가격 표기 초안");
    await userEvent.click(within(drawer).getByRole("button", { name: "유형" }));
    await userEvent.click(within(await screen.findByRole("listbox", { name: "유형" })).getByRole("option", { name: /문서·보고/ }));
    await userEvent.click(within(drawer).getByRole("button", { name: "업무 생성" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "업무 생성" })).not.toBeInTheDocument());
    expect(bodies).toEqual([{ agendaId: 73, kind: "task", newTask: { title: "가격 표기 초안", workTypeId: 3, projectId: 5, dueDate: null, description: null } }]);
    expect(state.requests).toEqual(["POST /api/meetings/21/lines"]);
    expect(await within(await findRow(330)).findByRole("button", { name: "갱신 완료" })).toBeDisabled();
  });
});

describe("연관 업무 드로어(U-9)", () => {
  it("「+ 연관 업무」 → 후보(회의 프로젝트 기본 · 검색) · 메모만 적고 「연결하고 갱신」 = `POST …/lines` → **곧바로** `PATCH …/task` · 상태 항목에 「취소」 없음", async () => {
    const state = harness(seeded());
    const bodies: unknown[] = [];
    const added = line({ id: 340, agendaId: 71, track: "merged", kind: "task", content: "요금제 비교표 정리", orderIndex: 3, taskId: 102, task: { ...TASK_SUMMARY, id: 102, title: "요금제 비교표 정리", status: "todo", dueDate: null }, pendingChange: { note: "회의에서 정리 요청" } });
    const applied = { ...added, pendingChange: null };
    server.use(
      http.get(`${API_BASE}/api/tasks/relations/candidates`, ({ request }) => {
        const keyword = new URL(request.url).searchParams.get("keyword");
        return HttpResponse.json(keyword ? { items: CANDIDATES.items.filter((item) => item.title.includes(keyword)), total: 1 } : CANDIDATES);
      }),
      http.post(`${API_BASE}/api/meetings/21/lines`, async ({ request }) => {
        bodies.push(await request.json());
        state.detail = { ...state.detail, agendas: { ...state.detail.agendas, merged: state.detail.agendas.merged.map((agenda) => (agenda.id === 71 ? { ...agenda, lines: [...agenda.lines, added] } : agenda)) } };
        return HttpResponse.json(added, { status: 201 });
      }),
      http.patch(`${API_BASE}/api/meetings/21/lines/340/task`, () => {
        state.detail = withLine(state.detail, 340, () => applied);
        return HttpResponse.json(state.detail);
      }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "편집" }));
    await userEvent.click(within(agendaEl(71)).getByRole("button", { name: "연관 업무" }));
    const drawer = await findDrawer("연관 업무 연결");
    expect(within(drawer).getByText("내 업무에서 고른 업무에 이 회의의 변경을 반영합니다")).toBeInTheDocument();
    expect(within(drawer).getByText("내 업무에서 불러옵니다")).toBeInTheDocument();
    // 프로젝트 기본값 = 회의의 프로젝트 · n건
    await waitFor(() => expect(within(drawer).getByRole("button", { name: "프로젝트" })).toHaveTextContent("소개서 개정 · 2건"));
    expect(state.requests[0]).toBe("GET /api/tasks/relations/candidates?projectId=5&scope=project");
    const list = within(drawer).getByRole("radiogroup", { name: "업무 목록" });
    expect(await within(list).findAllByRole("radio")).toHaveLength(2);
    expect(within(list).getByText("미정")).toBeInTheDocument();
    expect(within(list).getByText("진행중")).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "연결하고 갱신" })).toBeDisabled();

    // 검색 → 좁혀진다
    await userEvent.type(within(drawer).getByRole("textbox", { name: "업무 검색" }), "요금제");
    expect(await within(list).findAllByRole("radio")).toHaveLength(1);
    await userEvent.click(within(list).getByRole("radio", { name: /요금제 비교표 정리/ }));
    expect(within(drawer).getByText("현재 기한 없음")).toBeInTheDocument();
    expect(within(drawer).getByText("현재 시작전")).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "상태" })).toHaveTextContent("시작전 유지");
    // 상태 항목 — 그래프에서 갈 수 있는 것만 · 「취소」 없음
    await userEvent.click(within(drawer).getByRole("button", { name: "상태" }));
    const statuses = await screen.findByRole("listbox", { name: "상태" });
    expect(within(statuses).getAllByRole("option").map((option) => option.textContent)).toEqual(["시작전 유지", "진행중", "완료"]);
    await userEvent.click(within(statuses).getByRole("option", { name: "시작전 유지" }));

    await userEvent.type(within(drawer).getByRole("textbox", { name: "진행 메모로 남길 내용" }), "회의에서 정리 요청");
    await userEvent.click(within(drawer).getByRole("button", { name: "연결하고 갱신" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "연관 업무 연결" })).not.toBeInTheDocument());
    // 같은 상태 유지는 요청에 실리지 않는다 — `pendingChange` 는 메모뿐
    expect(bodies).toEqual([{ agendaId: 71, kind: "task", taskId: 102, pendingChange: { note: "회의에서 정리 요청" } }]);
    await waitFor(() => expect(state.requests.filter((request) => !request.startsWith("GET /api/tasks/relations/candidates"))).toEqual(["POST /api/meetings/21/lines", "PATCH /api/meetings/21/lines/340/task"]));
    expect(await within(await findRow(340)).findByRole("button", { name: "갱신 완료" })).toBeDisabled();
  });

  it("변경 없이 연결하면 `POST …/lines` **하나**(`pendingChange` 없음)이고 줄은 「갱신 완료」 · ②가 거부돼도 줄은 남는다(「업무 갱신」 활성 + 토스트)", async () => {
    const state = harness(seeded());
    const bodies: unknown[] = [];
    let nextId = 350;
    server.use(
      http.get(`${API_BASE}/api/tasks/relations/candidates`, () => HttpResponse.json(CANDIDATES)),
      http.post(`${API_BASE}/api/meetings/21/lines`, async ({ request }) => {
        const body = (await request.json()) as { taskId: number; pendingChange?: unknown };
        bodies.push(body);
        const id = nextId++;
        const added = line({ id, agendaId: 71, track: "merged", kind: "task", content: "제품 소개서 내용 업데이트", orderIndex: id, taskId: body.taskId, task: { ...TASK_SUMMARY, id: body.taskId, status: "in_progress" }, pendingChange: (body.pendingChange as MeetingLine["pendingChange"]) ?? null });
        state.detail = { ...state.detail, agendas: { ...state.detail.agendas, merged: state.detail.agendas.merged.map((agenda) => (agenda.id === 71 ? { ...agenda, lines: [...agenda.lines, added] } : agenda)) } };
        return HttpResponse.json(added, { status: 201 });
      }),
      http.patch(`${API_BASE}/api/meetings/21/lines/351/task`, () => HttpResponse.json({ detail: "완료하려면 결과자료 1건 또는 완료 결과가 필요합니다", code: "task_completion_blocked" }, { status: 422 })),
    );
    await userEvent.click(await screen.findByRole("button", { name: "편집" }));

    // ① 변경 없음
    await userEvent.click(within(agendaEl(71)).getByRole("button", { name: "연관 업무" }));
    let drawer = await findDrawer("연관 업무 연결");
    await userEvent.click(await within(drawer).findByRole("radio", { name: /제품 소개서 내용 업데이트/ }));
    await userEvent.click(within(drawer).getByRole("button", { name: "연결하고 갱신" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "연관 업무 연결" })).not.toBeInTheDocument());
    expect(bodies).toEqual([{ agendaId: 71, kind: "task", taskId: 101 }]);
    expect(await within(await findRow(350)).findByRole("button", { name: "갱신 완료" })).toBeDisabled();
    await sleep(30);
    expect(state.requests.filter((request) => /\/lines\/\d+\/task/.test(request))).toEqual([]);

    // ② 완료로 보내는데 결과가 없다 — 줄은 있고 「업무 갱신」 활성 + 거부 토스트
    await userEvent.click(within(agendaEl(71)).getByRole("button", { name: "연관 업무" }));
    drawer = await findDrawer("연관 업무 연결");
    await userEvent.click(await within(drawer).findByRole("radio", { name: /제품 소개서 내용 업데이트/ }));
    await userEvent.click(within(drawer).getByRole("button", { name: "상태" }));
    await userEvent.click(within(await screen.findByRole("listbox", { name: "상태" })).getByRole("option", { name: "완료" }));
    await userEvent.click(within(drawer).getByRole("button", { name: "연결하고 갱신" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "연관 업무 연결" })).not.toBeInTheDocument());
    expect(bodies[1]).toEqual({ agendaId: 71, kind: "task", taskId: 101, pendingChange: { status: "done" } });
    expect(await screen.findByText("완료하려면 결과자료 1건 또는 완료 결과가 필요합니다")).toBeInTheDocument();
    const applyButton = await within(await findRow(351)).findByRole("button", { name: "업무 갱신" });
    expect(applyButton).toBeEnabled();
    expect(applyButton).toHaveAttribute("title", "상태 → 완료");
    expect(state.requests.filter((request) => /\/lines\/\d+\/task/.test(request))).toEqual(["PATCH /api/meetings/21/lines/351/task"]);
  });
});
