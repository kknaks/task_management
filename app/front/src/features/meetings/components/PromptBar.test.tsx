/**
 * **프롬프트 바 · `/` 팝오버**(SPEC-007 U-3 · WP Phase 5 검증).
 *
 * - `/` → 팝오버 **4종**(논의 · 결정 · **업무** · 액션) + 「새 안건」 + 「다른 안건으로 이동」 행 · 「+」 버튼 없음
 * - 그냥 치고 `Enter` → 논의 · 종류를 고르면 그 종류 · `Shift+Enter` 무시 · 실패면 입력 유지
 * - 「새 안건」 → 제목 입력 → `onCreateAgenda` · 이동 행 → `onActivateAgenda`
 * - 활성 안건 없음 → 칩 「안건 선택」 + 전송 비활성 + 팝오버에 「새 안건」만
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PromptBar } from "@/features/meetings/components/PromptBar";
import type { MeetingAgenda } from "@/features/meetings/types";

const AGENDAS: MeetingAgenda[] = [
  { id: 301, track: "human", title: "개정 대상 섹션 확정", orderIndex: 0, state: "done", sourceAgendaId: null, lines: [] },
  { id: 302, track: "human", title: "디자인 반영 일정", orderIndex: 1, state: "active", sourceAgendaId: null, lines: [] },
  { id: 303, track: "human", title: "가격 표기", orderIndex: 2, state: "next", sourceAgendaId: null, lines: [] },
];

function setup(overrides: Partial<React.ComponentProps<typeof PromptBar>> = {}) {
  const props = {
    agendas: AGENDAS,
    activeAgendaId: 302,
    onSendLine: vi.fn(async () => true),
    onCreateAgenda: vi.fn(async () => true),
    onActivateAgenda: vi.fn(async () => true),
    ...overrides,
  };
  render(<PromptBar {...props} />);
  return props;
}

describe("기본 · 전송", () => {
  it("칩 「안건 2」 · 「+」 버튼 없음 · 그냥 치고 `Enter` 하면 **논의**로 나가고 입력이 비워진다", async () => {
    const props = setup();
    expect(screen.getByRole("button", { name: /안건 2/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "추가" })).not.toBeInTheDocument();
    const input = screen.getByRole("combobox", { name: "줄 입력" });
    await userEvent.type(input, "가격은 현행 유지{Enter}");
    expect(props.onSendLine).toHaveBeenCalledWith("discussion", "가격은 현행 유지");
    expect(input).toHaveValue("");
  });

  it("`Shift+Enter` 는 무시되고 실패하면 입력이 남는다", async () => {
    const props = setup({ onSendLine: vi.fn(async () => false) });
    const input = screen.getByRole("combobox", { name: "줄 입력" });
    await userEvent.type(input, "메모{Shift>}{Enter}{/Shift}");
    expect(props.onSendLine).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "전송" }));
    expect(props.onSendLine).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("메모");
  });

  it("전송 중이면 입력·버튼이 잠긴다", () => {
    setup({ sending: true });
    expect(screen.getByRole("combobox", { name: "줄 입력" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "전송" })).toBeDisabled();
  });
});

describe("`/` 팝오버", () => {
  it("**4종**(논의 · 결정 · 업무 · 액션) + 「새 안건」 + 활성 아닌 안건 행 둘 · 머리 「안건 2 아래에 추가」", async () => {
    setup();
    await userEvent.type(screen.getByRole("combobox", { name: "줄 입력" }), "/");
    const list = await screen.findByRole("listbox", { name: "종류 선택" });
    const options = within(list).getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["논논의", "결결정", "업업무", "액액션", "안새 안건다음 주제로", "안건 1개정 대상 섹션 확정", "안건 3가격 표기"]);
    expect(within(list).getByText("안건 2 아래에 추가")).toBeInTheDocument();
    expect(within(list).getByText("다른 안건으로 이동")).toBeInTheDocument();
  });

  it("「결정」을 고르면 라벨이 붙고 `Enter` 로 **결정** 줄이 나간다 · `↓` 로 「업무」를 고를 수 있다", async () => {
    const props = setup();
    const input = screen.getByRole("combobox", { name: "줄 입력" });
    await userEvent.type(input, "/");
    await userEvent.click(await screen.findByRole("option", { name: "결정" }));
    expect(screen.getByText("결정")).toBeInTheDocument();
    expect(input).toHaveValue("");
    await userEvent.type(input, "3건만 유지한다{Enter}");
    expect(props.onSendLine).toHaveBeenCalledWith("decision", "3건만 유지한다");

    await userEvent.type(input, "/");
    await screen.findByRole("listbox");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(screen.getByText("업무")).toBeInTheDocument();
    await userEvent.type(input, "문구 정리{Enter}");
    expect(props.onSendLine).toHaveBeenLastCalledWith("task", "문구 정리");
  });

  it("「새 안건」 → 플레이스홀더 「안건 제목」 → `Enter` 로 `onCreateAgenda`", async () => {
    const props = setup();
    await userEvent.type(screen.getByRole("combobox", { name: "줄 입력" }), "/");
    await userEvent.click(await screen.findByRole("option", { name: /새 안건/ }));
    const title = screen.getByRole("combobox", { name: "안건 제목" });
    expect(title).toHaveAttribute("placeholder", "안건 제목");
    await userEvent.type(title, "가격 표기 처리{Enter}");
    expect(props.onCreateAgenda).toHaveBeenCalledWith("가격 표기 처리");
    expect(props.onSendLine).not.toHaveBeenCalled();
  });

  it("이동 행 → `onActivateAgenda(303)` · 칩 클릭은 이동 절만 연다", async () => {
    const props = setup();
    await userEvent.type(screen.getByRole("combobox", { name: "줄 입력" }), "/");
    await userEvent.click(await screen.findByRole("option", { name: /안건 3/ }));
    expect(props.onActivateAgenda).toHaveBeenCalledWith(303);

    await userEvent.click(screen.getByRole("button", { name: /안건 2/ }));
    const list = await screen.findByRole("listbox");
    expect(within(list).queryByRole("option", { name: "논의" })).not.toBeInTheDocument();
    expect(within(list).getAllByRole("option")).toHaveLength(2);
  });

  it("`Esc` 로 닫힌다", async () => {
    setup();
    const input = screen.getByRole("combobox", { name: "줄 입력" });
    await userEvent.type(input, "/");
    await screen.findByRole("listbox");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveValue("");
  });
});

describe("활성 안건 없음", () => {
  it("칩 「안건 선택」 · 전송 비활성 · 팝오버에는 「새 안건」만", async () => {
    setup({ agendas: [], activeAgendaId: null });
    expect(screen.getByRole("button", { name: "안건 선택" })).toBeInTheDocument();
    const input = screen.getByRole("combobox", { name: "줄 입력" });
    await userEvent.type(input, "메모");
    expect(screen.getByRole("button", { name: "전송" })).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, "/");
    const list = await screen.findByRole("listbox");
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["안새 안건다음 주제로"]);
  });
});
