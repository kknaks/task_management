/**
 * **필수 테스트 ③ — 자동 저장 실패**의 나머지 절반(`frontend/README.md` §11 3 · 검수 W-7).
 *
 * > 실패 응답에 **토스트 + 그 필드의 실패 표시**가 **함께** 뜨고 **재시도가 나가지 않는다**.
 *
 * 전 라운드는 컴포넌트 몫(필드 표시)만 보고 **토스트 쪽은 호출자 몫이라며 비워 두었다.**
 * 검증되지 않은 그 절반이 정확히 **F-1 이 숨어 있던 자리**다 — 색 저장 실패에는 토스트만 있고
 * 필드 표시가 없었다. 그래서 여기서는 **패널을 통째로 띄우고 MSW 로 서버를 막아** 둘을 함께 본다.
 *
 * 목으로 바꾼 것은 셸의 키체인 하나뿐이다(`src/test/setup.ts`). 파이프라인·훅·컴포넌트는 실물이다.
 */

import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Toaster } from "@/components/ui/sonner";
import { WorkTypePanel } from "@/features/settings/components/WorkTypePanel";
import { tokenStore } from "@/lib/auth/tokenStore";
import { OverlayProvider } from "@/lib/overlay/OverlayProvider";
import { API_BASE, server } from "@/test/server";

const WORK_TYPE = {
  id: 4,
  kind: "meeting" as const,
  name: "외부 미팅",
  colorToken: "mint" as const,
  description: "고객사와 하는 회의",
  isDefault: false,
};

/** 기본 유형 3종 중 하나 — 이름·종류는 읽기 전용이지만 **설명은 편집된다**(A-4 · MF-21). */
const DEFAULT_TYPE = {
  id: 3,
  kind: "task" as const,
  name: "문서·보고",
  colorToken: "steel" as const,
  description: null,
  isDefault: true,
};

/** 저장 실패 시 함께 떠야 하는 둘. */
const NAME_TOAST = "저장하지 못했습니다 · 유형 이름";
const COLOR_TOAST = "저장하지 못했습니다 · 유형 색";
const NAME_NOTICE = "유형 이름이 저장되지 않았습니다";
const COLOR_NOTICE = "유형 색이 저장되지 않았습니다";

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <OverlayProvider>
        <WorkTypePanel />
        <Toaster />
      </OverlayProvider>
    </QueryClientProvider>,
  );
}

/** Radix 팝오버·셀렉터는 jsdom 에서 pointer-events 검사를 통과하지 못한다. */
const user = () => userEvent.setup({ pointerEventsCheck: 0 });

/** PATCH 를 막고 **들어온 요청 수**를 센다 — 「자동 재시도 없음」의 증거다. */
function blockPatch() {
  const calls: unknown[] = [];
  server.use(
    http.get(`${API_BASE}/api/work-types`, () => HttpResponse.json({ items: [WORK_TYPE] })),
    http.patch(`${API_BASE}/api/work-types/${WORK_TYPE.id}`, async ({ request }) => {
      calls.push(await request.json());
      return HttpResponse.json({ detail: "서버 오류", code: "internal_error" }, { status: 500 });
    }),
  );
  return calls;
}

beforeEach(() => {
  // Radix `Select` 는 열 때 포인터 캡처와 `scrollIntoView` 를 쓴다 — jsdom 에 없어 목록이 안 열린다
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => undefined;
    Element.prototype.releasePointerCapture = () => undefined;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
  }
  tokenStore.setAccess("A1");
});

afterEach(async () => {
  await tokenStore.clear();
});

describe("③ 자동 저장 실패 — 토스트와 필드 표시가 함께 뜬다", () => {
  it("이름 저장이 실패하면 토스트와 행 아래 표시가 **함께** 뜬다", async () => {
    const calls = blockPatch();
    renderPanel();

    const input = await screen.findByLabelText("외부 미팅 이름");
    await user().clear(input);
    await user().type(input, "외부 미팅(신규)");
    await user().tab();

    expect(await screen.findByText(NAME_TOAST)).toBeInTheDocument();
    expect(await screen.findByText(NAME_NOTICE)).toBeInTheDocument();
    // 실패한 컨트롤 자신에 테두리 실패색(U-7)
    expect(screen.getByLabelText("외부 미팅 이름")).toHaveAttribute("aria-invalid", "true");
    expect(calls).toHaveLength(1);
  });

  it("**색 저장이 실패해도 같은 둘이 뜬다** — F-1 회귀", async () => {
    const calls = blockPatch();
    renderPanel();

    await user().click(await screen.findByRole("button", { name: "외부 미팅 색" }));
    await user().click(await screen.findByRole("option", { name: "amber" }));

    // 전에는 토스트만 뜨고 4초 뒤 흔적이 없었다 — 사용자는 색이 저장된 줄 알았다.
    expect(await screen.findByText(COLOR_TOAST)).toBeInTheDocument();
    expect(await screen.findByText(COLOR_NOTICE)).toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "외부 미팅 색" });
    expect(trigger).toHaveAttribute("data-save-failed", "true");
    // **값 유지**(U-7) — 옛 색(mint)으로 되돌아 보이면 무엇을 고르려 했는지 사라진다.
    expect(trigger).toHaveAttribute("data-color-token", "amber");
    expect(calls).toHaveLength(1);
  });

  it(
    "표시는 **토스트가 사라지는 4초 뒤에도 화면에 남는다** — 시간 경과로 지워지지 않는다",
    async () => {
      const calls = blockPatch();
      renderPanel();

      await user().click(await screen.findByRole("button", { name: "외부 미팅 색" }));
      await user().click(await screen.findByRole("option", { name: "amber" }));
      expect(await screen.findByText(COLOR_NOTICE)).toBeInTheDocument();

      // 토스트 수명은 4초다(`09-design-tokens` §토스트). 그 뒤를 본다.
      await new Promise((resolve) => setTimeout(resolve, 4500));

      expect(screen.getByText(COLOR_NOTICE)).toBeInTheDocument();
      // **자동 재시도가 없다** — 기다리는 동안 요청이 하나도 더 나가지 않았다.
      expect(calls).toHaveLength(1);
    },
    15_000,
  );

  it("한 행에서 두 필드가 실패하면 **줄이 늘어난다** — 자리는 행 아래 하나다", async () => {
    blockPatch();
    renderPanel();

    const input = await screen.findByLabelText("외부 미팅 이름");
    await user().type(input, "-수정");
    await user().tab();
    expect(await screen.findByText(NAME_NOTICE)).toBeInTheDocument();

    await user().click(screen.getByRole("button", { name: "외부 미팅 색" }));
    await user().click(await screen.findByRole("option", { name: "amber" }));
    expect(await screen.findByText(COLOR_NOTICE)).toBeInTheDocument();

    // 자리는 하나(`role="alert"`)이고 그 안에 줄이 둘이다.
    const notice = screen.getByRole("alert");
    expect(within(notice).getAllByRole("button", { name: "다시 저장" })).toHaveLength(2);
  });

  it("「다시 저장」은 **정확히 1건**만 내고, 성공하면 표시가 사라진다", async () => {
    const calls = blockPatch();
    renderPanel();

    await user().click(await screen.findByRole("button", { name: "외부 미팅 색" }));
    await user().click(await screen.findByRole("option", { name: "amber" }));
    expect(await screen.findByText(COLOR_NOTICE)).toBeInTheDocument();
    expect(calls).toHaveLength(1);

    // 서버가 살아났다.
    server.use(
      http.patch(`${API_BASE}/api/work-types/${WORK_TYPE.id}`, async ({ request }) => {
        calls.push(await request.json());
        return HttpResponse.json({ ...WORK_TYPE, colorToken: "amber" });
      }),
    );

    await user().click(screen.getByRole("button", { name: "다시 저장" }));

    await waitFor(() => expect(screen.queryByText(COLOR_NOTICE)).not.toBeInTheDocument());
    // 처음 1건 + 「다시 저장」 1건. **누른 만큼만** 나갔다.
    expect(calls).toHaveLength(2);
    // 재요청 본문이 처음과 같다 — 무엇을 저장하려 했는지 잃지 않았다.
    expect(calls[1]).toEqual({ colorToken: "amber" });
  });
});

describe("④ 유형 설명 — AI 가 유형을 고르는 근거(MF-21 · SPEC-002 U-3)", () => {
  it("인라인 추가 행이 [종류][이름][**설명**][색] **네 필드**이고 설명은 **선택**이다 — 비어도 「추가」가 활성", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get(`${API_BASE}/api/work-types`, () => HttpResponse.json({ items: [WORK_TYPE] })),
      http.post(`${API_BASE}/api/work-types`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ ...WORK_TYPE, id: 9, name: "외부 검토" });
      }),
    );
    renderPanel();
    await user().click(await screen.findByRole("button", { name: "유형 추가" }));

    const kind = screen.getByRole("combobox", { name: "종류" });
    const name = screen.getByRole("textbox", { name: "유형 이름" });
    const description = screen.getByRole("textbox", { name: "유형 설명" });
    expect(description).toBeInTheDocument();

    await user().click(kind);
    await user().click(await screen.findByRole("option", { name: "업무" }));
    await user().type(name, "외부 검토");
    // **설명이 비어도 「추가」가 활성**이다
    expect(screen.getByRole("button", { name: "추가" })).toBeEnabled();

    await user().type(description, "외주 검토 요청을 다루는 일");
    await user().click(screen.getByRole("button", { name: "추가" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ kind: "task", name: "외부 검토", description: "외주 검토 요청을 다루는 일" });
  });

  it("설명을 비운 채 추가하면 **`description` 을 보내지 않는다** — 서버가 `null` 로 만든다", async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.get(`${API_BASE}/api/work-types`, () => HttpResponse.json({ items: [WORK_TYPE] })),
      http.post(`${API_BASE}/api/work-types`, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ ...WORK_TYPE, id: 9 });
      }),
    );
    renderPanel();
    await user().click(await screen.findByRole("button", { name: "유형 추가" }));
    await user().click(screen.getByRole("combobox", { name: "종류" }));
    await user().click(await screen.findByRole("option", { name: "업무" }));
    await user().type(screen.getByRole("textbox", { name: "유형 이름" }), "외부 검토");
    await user().click(screen.getByRole("button", { name: "추가" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(Object.keys(bodies[0])).not.toContain("description");
  });

  it("목록 행의 설명을 인라인으로 고치면 포커스 해제에 저장된다 · 비우면 `null` 을 보내고 「설명 없음」이 남는다", async () => {
    const bodies: unknown[] = [];
    let current = { ...WORK_TYPE };
    server.use(
      http.get(`${API_BASE}/api/work-types`, () => HttpResponse.json({ items: [current] })),
      http.patch(`${API_BASE}/api/work-types/4`, async ({ request }) => {
        const body = (await request.json()) as { description?: string | null };
        bodies.push(body);
        current = { ...current, description: (body.description ?? null) as string };
        return HttpResponse.json(current);
      }),
    );
    renderPanel();
    const field = await screen.findByRole("textbox", { name: "외부 미팅 설명" });
    expect(field).toHaveValue("고객사와 하는 회의");

    await user().clear(field);
    await user().type(field, "고객사 정기 미팅");
    await user().click(document.body);
    await waitFor(() => expect(bodies).toEqual([{ description: "고객사 정기 미팅" }]));

    const again = await screen.findByRole("textbox", { name: /설명/ });
    await user().clear(again);
    await user().click(document.body);
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toEqual({ description: null });
    expect(await screen.findByPlaceholderText("설명 없음")).toBeInTheDocument();
  });

  it("**기본 유형 3종도 설명은 편집된다** — 이름은 읽기 전용이고 삭제 버튼이 없다(A-4)", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get(`${API_BASE}/api/work-types`, () => HttpResponse.json({ items: [DEFAULT_TYPE] })),
      http.patch(`${API_BASE}/api/work-types/3`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ ...DEFAULT_TYPE, description: "AI 가 볼 설명" });
      }),
    );
    renderPanel();
    const description = await screen.findByRole("textbox", { name: "문서·보고 설명" });
    await user().type(description, "AI 가 볼 설명");
    await user().click(document.body);
    await waitFor(() => expect(bodies).toEqual([{ description: "AI 가 볼 설명" }]));

    // 이름은 편집 자리가 아니다 · 삭제 버튼도 없다
    expect(screen.queryByRole("textbox", { name: "문서·보고 이름" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "삭제" })).not.toBeInTheDocument();
  });

  it("설명 저장 실패는 **SPEC-002 U-7 규격**이다 — 토스트 + 행 아래 「다시 저장」 · 자동 재시도 0", async () => {
    const calls = blockPatch();
    renderPanel();
    const field = await screen.findByRole("textbox", { name: "외부 미팅 설명" });
    await user().clear(field);
    await user().type(field, "고친 설명");
    await user().click(document.body);

    expect(await screen.findByText("저장하지 못했습니다 · 유형 설명")).toBeInTheDocument();
    expect(await screen.findByText("유형 설명이 저장되지 않았습니다")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(calls).toHaveLength(1);
  });
});
