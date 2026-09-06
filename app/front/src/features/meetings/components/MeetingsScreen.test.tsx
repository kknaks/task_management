/**
 * **목록 페이지 껍데기 — 선택 규칙과 삭제 흐름**(WORK-006 Phase 4 검증).
 *
 * - 첫 진입에 **가장 최근 행이 선택**되어 우측에 그 회의가 보인다
 * - 행 우클릭 → 「삭제」 → 모달(문안 3줄) → 삭제하면 `DELETE` 가 나가고 **다음 행**이 `?id=` 로 선택된다
 * - `recording` 행 우클릭에서는 「삭제」가 비활성이다
 * - 달·필터·정렬은 `?` 로 나간다(`router.replace`)
 */

import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MeetingsScreen } from "@/features/meetings/components/MeetingsScreen";
import { DELETE_WARNING } from "@/features/meetings/components/MeetingDeleteModal";
import { SEED_ITEMS, SEED_LIST, meetingDetail, renderWithProviders } from "@/features/meetings/testUtils";
import { tokenStore } from "@/lib/auth/tokenStore";
import { API_BASE, server } from "@/test/server";

const replace = vi.fn();
const push = vi.fn();
let searchParams = new URLSearchParams();

vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    ...actual,
    useRouter: () => ({ push, replace, back: vi.fn(), refresh: vi.fn() }),
    usePathname: () => "/meetings/",
    useSearchParams: () => searchParams,
  };
});

/** 서버 목 — 목록은 시드, 상세는 id 로 찾는다. */
function serve() {
  server.use(
    http.get(`${API_BASE}/api/meetings`, () => HttpResponse.json(SEED_LIST)),
    http.get(`${API_BASE}/api/meetings/:id`, ({ params }) => {
      const id = Number(params.id);
      const item = SEED_ITEMS.find((row) => row.id === id);
      return item
        ? HttpResponse.json(meetingDetail({ ...item, agendas: { human: [], ai: [], merged: [] }, attachments: [] }))
        : HttpResponse.json({ detail: "회의록을 찾을 수 없습니다", code: "not_found" }, { status: 404 });
    }),
  );
}

beforeEach(() => {
  tokenStore.setAccess("A1");
  replace.mockReset();
  push.mockReset();
  searchParams = new URLSearchParams("month=2026-08");
  Object.defineProperty(window, "innerWidth", { value: 1600, configurable: true });
});

afterEach(async () => {
  await tokenStore.clear();
});

describe("선택 규칙", () => {
  it("첫 진입에 **가장 최근 행**(startAt 최대)이 선택되고 우측에 그 회의가 보인다", async () => {
    serve();
    renderWithProviders(<MeetingsScreen />);

    // 시드에서 가장 최근은 08-28 의 「고객 인터뷰 4차」(id 22)다.
    const row = await screen.findByRole("button", { name: "고객 인터뷰 4차" });
    expect(row).toHaveAttribute("aria-pressed", "true");
    const preview = screen.getByRole("region", { name: "회의록 미리보기" });
    expect(await within(preview).findByText("고객 인터뷰 4차")).toBeInTheDocument();
    expect(within(preview).getByText("08월 28일 (금) 14:00 – 15:00")).toBeInTheDocument();
  });

  it("행을 누르면 `?id=` 로 선택이 나가고, `?id=` 가 있으면 그 행이 선택된다", async () => {
    serve();
    searchParams = new URLSearchParams("month=2026-08&id=24");
    renderWithProviders(<MeetingsScreen />);

    expect(await screen.findByRole("button", { name: "온보딩 킥오프" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "디자인 싱크" }));
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("id=23"));
  });

  it("스테퍼 `‹` 는 `?month=` 를 한 달 앞으로 옮긴다", async () => {
    serve();
    renderWithProviders(<MeetingsScreen />);
    await screen.findByRole("button", { name: "고객 인터뷰 4차" });
    expect(screen.getByRole("button", { name: "기간 고르기" })).toHaveTextContent("2026년 8월");

    await userEvent.click(screen.getByRole("button", { name: "이전 기간" }));
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("month=2026-07"));
  });
});

describe("삭제 — 컨텍스트 메뉴 → 모달 → 다음 행", () => {
  it("우클릭 「삭제」 → 문안 3줄 → 삭제하면 `DELETE` 가 나가고 **다음 행**이 선택된다", async () => {
    serve();
    let deleted = false;
    server.use(
      http.delete(`${API_BASE}/api/meetings/21`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWithProviders(<MeetingsScreen />);
    // `scheduled` 행 — 삭제가 열려 있다(상태별 허용 표).
    const row = await screen.findByRole("button", { name: "제품 소개서 리뷰" });

    fireEvent.contextMenu(row, { clientX: 20, clientY: 20 });
    await userEvent.click(await screen.findByRole("button", { name: "삭제" }));

    // 컨텍스트 메뉴(팝오버)도 `dialog` 롤이라 **모달 제목**으로 찾는다.
    const dialog = (await screen.findByText("'제품 소개서 리뷰' 회의록을 삭제할까요?")).closest(
      "[role=dialog]",
    ) as HTMLElement;
    expect(dialog).toHaveTextContent("목록과 캘린더에서 사라집니다");
    expect(dialog).toHaveTextContent(DELETE_WARNING);
    await userEvent.click(within(dialog).getByRole("button", { name: "삭제" }));

    await waitFor(() => expect(deleted).toBe(true));
    // 시드 순서(서버 응답 그대로)에서 「제품 소개서 리뷰」 다음은 「고객 인터뷰 4차」(id 22)다.
    await waitFor(() => expect(replace).toHaveBeenCalledWith(expect.stringContaining("id=22")));
  });

  it("`recording` 행 우클릭에서는 「삭제」가 비활성이다", async () => {
    serve();
    renderWithProviders(<MeetingsScreen />);
    const row = await screen.findByRole("button", { name: "고객 인터뷰 4차" });

    fireEvent.contextMenu(row, { clientX: 20, clientY: 20 });
    expect(await screen.findByRole("button", { name: "삭제" })).toBeDisabled();
  });
});
