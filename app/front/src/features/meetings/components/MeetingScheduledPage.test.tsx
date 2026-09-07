/**
 * **회의 시작 전 화면 · 상세 스위치 · 삭제 모달 — 앱 창 확인 항목의 테스트 판**(WORK-006 Phase 4·6).
 *
 * - 「기록 대기 00:00:00」 상태 바 + 「회의 시작」이 있고, **「회의 정보 수정」·「내 목소리 등록됨」·「새 안건 ▾」·추천 칩·전송 버튼이 없다**
 * - 안건을 적어 `Enter` 하면 「안건 n」 행이 생기고 입력이 비워진다 · 「추가」 버튼이 항상 있다
 * - 안건 제목을 고치고 바깥을 클릭하면 저장 버튼 없이 저장된다 · 실패하면 토스트 + 그 행 실패 표시 + 「다시 저장」, **재요청 0건**
 * - 「제거」는 확인 없이 지운다
 * - 첨부 탭: 링크를 붙이면 라벨 「첨부 파일 n」 · 링크 행은 `target=_blank` · PDF 드롭은 토스트만
 * - 헤더 `⋯` → 「삭제」 → **같은 모달**(문안 3줄) → 삭제하면 목록으로
 * - 「회의 시작」 → 같은 화면이 `recording` 분기(플레이스홀더)로 바뀐다 · 다른 창에서 이미 시작됐으면 토스트
 * - 없는 회의록 주소 → 「없는 회의록입니다」 + 「목록으로」, 튕기지 않는다
 */

import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MeetingDetailPage } from "@/features/meetings/components/MeetingDetailPage";
import { DELETE_WARNING } from "@/features/meetings/components/MeetingDeleteModal";
import { meetingDetail, renderWithProviders } from "@/features/meetings/testUtils";
import type { MeetingDetail } from "@/features/meetings/types";
import { queryKeys } from "@/lib/api/queryKeys";
import { tokenStore } from "@/lib/auth/tokenStore";
import { API_BASE, server } from "@/test/server";

const push = vi.fn();
let searchParams = new URLSearchParams();

vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    ...actual,
    useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
    usePathname: () => "/meetings/detail/",
    useSearchParams: () => searchParams,
  };
});

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  window.dispatchEvent(new Event("resize"));
}

/**
 * 상세 라우트 스위치를 통째로 그린다 — 화면은 **캐시의 `MeetingDetail`** 을 본다. 낙관적 갱신·롤백·
 * `/start` 뒤 분기 전환이 전부 캐시로 일어나므로 prop 으로 고정하면 그 동작을 볼 수 없다.
 */
async function renderScheduled(detail: MeetingDetail = meetingDetail()) {
  /** 서버가 든 현재 상세 — 쓰기 핸들러가 이 값을 바꾸고 재조회(GET)가 그것을 돌려준다. */
  const state = { detail };
  server.use(http.get(`${API_BASE}/api/meetings/${detail.id}`, () => HttpResponse.json(state.detail)));
  const result = renderWithProviders(<MeetingDetailPage />);
  await screen.findByRole("button", { name: "회의 시작" });
  return { ...result, state };
}

beforeEach(() => {
  tokenStore.setAccess("A1");
  push.mockReset();
  searchParams = new URLSearchParams("id=21");
  setViewport(1600);
});

afterEach(async () => {
  await tokenStore.clear();
});

describe("헤더 · 상태 바 · 없는 것", () => {
  it("「기록 대기 00:00:00」 상태 바와 「회의 시작」이 있고, 시안의 AI·수정·마이크 요소가 없다", async () => {
    await renderScheduled();
    expect(screen.getByRole("status", { name: "기록 대기" })).toHaveTextContent("00:00:00");
    expect(screen.getByRole("button", { name: "회의 시작" })).toBeInTheDocument();
    // 메타 한 줄은 **일시 · 소요 · 예정**뿐이다 — 유형 · 프로젝트는 배지 줄로 올라갔다(MF-8)
    expect(screen.getByText("08월 27일 (목) 09:30 – 10:30 · 60분 · 예정")).toBeInTheDocument();

    expect(screen.queryByText("회의 정보 수정")).not.toBeInTheDocument();
    expect(screen.queryByText(/내 목소리 등록됨/)).not.toBeInTheDocument();
    expect(screen.queryByText(/MacBook Pro 마이크/)).not.toBeInTheDocument();
    // 모드 칩 「새 안건 ▾」이 없다(캡션 「시작 전에는 새 안건만 …」은 다른 문장이다).
    expect(screen.queryByText("새 안건")).not.toBeInTheDocument();
    expect(screen.queryByText(/안건 초안을 만들어 줍니다/)).not.toBeInTheDocument();
    expect(screen.queryByText("소개서 개정 범위 정리")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "전송" })).not.toBeInTheDocument();
    // 「추가」 버튼은 항상 있다.
    expect(screen.getByRole("button", { name: "안건 추가" })).toBeInTheDocument();
    expect(screen.getByText("시작 전에는 새 안건만 만들 수 있습니다")).toBeInTheDocument();
  });

  it("무소속이면 프로젝트 자리를 비운다 · AI 요약 탭은 빈 상태 문구", async () => {
    await renderScheduled(meetingDetail({ project: null }));
    expect(screen.getByText("08월 27일 (목) 09:30 – 10:30 · 60분 · 예정")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "프로젝트 바꾸기" })).toHaveTextContent("프로젝트 없음");
    await userEvent.click(screen.getByRole("tab", { name: "AI 요약" }));
    expect(screen.getByText("회의를 시작하면 AI 요약이 여기에 쌓입니다")).toBeInTheDocument();
  });
});

describe("안건 — 추가 · 인라인 편집 · 제거", () => {
  it("안건을 적어 `Enter` 하면 `POST …/agendas` 가 나가고 「안건 3」 행이 생기며 입력이 비워진다", async () => {
    const bodies: unknown[] = [];
    const { client, state } = await renderScheduled();
    server.use(
      http.post(`${API_BASE}/api/meetings/21/agendas`, async ({ request }) => {
        bodies.push(await request.json());
        const detail = state.detail;
        state.detail = {
          ...detail,
          agendas: {
            ...detail.agendas,
            human: [
              ...detail.agendas.human,
              { id: 303, track: "human", title: "가격 표기 문구", orderIndex: 2, state: null, sourceAgendaId: null, lines: [] },
            ],
          },
        };
        return HttpResponse.json(state.detail, { status: 201 });
      }),
    );
    const input = screen.getByRole("textbox", { name: "안건" });
    await userEvent.type(input, "가격 표기 문구{Enter}");

    await waitFor(() => expect(bodies).toEqual([{ title: "가격 표기 문구" }]));
    await waitFor(() => expect(input).toHaveValue(""));
    expect(client.getQueryData<MeetingDetail>(queryKeys.meetingDetail(21))?.agendas.human).toHaveLength(3);
  });

  it("제목을 고치고 바깥을 클릭하면 **저장 버튼 없이** `PATCH` 가 나간다", async () => {
    const bodies: unknown[] = [];
    const { state } = await renderScheduled();
    server.use(
      http.patch(`${API_BASE}/api/meetings/21/agendas/301`, async ({ request }) => {
        bodies.push(await request.json());
        const detail = state.detail;
        state.detail = {
          ...detail,
          agendas: { ...detail.agendas, human: [{ ...detail.agendas.human[0], title: "개정 범위 확정" }, detail.agendas.human[1]] },
        };
        return HttpResponse.json(state.detail);
      }),
    );
    const field = screen.getByRole("textbox", { name: "안건 1 제목" });
    await userEvent.clear(field);
    await userEvent.type(field, "개정 범위 확정");
    await userEvent.tab();

    await waitFor(() => expect(bodies).toEqual([{ title: "개정 범위 확정" }]));
    expect(screen.queryByRole("button", { name: "저장" })).not.toBeInTheDocument();
  });

  it("서버가 죽어 있으면 토스트 + 그 행 실패 표시 + 「다시 저장」이 뜨고 **재요청이 0건**이다(U-7)", async () => {
    let calls = 0;
    server.use(
      http.patch(`${API_BASE}/api/meetings/21/agendas/301`, () => {
        calls += 1;
        return HttpResponse.json({ detail: "서버 오류", code: "internal_error" }, { status: 500 });
      }),
    );
    const { client } = await renderScheduled();
    const field = screen.getByRole("textbox", { name: "안건 1 제목" });
    await userEvent.clear(field);
    await userEvent.type(field, "실패할 제목");
    await userEvent.tab();

    expect(await screen.findByText("저장하지 못했습니다 · 안건")).toBeInTheDocument();
    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("안건이 저장되지 않았습니다");
    expect(within(notice).getByRole("button", { name: "다시 저장" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "안건 1 제목" })).toHaveAttribute("aria-invalid", "true");
    // 낙관적 반영이 **캐시에서 되돌아갔다** — 서버 값이 정본이다(§5 표 · 롤백).
    await waitFor(() =>
      expect(client.getQueryData<MeetingDetail>(queryKeys.meetingDetail(21))?.agendas.human[0].title).toBe(
        "개정 대상 섹션 확정",
      ),
    );
    // 컨트롤은 **넣으려던 값을 유지**한다 — 「테두리 실패색 + 값 유지」(U-7).
    expect(screen.getByRole("textbox", { name: "안건 1 제목" })).toHaveValue("실패할 제목");

    // 가만히 두어도 재요청이 없다.
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(calls).toBe(1);

    // 「다시 저장」은 **정확히 1건** 더 보낸다.
    await userEvent.click(within(notice).getByRole("button", { name: "다시 저장" }));
    await waitFor(() => expect(calls).toBe(2));
  });

  it("「제거」는 확인 없이 `DELETE` 를 보내고 번호가 당겨진다", async () => {
    let deleted = false;
    const { state } = await renderScheduled();
    server.use(
      http.delete(`${API_BASE}/api/meetings/21/agendas/301`, () => {
        deleted = true;
        const detail = state.detail;
        state.detail = { ...detail, agendas: { ...detail.agendas, human: [detail.agendas.human[1]] } };
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "안건 1 제거" }));

    await waitFor(() => expect(deleted).toBe(true));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "안건 1 제목" })).toHaveValue("디자인 반영 일정과 검수 방식"),
    );
    expect(screen.queryByRole("textbox", { name: "안건 2 제목" })).not.toBeInTheDocument();
  });
});

describe("첨부 파일 탭", () => {
  it("라벨은 「첨부 파일 1」, 링크를 붙이면 `POST …/attachments` 가 나가고 「첨부 파일 2」가 된다 · 링크 행은 브라우저로", async () => {
    const bodies: unknown[] = [];
    const { state } = await renderScheduled();
    server.use(
      http.post(`${API_BASE}/api/meetings/21/attachments`, async ({ request }) => {
        bodies.push(await request.json());
        const detail = state.detail;
        state.detail = {
          ...detail,
          attachments: [
            ...detail.attachments,
            { id: 43, kind: "link", name: "b.example", documentId: null, folderPath: null, sizeBytes: null, updatedAt: "2026-08-21T00:00:00Z", url: "https://b.example/x", isDeleted: false },
          ],
        };
        return HttpResponse.json(state.detail, { status: 201 });
      }),
    );
    await userEvent.click(screen.getByRole("tab", { name: "첨부 파일 1" }));
    expect(screen.getByRole("link", { name: "경쟁사 요금제 비교" })).toHaveAttribute("target", "_blank");

    await userEvent.click(screen.getByRole("button", { name: "첨부 추가" }));
    await userEvent.type(screen.getByRole("textbox", { name: "URL" }), "https://b.example/x{Enter}");

    await waitFor(() => expect(bodies).toEqual([{ kind: "link", url: "https://b.example/x", label: null }]));
    expect(await screen.findByRole("tab", { name: "첨부 파일 2" })).toBeInTheDocument();
  });

  it("0건이면 숫자를 생략하고 「파일 첨부하기」 빈 상태 · PDF 를 드롭하면 토스트만, 요청 없음", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await renderScheduled(meetingDetail({ attachments: [] }));
    await userEvent.click(screen.getByRole("tab", { name: "첨부 파일" }));
    expect(screen.getByText("첨부한 파일이 없습니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "파일 첨부하기" })).toBeInTheDocument();

    const before = fetchSpy.mock.calls.length;
    const footer = screen.getByText("끌어다 놓아도 첨부됩니다 · 최대 50MB");
    footer.dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
    footer.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
    expect(await screen.findByText("v2에서 제공됩니다")).toBeInTheDocument();
    expect(fetchSpy.mock.calls.length).toBe(before);
    fetchSpy.mockRestore();
  });
});

describe("삭제 · 시작 · 스위치", () => {
  it("헤더 `⋯` → 「삭제」 → 문안 3줄 모달 → 삭제하면 `DELETE` 후 **목록으로 이동**", async () => {
    let deleted = false;
    server.use(
      http.delete(`${API_BASE}/api/meetings/21`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
      http.get(`${API_BASE}/api/meetings`, () => HttpResponse.json({ items: [], total: 0, projectCounts: [] })),
    );
    await renderScheduled();
    await userEvent.click(screen.getByRole("button", { name: "더 보기" }));
    await userEvent.click(screen.getByRole("button", { name: "삭제" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("'제품 소개서 리뷰' 회의록을 삭제할까요?");
    expect(dialog).toHaveTextContent("목록과 캘린더에서 사라집니다");
    expect(dialog).toHaveTextContent(DELETE_WARNING);
    expect(dialog).toHaveTextContent("녹음 원본은 지워지지 않고 서버에 남습니다");

    await userEvent.click(within(dialog).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(deleted).toBe(true));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/meetings/"));
  });

  it("「회의 시작」 → `POST /start` → **같은 화면이 `recording` 분기(회의 중 화면 — WORK-007)로 바뀐다**", async () => {
    let started = false;
    server.use(
      http.get(`${API_BASE}/api/meetings/21`, () =>
        HttpResponse.json(meetingDetail(started ? { status: "recording", recordingStartedAt: "2026-08-27T00:31:00Z" } : {})),
      ),
      http.post(`${API_BASE}/api/meetings/21/start`, () => {
        started = true;
        return HttpResponse.json(meetingDetail({ status: "recording", recordingStartedAt: "2026-08-27T00:31:00Z" }));
      }),
      http.get(`${API_BASE}/api/meetings/21/transcript`, () =>
        HttpResponse.json({ recordingStartedAt: "2026-08-27T00:31:00Z", speakerCount: 0, items: [] }),
      ),
      http.get(`${API_BASE}/api/meetings`, () => HttpResponse.json({ items: [], total: 0, projectCounts: [] })),
    );
    renderWithProviders(<MeetingDetailPage />);

    await userEvent.click(await screen.findByRole("button", { name: "회의 시작" }));

    // 회의 중 화면 — 「회의 종료」 자리가 있고 「회의 시작」은 사라진다. 페이지 이동 없음.
    expect(await screen.findByRole("button", { name: "회의 종료" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "회의 시작" })).not.toBeInTheDocument();
    expect(screen.queryByText("이 화면은 WORK-007 에서 만든다")).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("다른 창에서 이미 시작됐으면(409) 「지금 상태에서는 할 수 없습니다」 토스트 + 상세 재조회", async () => {
    let reads = 0;
    server.use(
      http.get(`${API_BASE}/api/meetings/21`, () => {
        reads += 1;
        return HttpResponse.json(meetingDetail(reads > 1 ? { status: "recording" } : {}));
      }),
      http.post(`${API_BASE}/api/meetings/21/start`, () =>
        HttpResponse.json({ detail: "지금 상태에서는 할 수 없습니다", code: "invalid_meeting_status" }, { status: 409 }),
      ),
    );
    renderWithProviders(<MeetingDetailPage />);
    await userEvent.click(await screen.findByRole("button", { name: "회의 시작" }));

    expect(await screen.findByText("지금 상태에서는 할 수 없습니다")).toBeInTheDocument();
    await waitFor(() => expect(reads).toBeGreaterThanOrEqual(2));
  });

  it("없는 회의록 주소면 「없는 회의록입니다」 + 「목록으로」 — 리다이렉트하지 않는다", async () => {
    server.use(
      http.get(`${API_BASE}/api/meetings/21`, () =>
        HttpResponse.json({ detail: "회의록을 찾을 수 없습니다", code: "not_found" }, { status: 404 }),
      ),
    );
    renderWithProviders(<MeetingDetailPage />);
    expect(await screen.findByText("없는 회의록입니다")).toBeInTheDocument();
    // Next `Link` 가 뒤 슬래시를 정규화한다.
    expect(screen.getByRole("link", { name: "목록으로" }).getAttribute("href")).toMatch(/^\/meetings\/?$/);
    expect(push).not.toHaveBeenCalled();
  });

  it("`generating`·`ended` 는 WORK-008 의 `MeetingClosedPage` 로 간다 — 상태 칩 「회의록 생성중」", async () => {
    server.use(
      http.get(`${API_BASE}/api/meetings/21`, () => HttpResponse.json(meetingDetail({ status: "generating", integrationState: "running" }))),
    );
    renderWithProviders(<MeetingDetailPage />);
    expect(await screen.findByText("회의록 생성중")).toBeInTheDocument();
    expect(screen.queryByText("이 화면은 WORK-008 에서 만든다")).not.toBeInTheDocument();
  });
});
describe("헤더 순서 · 「←」(WORK-014 · MF-8 · FE §6-3)", () => {
  it("① breadcrumb(+「←」) → ② 배지 줄 → ③ 제목 → ④ 메타 순서다 · 메타에 유형 · 프로젝트가 없다", async () => {
    await renderScheduled();
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
    expect(within(badges).getByRole("button", { name: "회의 시작" })).toBeInTheDocument();
    expect(within(badges).getByRole("button", { name: "더 보기" })).toBeInTheDocument();
  });
});

