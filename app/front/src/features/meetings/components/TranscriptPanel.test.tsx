/**
 * **실시간 스크립트 패널**(WP Phase 5 검증 · SPEC-007 U-5 · U-6).
 *
 * - `scrollToRange(241000, 247300)` 로 **겹치는 블록 전부** 하이라이트(`#F4F5FF` + 「근거 구간」) · `Esc` 로 풀린다 · 대상 없으면 `false`
 * - 화자 색은 라벨 홀짝 · 시각은 `recordingStartedAt + atMs` 벽시계 · 잠정은 회색 + 캐럿, **시각 없음**
 * - 푸터 2종 · 빈 상태
 * - **종료 후**(SPEC-008 U-3) — `follow={false}` 면 새 블록이 와도 바닥으로 따라가지 않는다
 */

import { createRef } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { TranscriptPanel, speakerTone, type TranscriptPanelHandle } from "@/features/meetings/components/TranscriptPanel";
import type { TranscriptItem } from "@/features/meetings/types";

const STARTED = "2026-08-27T00:30:12Z";
const ITEMS: TranscriptItem[] = [
  { id: 298, speakerLabel: "1", atMs: 181_200, endMs: 187_900, content: "개정 대상 섹션부터 정리하고 가죠." },
  { id: 299, speakerLabel: "2", atMs: 241_000, endMs: 247_300, content: "도입 사례가 너무 길어요." },
  { id: 300, speakerLabel: "1", atMs: 246_000, endMs: 252_000, content: "그럼 별도 페이지로 분리하죠." },
  { id: 301, speakerLabel: "2", atMs: 480_000, endMs: 486_000, content: "디자인 반영본은 29일 오전까지." },
];

describe("블록 · 화자 · 시각", () => {
  it("「화자 n · HH:MM」 블록이 쌓이고 화자 색은 홀짝으로 갈린다 · 이름 입력 자리 없음", () => {
    render(<TranscriptPanel items={ITEMS} partial={null} recordingStartedAt={STARTED} paused={false} />);
    expect(screen.getAllByText("화자 1")).toHaveLength(2);
    expect(screen.getAllByText("화자 2")).toHaveLength(2);
    // 09:30:12 + 181.2s = 09:33
    expect(screen.getByText("09:33")).toBeInTheDocument();
    expect(screen.getAllByText("09:34")).toHaveLength(2);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(speakerTone("1")).toEqual({ dot: "bg-primary", text: "text-ai-bar-badge" });
    expect(speakerTone("2")).toEqual({ dot: "bg-dot-ai", text: "text-line-decision" });
    expect(speakerTone("3")).toEqual(speakerTone("1"));
    expect(screen.getByText("받아쓰기 중 · 확정된 발화는 바로 저장됩니다")).toBeInTheDocument();
  });

  it("잠정 발화는 회색 본문 + 캐럿, **시각이 없다** · 일시정지 푸터", () => {
    render(
      <TranscriptPanel items={ITEMS.slice(0, 1)} partial={[{ speakerLabel: "2", atMs: 752_000, text: "좋습니다. 그러면" }]} recordingStartedAt={STARTED} paused />,
    );
    const partial = document.querySelector("[data-partial]") as HTMLElement;
    expect(partial).toHaveTextContent("화자 2");
    expect(partial).toHaveTextContent("좋습니다. 그러면");
    // 09:30:12 + 752s = 09:42 — 잠정에는 찍히지 않는다
    expect(screen.queryByText("09:42")).not.toBeInTheDocument();
    expect(screen.getByText("일시정지 중 · 받아쓰기가 멈춰 있습니다")).toBeInTheDocument();
  });

  it("비어 있으면 「아직 발화가 없습니다」", () => {
    render(<TranscriptPanel items={[]} partial={null} recordingStartedAt={STARTED} paused={false} />);
    expect(screen.getByText("아직 발화가 없습니다")).toBeInTheDocument();
  });
});

describe("scrollToRange — 근거 구간 하이라이트", () => {
  it("`[241000, 247300]` 과 겹치는 블록 **둘**이 하이라이트되고 「근거 구간」이 붙는다 · `Esc` 로 풀린다", async () => {
    const ref = createRef<TranscriptPanelHandle>();
    render(<TranscriptPanel ref={ref} items={ITEMS} partial={null} recordingStartedAt={STARTED} paused={false} />);

    let found = false;
    act(() => {
      found = ref.current!.scrollToRange(241_000, 247_300);
    });
    expect(found).toBe(true);
    const marked = document.querySelectorAll("[data-highlighted]");
    expect([...marked].map((el) => el.getAttribute("data-transcript-id"))).toEqual(["299", "300"]);
    expect(screen.getAllByText("근거 구간")).toHaveLength(2);

    await userEvent.keyboard("{Escape}");
    expect(document.querySelectorAll("[data-highlighted]")).toHaveLength(0);
    expect(screen.queryByText("근거 구간")).not.toBeInTheDocument();
  });

  it("다음 호출이 이전 하이라이트를 **대체**하고, 대상이 없으면 `false` 이고 하이라이트가 그대로다", () => {
    const ref = createRef<TranscriptPanelHandle>();
    render(<TranscriptPanel ref={ref} items={ITEMS} partial={null} recordingStartedAt={STARTED} paused={false} />);
    act(() => {
      ref.current!.scrollToRange(181_000, 182_000);
    });
    expect([...document.querySelectorAll("[data-highlighted]")].map((el) => el.getAttribute("data-transcript-id"))).toEqual(["298"]);

    let found = true;
    act(() => {
      found = ref.current!.scrollToRange(900_000, 901_000);
    });
    expect(found).toBe(false);
    expect([...document.querySelectorAll("[data-highlighted]")].map((el) => el.getAttribute("data-transcript-id"))).toEqual(["298"]);

    act(() => {
      ref.current!.scrollToRange(480_000, 481_000);
    });
    expect([...document.querySelectorAll("[data-highlighted]")].map((el) => el.getAttribute("data-transcript-id"))).toEqual(["301"]);
  });
});

describe("자동 따라가기 — 회의 중만(SPEC-008 U-3)", () => {
  /** jsdom 은 레이아웃이 없다 — 스크롤 가능한 상자를 흉내 낸다. */
  function scroller() {
    const el = document.querySelector("[data-transcript-scroller]") as HTMLElement;
    Object.defineProperty(el, "scrollHeight", { value: 900, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: 300, configurable: true });
    return el;
  }

  it("회의 중(`follow` 기본값)은 새 블록에서 바닥으로 따라간다", () => {
    const { rerender } = render(<TranscriptPanel items={ITEMS.slice(0, 2)} partial={null} recordingStartedAt={STARTED} paused={false} />);
    const el = scroller();
    el.scrollTop = 0;
    rerender(<TranscriptPanel items={ITEMS} partial={null} recordingStartedAt={STARTED} paused={false} />);
    expect(el.scrollTop).toBe(900);
  });

  it("**종료 후**(`follow={false}`)는 새 블록이 와도 스크롤을 건드리지 않는다", () => {
    const { rerender } = render(
      <TranscriptPanel items={ITEMS.slice(0, 2)} partial={null} recordingStartedAt={STARTED} paused follow={false} footer={<span>전체 스크립트 9분 · 화자 2명</span>} />,
    );
    const el = scroller();
    el.scrollTop = 0;
    rerender(
      <TranscriptPanel items={ITEMS} partial={null} recordingStartedAt={STARTED} paused follow={false} footer={<span>전체 스크립트 9분 · 화자 2명</span>} />,
    );
    expect(el.scrollTop).toBe(0);
    expect(screen.getByText("전체 스크립트 9분 · 화자 2명")).toBeInTheDocument();
    expect(screen.queryByText("받아쓰기 중 · 확정된 발화는 바로 저장됩니다")).not.toBeInTheDocument();
  });
});
