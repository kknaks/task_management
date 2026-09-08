/**
 * **breadcrumb 링크 · 「←」**(WORK-014 Phase 1 · MF-7 · FE §6-3).
 *
 * - 앞 칸은 **링크**이고 마지막(지금 여기)만 링크가 아니다 — `<a>` 가 0건이면 반려다
 * - 키보드 `Tab` 으로 닿고 `Enter` 로 간다 · focus 표시가 있다
 * - 「←」는 **부모 라우트 `<a>`** 다(`router.back()` 이 아니다) — 새 탭에서 상세를 열어도 갈 곳이 있다
 * - 목록 화면(`backTo` 없음)에는 「←」가 없다
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  Breadcrumb,
  DetailHeaderBar,
  HOME_CRUMB,
  MEETINGS_CRUMB,
  MEETINGS_ROUTE,
} from "@/components/shared/AppShell";

describe("Breadcrumb — 앞 칸은 링크", () => {
  it("「홈」·「회의록」이 `<a>` 이고 마지막 제목만 `<span>` 이다", () => {
    render(<Breadcrumb trail={[HOME_CRUMB, MEETINGS_CRUMB, { label: "제품 소개서 리뷰" }]} />);
    const nav = screen.getByRole("navigation", { name: "현재 위치" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["홈", "회의록"]);
    expect(links).toHaveLength(2);
    // Next `Link` 가 뒤 슬래시를 정규화한다 — 라우트만 본다
    expect(links[0].getAttribute("href")).toMatch(/^\/tasks\/?$/);
    expect(links[1].getAttribute("href")).toMatch(/^\/meetings\/?$/);
    // 마지막은 「지금 여기」다 — 자기 자신으로 가는 링크를 두지 않는다
    expect(within(nav).getByText("제품 소개서 리뷰").tagName).toBe("SPAN");
  });

  it("`href` 를 준 마지막 칸도 링크가 아니다 · focus 표시가 있다", async () => {
    render(<Breadcrumb trail={[HOME_CRUMB, { label: "내 업무", href: "/tasks/" }]} />);
    const nav = screen.getByRole("navigation", { name: "현재 위치" });
    expect(within(nav).getAllByRole("link")).toHaveLength(1);
    expect(within(nav).getByText("내 업무").tagName).toBe("SPAN");

    // 키보드 `Tab` 이 닿고 focus 링이 보인다
    await userEvent.tab();
    const home = within(nav).getByRole("link", { name: "홈" });
    expect(home).toHaveFocus();
    expect(home.className).toContain("focus-visible:ring-2");
  });
});

describe("DetailHeaderBar — 「←」는 부모 라우트", () => {
  it("`backTo` 가 있으면 「←」가 그 주소의 `<a>` 다 — `router.back()` 이 아니다", () => {
    render(<DetailHeaderBar trail={[HOME_CRUMB, MEETINGS_CRUMB, { label: "제품 소개서 리뷰" }]} backTo={MEETINGS_ROUTE} />);
    const back = screen.getByRole("link", { name: "뒤로" });
    expect(back.getAttribute("href")).toMatch(/^\/meetings\/?$/);
    // breadcrumb 왼쪽에 있다
    expect(back.compareDocumentPosition(screen.getByRole("navigation", { name: "현재 위치" }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("**목록 화면은 `backTo` 를 넘기지 않는다** — 「←」가 없다", () => {
    render(<DetailHeaderBar trail={[HOME_CRUMB, { label: "회의록" }]} />);
    expect(screen.queryByRole("link", { name: "뒤로" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
