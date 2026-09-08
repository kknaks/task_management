/**
 * **새 회의록 드로어 — 앱 창 확인 항목의 테스트 판**(WORK-006 Phase 5).
 *
 * - 열리면 **제목에 커서**, 유형에 「미팅·회의」(종류=미팅만 · `isDefault`), 일시에 **다음 30분 경계부터 1시간**
 * - 유형 셀렉터에 **업무 유형이 없다** · 「반복·개인」 칩이 없다
 * - 생성이 **요청 하나**(`POST /api/meetings`)로 나가고 안건·링크 첨부가 본문에 실려 있다(네트워크 캡처의 테스트 판)
 * - `409 schedule_overlap` → 토스트 + 일시 실패 테두리, **드로어가 닫히지 않고 입력이 남는다**
 * - 301분이면 만들어지지 않고 일시 칸에 안내
 * - 첨부 영역에 파일을 드롭하면 「v2에서 제공됩니다」 토스트만, **요청 0건**
 * - 「만들면 바로 회의 시작」 토글 · 상태 필드 · 연관 업무 칸이 **없다**
 * - 「URL 링크」 두 건을 연달아 붙일 수 있다 · 「자료함 문서」는 스텁 안내
 */

import { useEffect } from "react";
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { openMeetingCreateDrawer } from "@/features/meetings/openMeetingDrawers";
import { meetingDetail, renderWithProviders } from "@/features/meetings/testUtils";
import type { MeetingDetail } from "@/features/meetings/types";
import { tokenStore } from "@/lib/auth/tokenStore";
import { useOverlay } from "@/lib/overlay/OverlayProvider";
import { API_BASE, server } from "@/test/server";

/** 부모가 하는 일 그대로 — `openDrawer` 로 연다. 드로어는 실제 `DrawerFrame` 위에 그려진다. */
function Opener({
  onCreated,
  initial,
}: {
  onCreated: (meeting: MeetingDetail) => void;
  initial?: { startAt?: string; endAt?: string };
}) {
  const overlay = useOverlay();
  useEffect(() => {
    openMeetingCreateDrawer(overlay, { onCreated, ...initial });
    // 한 번만 연다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  window.dispatchEvent(new Event("resize"));
}

const WORK_TYPES = {
  items: [
    { id: 1, kind: "meeting", name: "미팅·회의", colorToken: "indigo", isDefault: true },
    { id: 3, kind: "task", name: "문서·보고", colorToken: "steel", isDefault: true },
    { id: 7, kind: "meeting", name: "외부 미팅", colorToken: "mint", isDefault: false },
  ],
};
const PROJECTS = { items: [{ id: 5, name: "소개서 개정", colorToken: "violet" }] };

function serveLists() {
  server.use(
    http.get(`${API_BASE}/api/work-types`, () => HttpResponse.json(WORK_TYPES)),
    http.get(`${API_BASE}/api/projects`, () => HttpResponse.json(PROJECTS)),
  );
}

function setup(initial?: { startAt?: string; endAt?: string }) {
  serveLists();
  const onCreated = vi.fn();
  const result = renderWithProviders(<Opener onCreated={onCreated} initial={initial} />);
  return { ...result, onCreated };
}

/** 첨부 팝오버 안의 「추가」 — 안건 「추가」와 이름이 같아 팝오버(dialog) 안으로 좁힌다. */
const popoverAddButton = () => within(screen.getAllByRole("dialog").at(-1) as HTMLElement).getByRole("button", { name: "추가" });

beforeEach(() => {
  tokenStore.setAccess("A1");
  setViewport(1600);
  // 2026-09-06 09:12 KST — 기본값이 09:30 – 10:30 이어야 한다.
  vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-09-06T00:12:00Z") });
});

afterEach(async () => {
  vi.useRealTimers();
  await tokenStore.clear();
});

describe("열림 상태 · 기본값", () => {
  it("제목에 포커스, 유형 「미팅·회의」, 일시 오늘 09:30 – 10:30 이 미리 들어 있다", async () => {
    setup();
    expect(await screen.findByRole("textbox", { name: "회의 제목" })).toHaveFocus();
    expect(screen.getByRole("heading", { name: "새 회의록" })).toBeInTheDocument();
    expect(screen.getByText("안건을 미리 적어두면 회의 중 화면이 안건별로 열립니다")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "유형" })).toHaveTextContent("미팅·회의"));
    expect(screen.getByRole("button", { name: "날짜" })).toHaveTextContent("2026.09.06 (일)");
    expect(screen.getByRole("button", { name: "시작 시각" })).toHaveTextContent("09:30");
    expect(screen.getByRole("button", { name: "종료 시각" })).toHaveTextContent("10:30");
    // 제목이 없으면 「만들기」 비활성.
    expect(screen.getByRole("button", { name: "만들기" })).toBeDisabled();
  });

  it("시간 목록이 **고른 시각 자리에서** 열린다 — 11:00 인데 00:00 부터 보이지 않는다(실물 버그)", async () => {
    // jsdom 에는 `scrollIntoView` 가 없다 — 불렸는지만 본다
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    setup({ startAt: "2026-09-06T02:00:00Z", endAt: "2026-09-06T03:00:00Z" });
    await screen.findByRole("textbox", { name: "회의 제목" });
    expect(screen.getByRole("button", { name: "시작 시각" })).toHaveTextContent("11:00");

    await userEvent.click(screen.getByRole("button", { name: "시작 시각" }));
    const selected = await screen.findByRole("option", { name: "11:00", selected: true });
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    // 목록을 옮긴 대상이 **고른 시각 항목**이다
    expect(scrollIntoView.mock.instances[0]).toBe(selected);
  });

  it("닫았다 다시 열면 **옛 값이 남지 않는다** — 기본값을 그때 다시 센다(드로어가 언마운트된다)", async () => {
    const { unmount } = setup();
    await screen.findByRole("textbox", { name: "회의 제목" });
    // 시각을 바꿔 둔다
    await userEvent.click(screen.getByRole("button", { name: "시작 시각" }));
    await userEvent.click(await screen.findByRole("option", { name: "14:00" }));
    expect(screen.getByRole("button", { name: "시작 시각" })).toHaveTextContent("14:00");
    unmount();

    // 30분이 지난 뒤 다시 연다 — 오늘 · 현재 시각 30분 올림 · +1시간(SPEC-006 U-2)
    vi.setSystemTime(new Date("2026-09-06T00:42:00Z"));
    setup();
    await screen.findByRole("textbox", { name: "회의 제목" });
    expect(screen.getByRole("button", { name: "날짜" })).toHaveTextContent("2026.09.06 (일)");
    expect(screen.getByRole("button", { name: "시작 시각" })).toHaveTextContent("10:00");
    expect(screen.getByRole("button", { name: "종료 시각" })).toHaveTextContent("11:00");
  });

  it("캘린더가 준 시각이 있으면 그것이 미리 들어 있다(같은 드로어 재사용 — SPEC-009 U-6)", async () => {
    setup({ startAt: "2026-08-27T05:00:00Z", endAt: "2026-08-27T06:30:00Z" });
    expect(await screen.findByRole("button", { name: "날짜" })).toHaveTextContent("2026.08.27 (목)");
    expect(screen.getByRole("button", { name: "시작 시각" })).toHaveTextContent("14:00");
    expect(screen.getByRole("button", { name: "종료 시각" })).toHaveTextContent("15:30");
  });

  it("유형 셀렉터에 **종류=미팅인 유형만** 나온다 — 업무 유형·고정 칩이 없다", async () => {
    setup();
    await waitFor(() => expect(screen.getByRole("button", { name: "유형" })).toHaveTextContent("미팅·회의"));
    await userEvent.click(screen.getByRole("button", { name: "유형" }));
    const list = within(screen.getByRole("listbox", { name: "유형" }));
    expect(list.getByRole("option", { name: /외부 미팅/ })).toBeInTheDocument();
    expect(list.queryByRole("option", { name: /문서·보고/ })).not.toBeInTheDocument();
    expect(screen.queryByText("반복")).not.toBeInTheDocument();
    expect(screen.queryByText("개인")).not.toBeInTheDocument();
  });

  it("「만들면 바로 회의 시작」 토글 · 상태 필드 · 연관 업무 칸이 없다", async () => {
    setup();
    await screen.findByRole("textbox", { name: "회의 제목" });
    expect(screen.queryByText(/만들면 바로 회의 시작/)).not.toBeInTheDocument();
    expect(screen.queryByText("상태")).not.toBeInTheDocument();
    expect(screen.queryByText("연관업무")).not.toBeInTheDocument();
    expect(screen.queryByText("연관 업무")).not.toBeInTheDocument();
  });
});

describe("생성 — 요청 하나", () => {
  it("제목 + 유형 + 일시 + 안건 2 + 링크 2 가 **`POST /api/meetings` 한 번**에 실린다", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API_BASE}/api/meetings`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(meetingDetail(), { status: 201 });
      }),
    );
    const { onCreated } = setup();
    await waitFor(() => expect(screen.getByRole("button", { name: "유형" })).toHaveTextContent("미팅·회의"));

    await userEvent.type(screen.getByRole("textbox", { name: "회의 제목" }), "제품 소개서 리뷰");
    // 안건 — `Enter` 로 계속 추가, 「추가」 버튼도 있다
    const agendaInput = screen.getByRole("textbox", { name: "새 안건" });
    await userEvent.type(agendaInput, "개정 대상 섹션 확정{Enter}");
    await userEvent.type(agendaInput, "디자인 반영 일정");
    await userEvent.click(screen.getByRole("button", { name: "안건 추가" }));
    expect(screen.getByRole("textbox", { name: "안건 1" })).toHaveValue("개정 대상 섹션 확정");
    expect(screen.getByRole("textbox", { name: "안건 2" })).toHaveValue("디자인 반영 일정");
    expect(agendaInput).toHaveValue("");

    // 링크 두 건 **연달아** — 팝오버가 유지된다
    await userEvent.click(screen.getByRole("button", { name: "자료함에서 선택" }));
    await userEvent.type(screen.getByRole("textbox", { name: "URL" }), "https://a.example/one");
    await userEvent.click(popoverAddButton());
    expect(screen.getByRole("textbox", { name: "URL" })).toHaveValue("");
    await userEvent.type(screen.getByRole("textbox", { name: "URL" }), "https://b.example/two");
    await userEvent.type(screen.getByRole("textbox", { name: "표시 이름" }), "경쟁사 비교");
    await userEvent.click(popoverAddButton());
    // 「자료함 문서」 세그먼트는 스텁 안내
    await userEvent.click(screen.getByRole("tab", { name: "자료함 문서" }));
    expect(screen.getByText("자료함이 아직 없습니다")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    await userEvent.click(screen.getByRole("button", { name: "만들기" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    // 성공하면 드로어가 닫힌다(U-3 기대 결과).
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "회의 제목" })).not.toBeInTheDocument());
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toEqual({
      title: "제품 소개서 리뷰",
      workTypeId: 1,
      projectId: null,
      startAt: "2026-09-06T00:30:00.000Z",
      endAt: "2026-09-06T01:30:00.000Z",
      agendas: [{ title: "개정 대상 섹션 확정" }, { title: "디자인 반영 일정" }],
      attachments: [
        { kind: "link", url: "https://a.example/one", label: null },
        { kind: "link", url: "https://b.example/two", label: "경쟁사 비교" },
      ],
    });
  });

  it("`409 schedule_overlap` — 토스트 + 일시 실패 테두리, **드로어가 닫히지 않고 입력이 남는다**", async () => {
    server.use(
      http.post(`${API_BASE}/api/meetings`, () =>
        HttpResponse.json({ detail: "그 시간에 다른 일정이 있습니다", code: "schedule_overlap" }, { status: 409 }),
      ),
    );
    const { onCreated } = setup();
    await waitFor(() => expect(screen.getByRole("button", { name: "유형" })).toHaveTextContent("미팅·회의"));
    await userEvent.type(screen.getByRole("textbox", { name: "회의 제목" }), "겹치는 회의");
    await userEvent.click(screen.getByRole("button", { name: "만들기" }));

    expect(await screen.findByText("그 시간에 다른 일정이 있습니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "시작 시각" })).toHaveClass("border-destructive");
    // 드로어가 열린 채고 입력이 남는다.
    expect(screen.getByRole("textbox", { name: "회의 제목" })).toHaveValue("겹치는 회의");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("301분이면 만들어지지 않고 일시 칸에 안내가 뜬다 — 서버 왕복 없이", async () => {
    const posts = vi.fn();
    server.use(
      http.post(`${API_BASE}/api/meetings`, () => {
        posts();
        return HttpResponse.json(meetingDetail(), { status: 201 });
      }),
    );
    setup({ startAt: "2026-09-06T00:00:00Z", endAt: "2026-09-06T05:01:00Z" });
    await waitFor(() => expect(screen.getByRole("button", { name: "유형" })).toHaveTextContent("미팅·회의"));
    await userEvent.type(screen.getByRole("textbox", { name: "회의 제목" }), "긴 회의");

    expect(screen.getByRole("alert")).toHaveTextContent("회의는 5분 이상 300분 이하여야 합니다");
    expect(screen.getByRole("button", { name: "만들기" })).toBeDisabled();
    expect(posts).not.toHaveBeenCalled();
  });

  it("종료 ≤ 시작이면 「종료 시각은 시작보다 뒤여야 합니다」", async () => {
    setup({ startAt: "2026-09-06T02:00:00Z", endAt: "2026-09-06T01:00:00Z" });
    expect(await screen.findByRole("alert")).toHaveTextContent("종료 시각은 시작보다 뒤여야 합니다");
  });

  it("`422 invalid_work_type` 은 유형 셀렉터 옆 인라인 · 드로어 유지", async () => {
    server.use(
      http.post(`${API_BASE}/api/meetings`, () =>
        HttpResponse.json({ detail: "사용할 수 없는 유형입니다", code: "invalid_work_type" }, { status: 422 }),
      ),
    );
    setup();
    await waitFor(() => expect(screen.getByRole("button", { name: "유형" })).toHaveTextContent("미팅·회의"));
    await userEvent.type(screen.getByRole("textbox", { name: "회의 제목" }), "회의");
    await userEvent.click(screen.getByRole("button", { name: "만들기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("삭제됐거나 회의에 쓸 수 없는 유형입니다");
  });
});

describe("에러 뒤 후속 동작 — Case Matrix(검수 F-1 · W-3 · W-5)", () => {
  /**
   * 유형·프로젝트 목록 GET 을 세면서 드로어를 연다 — 「목록 갱신」이 **실제 재요청**으로 나가는지 본다.
   * 첫 로드가 각 1건이고, 422 뒤 무효화된 쪽만 2건이 되어야 한다.
   */
  function setupCounting() {
    const counts = { workTypes: 0, projects: 0 };
    server.use(
      http.get(`${API_BASE}/api/work-types`, () => {
        counts.workTypes += 1;
        return HttpResponse.json(WORK_TYPES);
      }),
      http.get(`${API_BASE}/api/projects`, () => {
        counts.projects += 1;
        return HttpResponse.json(PROJECTS);
      }),
    );
    const onCreated = vi.fn();
    renderWithProviders(<Opener onCreated={onCreated} />);
    return { counts, onCreated };
  }

  async function fillAndSubmit(beforeSubmit?: () => void) {
    await waitFor(() => expect(screen.getByRole("button", { name: "유형" })).toHaveTextContent("미팅·회의"));
    await userEvent.type(screen.getByRole("textbox", { name: "회의 제목" }), "회의");
    beforeSubmit?.();
    await userEvent.click(screen.getByRole("button", { name: "만들기" }));
  }

  it("`422 invalid_work_type` — 인라인 뒤 **유형 목록을 다시 받는다**(프로젝트 목록은 그대로)", async () => {
    server.use(
      http.post(`${API_BASE}/api/meetings`, () =>
        HttpResponse.json({ detail: "사용할 수 없는 유형입니다", code: "invalid_work_type" }, { status: 422 }),
      ),
    );
    const { counts, onCreated } = setupCounting();
    // 제출 전엔 첫 로드 각 1건이다.
    await fillAndSubmit(() => expect(counts).toEqual({ workTypes: 1, projects: 1 }));

    expect(await screen.findByRole("alert")).toHaveAttribute("data-field", "workType");
    await waitFor(() => expect(counts.workTypes).toBe(2));
    expect(counts.projects).toBe(1);
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "회의 제목" })).toHaveValue("회의");
  });

  it("`422 invalid_project` — 인라인 뒤 **프로젝트 목록을 다시 받는다**(유형 목록은 그대로)", async () => {
    server.use(
      http.post(`${API_BASE}/api/meetings`, () =>
        HttpResponse.json({ detail: "사용할 수 없는 프로젝트입니다", code: "invalid_project" }, { status: 422 }),
      ),
    );
    const { counts } = setupCounting();
    // 제출 전엔 첫 로드 각 1건이다.
    await fillAndSubmit(() => expect(counts).toEqual({ workTypes: 1, projects: 1 }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-field", "project");
    expect(alert).toHaveTextContent("삭제된 프로젝트입니다. 다시 골라 주세요");
    await waitFor(() => expect(counts.projects).toBe(2));
    expect(counts.workTypes).toBe(1);
  });

  it("`422 validation_error` 에 `field: endAt` 이 오면 **일시 칸**에 붙는다 — 제목 칸이 아니다", async () => {
    server.use(
      http.post(`${API_BASE}/api/meetings`, () =>
        HttpResponse.json(
          { detail: "회의는 5분 이상 300분 이하여야 합니다", code: "validation_error", field: "endAt" },
          { status: 422 },
        ),
      ),
    );
    setup();
    await fillAndSubmit();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-field", "time");
    expect(alert).toHaveTextContent("회의는 5분 이상 300분 이하여야 합니다");
    expect(screen.getByRole("button", { name: "종료 시각" })).toHaveClass("border-destructive");
    expect(screen.getByRole("textbox", { name: "회의 제목" })).not.toHaveClass("border-destructive");
  });

  it("`422 validation_error` 에 `field` 가 없으면 **폼 전체**에 붙는다 — 제목 칸을 짚지 않는다", async () => {
    server.use(
      http.post(`${API_BASE}/api/meetings`, () =>
        HttpResponse.json({ detail: "입력값을 확인해 주세요", code: "validation_error" }, { status: 422 }),
      ),
    );
    setup();
    await fillAndSubmit();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-field", "form");
    expect(alert).toHaveTextContent("입력값을 확인해 주세요");
    expect(screen.getByRole("textbox", { name: "회의 제목" })).not.toHaveClass("border-destructive");
    expect(screen.getByRole("button", { name: "종료 시각" })).not.toHaveClass("border-destructive");
  });

  it("`422 validation_error` 에 `field: title` 이면 제목 칸에 붙는다", async () => {
    server.use(
      http.post(`${API_BASE}/api/meetings`, () =>
        HttpResponse.json(
          { detail: "제목은 200자까지 입력할 수 있습니다", code: "validation_error", field: "title" },
          { status: 422 },
        ),
      ),
    );
    setup();
    await fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveAttribute("data-field", "title");
    expect(screen.getByRole("textbox", { name: "회의 제목" })).toHaveClass("border-destructive");
  });

  it("`501 v2_not_available` — 「v2에서 제공됩니다」 토스트, 드로어는 열린 채", async () => {
    server.use(
      http.post(`${API_BASE}/api/meetings`, () =>
        HttpResponse.json({ detail: "v2에서 제공됩니다", code: "v2_not_available" }, { status: 501 }),
      ),
    );
    const { onCreated } = setup();
    await fillAndSubmit();

    expect(await screen.findByText("v2에서 제공됩니다")).toBeInTheDocument();
    expect(screen.queryByText("회의록을 만들지 못했습니다")).not.toBeInTheDocument();
    // 토스트로 알린 것은 칸 옆에 반복하지 않는다.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "회의 제목" })).toHaveValue("회의");
    expect(onCreated).not.toHaveBeenCalled();
  });
});

describe("첨부 드롭 영역 — v2 게이트", () => {
  it("파일을 드롭하면 「v2에서 제공됩니다」 토스트만 뜨고 **요청이 0건**이다", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    setup();
    // 목록 조회(유형·프로젝트)가 끝난 뒤부터 센다 — 드롭이 낸 요청만 본다.
    await waitFor(() => expect(screen.getByRole("button", { name: "유형" })).toHaveTextContent("미팅·회의"));
    const before = fetchSpy.mock.calls.length;

    const zone = screen.getByText("파일을 끌어다 놓거나 자료함에서 선택");
    zone.dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
    zone.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));

    expect(await screen.findByText("v2에서 제공됩니다")).toBeInTheDocument();
    // 드롭으로 새 요청이 나가지 않았다(목록 조회는 이미 나간 뒤다).
    expect(fetchSpy.mock.calls.length).toBe(before);
    expect(zone.closest("[data-v2-gate]")).toHaveAttribute("aria-disabled", "true");
    fetchSpy.mockRestore();
  });
});
