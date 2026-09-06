/**
 * **필수 테스트 ⑦ — v2 게이트**(`frontend/README.md` §11 7).
 *
 * > 감싼 요소를 조작하면 **네트워크 요청이 나가지 않고** 토스트만 뜬다.
 *
 * 「나가지 않는다」의 단언 방식 — MSW 를 `onUnhandledRequest:"error"` 로 세워 두고
 * **핸들러를 붙인 뒤 그 핸들러가 불리지 않았음**을 본다. 요청이 새면 핸들러가 불린다.
 */

import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { V2Gate } from "@/components/shared/V2Gate";
import { Toaster } from "@/components/ui/sonner";
import { apiFetch } from "@/lib/api/client";
import { API_BASE, server } from "@/test/server";

/** 게이트가 새면 실제로 호출될 자리. v1 서버에는 이 표면이 없다(SPEC-001 §4). */
function GatedButton({ onFire }: { onFire: () => void }) {
  return (
    <V2Gate reason="v2">
      <button
        type="button"
        onClick={() => {
          onFire();
          void apiFetch("/api/auth/sso", { method: "POST", publicSurface: true });
        }}
      >
        회사 계정으로 계속하기
      </button>
    </V2Gate>
  );
}

describe("⑦ v2 게이트 — 조작해도 요청이 나가지 않는다", () => {
  it("클릭하면 핸들러도 네트워크도 타지 않고 「v2에서 제공됩니다」만 뜬다", async () => {
    const serverHandler = vi.fn();
    const onFire = vi.fn();

    server.use(
      http.post(`${API_BASE}/api/auth/sso`, () => {
        serverHandler();
        return HttpResponse.json({});
      }),
    );

    render(
      <>
        <GatedButton onFire={onFire} />
        <Toaster />
      </>,
    );

    await userEvent.click(screen.getByRole("button", { name: "회사 계정으로 계속하기" }));

    // **네트워크 요청이 나가지 않는다** — 게이트가 이벤트를 가로챈다.
    expect(serverHandler).not.toHaveBeenCalled();
    // children 의 핸들러 자체가 실행되지 않았다(게이트는 capture 단계에서 멈춘다).
    expect(onFire).not.toHaveBeenCalled();
    expect(await screen.findByText("v2에서 제공됩니다")).toBeInTheDocument();
  });

  it("children 을 바꾸지 않는다 — 원래 요소를 그대로 그리고 자리도 유지한다", () => {
    render(<GatedButton onFire={vi.fn()} />);

    const button = screen.getByRole("button", { name: "회사 계정으로 계속하기" });
    // 숨기지 않고 다른 컴포넌트로 갈아치우지도 않는다(DEC-001 §v2 · U-2).
    expect(button).toBeVisible();
    // 회색 처리는 게이트가 얹는 한 겹이다 — 감싼 쪽에 붙는다.
    expect(button.closest("[data-v2-gate]")).toHaveAttribute("aria-disabled", "true");
  });

  it("연달아 눌러도 토스트는 하나만 남는다 — 중복 스택 금지", async () => {
    render(
      <>
        <GatedButton onFire={vi.fn()} />
        <Toaster />
      </>,
    );

    const button = screen.getByRole("button", { name: "회사 계정으로 계속하기" });
    await userEvent.click(button);
    await userEvent.click(button);
    await userEvent.click(button);

    expect(await screen.findAllByText("v2에서 제공됩니다")).toHaveLength(1);
  });

  it("문구는 둘뿐이다 — 홈·채팅은 「곧 제공됩니다」", async () => {
    render(
      <>
        <V2Gate reason="soon">
          <button type="button">홈</button>
        </V2Gate>
        <Toaster />
      </>,
    );

    await userEvent.click(screen.getByRole("button", { name: "홈" }));

    expect(await screen.findByText("곧 제공됩니다")).toBeInTheDocument();
  });
});
