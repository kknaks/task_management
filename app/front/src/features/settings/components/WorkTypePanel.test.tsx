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
  isDefault: false,
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
