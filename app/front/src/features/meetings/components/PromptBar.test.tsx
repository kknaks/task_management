/**
 * **프롬프트 바 · `/` 팝오버**(SPEC-007 U-3 · WP Phase 5 검증).
 *
 * - `/` → 팝오버 **4종**(논의 · 결정 · **업무** · 액션) + 「새 안건」 + 「다른 안건으로 이동」 행 · 「+」 버튼 없음
 * - 그냥 치고 `Enter` → 논의 · 종류를 고르면 그 종류 · `Shift+Enter` 무시 · 실패면 입력 유지
 * - 「새 안건」 → 제목 입력 → `onCreateAgenda` · 이동 행 → `onActivateAgenda`
 * - 활성 안건 없음 → 칩 「안건 선택」 + 전송 비활성 + 팝오버에 「새 안건」만
 * - **슬래시 명령어 5**(WORK-011 · U-3) — `/결` 좁힘 · `/결정 ` 칩 · 백스페이스 복귀 · 그 밖의 `/…` 는 본문 ·
 *   팝오버와 **DOM 상 같은 상태** · 「안건 이동」은 명령어에 없다 · 안건 없으면 `/새안건` 만 칩
 */

import { cleanup, render, screen, within } from "@testing-library/react";
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

describe("슬래시 명령어 5개 · 좁혀지는 팝오버", () => {
  it("`/결` 까지 치면 팝오버가 「결정」만 남는다 · `/새` 는 「새 안건」만 · 이동 행은 좁히는 순간 빠진다", async () => {
    setup();
    const input = screen.getByRole("combobox", { name: "줄 입력" });
    await userEvent.type(input, "/결");
    const list = await screen.findByRole("listbox", { name: "종류 선택" });
    expect(within(list).getAllByRole("option").map((option) => option.textContent)).toEqual(["결결정"]);

    await userEvent.clear(input);
    await userEvent.type(input, "/새");
    expect(within(await screen.findByRole("listbox")).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "안새 안건다음 주제로",
    ]);
  });

  it("`/결정 `(스페이스) → 명령어 문자열이 사라지고 **[결정] 칩** · `Enter` 로 `kind:'decision'` · 백스페이스로 `/결정` 텍스트 복귀", async () => {
    const props = setup();
    const input = screen.getByRole("combobox", { name: "줄 입력" });
    await userEvent.type(input, "/결정 ");
    expect(screen.getByText("결정")).toBeInTheDocument();
    expect(input).toHaveValue("");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await userEvent.type(input, "3건만 유지한다{Enter}");
    expect(props.onSendLine).toHaveBeenCalledWith("decision", "3건만 유지한다");
    // 본문에 명령어 문자열이 실리지 않는다
    expect(props.onSendLine).not.toHaveBeenCalledWith("decision", expect.stringContaining("/결정"));

    // 칩이 붙은 빈 입력에서 백스페이스 → 명령어 텍스트로 되돌아간다
    await userEvent.type(input, "/액션 ");
    expect(screen.getByText("액션")).toBeInTheDocument();
    await userEvent.type(input, "{Backspace}");
    expect(input).toHaveValue("/액션");
    expect(screen.queryByText("액션")).not.toBeInTheDocument();
  });

  it("그 밖의 `/…` 는 **그대로 본문**이다 — `/api 경로를 바꾸자` · `/ㅁㄴㅇㄹ 어쩌고` · `/논의 /api` → [논의] + 본문 `/api`", async () => {
    const props = setup();
    const input = screen.getByRole("combobox", { name: "줄 입력" });
    await userEvent.type(input, "/api 경로를 바꾸자{Enter}");
    expect(props.onSendLine).toHaveBeenLastCalledWith("discussion", "/api 경로를 바꾸자");

    await userEvent.type(input, "/ㅁㄴㅇㄹ 어쩌고{Enter}");
    expect(props.onSendLine).toHaveBeenLastCalledWith("discussion", "/ㅁㄴㅇㄹ 어쩌고");

    await userEvent.type(input, "/논의 /api{Enter}");
    expect(props.onSendLine).toHaveBeenLastCalledWith("discussion", "/api");
    expect(props.onCreateAgenda).not.toHaveBeenCalled();
  });

  it("**「안건 이동」은 슬래시로 하지 않는다** — `/안건 ` · `/이동 ` 은 본문이고 `onActivateAgenda` 가 0건이다", async () => {
    const props = setup();
    const input = screen.getByRole("combobox", { name: "줄 입력" });
    await userEvent.type(input, "/안건 2로{Enter}");
    expect(props.onActivateAgenda).not.toHaveBeenCalled();
    expect(props.onSendLine).toHaveBeenLastCalledWith("discussion", "/안건 2로");

    await userEvent.type(input, "/이동 {Enter}");
    expect(props.onActivateAgenda).not.toHaveBeenCalled();
    expect(props.onSendLine).toHaveBeenLastCalledWith("discussion", "/이동");
  });

  it("`/새안건 <제목>` `Enter` → `onCreateAgenda` · 줄 전송은 0건", async () => {
    const props = setup();
    const input = screen.getByRole("combobox", { name: "줄 입력" });
    await userEvent.type(input, "/새안건 ");
    expect(screen.getByText("새 안건")).toBeInTheDocument();
    const title = screen.getByRole("combobox", { name: "안건 제목" });
    expect(title).toHaveAttribute("placeholder", "안건 제목");
    await userEvent.type(title, "가격 표기 처리{Enter}");
    expect(props.onCreateAgenda).toHaveBeenCalledWith("가격 표기 처리");
    expect(props.onSendLine).not.toHaveBeenCalled();
  });

  it("팝오버로 고른 상태와 명령어로 고른 상태가 **DOM 상 같다** — 같은 칩 · 같은 요청 본문", async () => {
    // React `useId` 와 프롬프트 바 현재 시각만 지우고 비교한다 — 나머지가 한 글자라도 다르면 실패한다
    const normalize = (html: string) => html.replace(/_r_[0-9a-z]+_|:r[0-9a-z]+:/g, "id").replace(/\d\d:\d\d/g, "HH:MM");

    const first = setup();
    const input = screen.getByRole("combobox", { name: "줄 입력" });
    await userEvent.type(input, "/");
    await userEvent.click(await screen.findByRole("option", { name: "결정" }));
    await userEvent.type(input, "3건만 유지한다");
    const viaPopover = normalize(document.body.innerHTML);
    await userEvent.type(input, "{Enter}");
    expect(first.onSendLine).toHaveBeenCalledWith("decision", "3건만 유지한다");
    cleanup();

    const second = setup();
    const commandInput = screen.getByRole("combobox", { name: "줄 입력" });
    await userEvent.type(commandInput, "/결정 3건만 유지한다");
    expect(normalize(document.body.innerHTML)).toBe(viaPopover);
    await userEvent.type(commandInput, "{Enter}");
    expect(second.onSendLine).toHaveBeenCalledWith("decision", "3건만 유지한다");
  });

  it("**안건이 없으면** `/새안건` 만 칩이 되고 나머지 넷은 그대로 텍스트다", async () => {
    const props = setup({ agendas: [], activeAgendaId: null });
    const input = screen.getByRole("combobox", { name: "줄 입력" });
    await userEvent.type(input, "/논의 메모");
    expect(input).toHaveValue("/논의 메모");
    expect(screen.queryByText("논의")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "전송" })).toBeDisabled();

    await userEvent.clear(input);
    await userEvent.type(input, "/새안건 ");
    expect(screen.getByText("새 안건")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("combobox", { name: "안건 제목" }), "첫 안건{Enter}");
    expect(props.onCreateAgenda).toHaveBeenCalledWith("첫 안건");
    expect(props.onSendLine).not.toHaveBeenCalled();
  });
});
