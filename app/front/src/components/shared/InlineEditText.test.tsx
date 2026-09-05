/**
 * **필수 테스트 ③ — 자동 저장 실패**(`frontend/README.md` §11 3 · SPEC-002 U-7).
 *
 * > 실패 응답에 **토스트 + 그 필드의 실패 표시**가 함께 뜨고 **재시도가 나가지 않는다**.
 *
 * 토스트는 필드 이름을 아는 **호출자**가 띄우므로(패널), 여기서는 이 컴포넌트가 지는 몫을 본다 —
 * 필드 실패 표시가 남는가, **자동 재시도가 없는가**, 해제 조건 둘이 지켜지는가.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { InlineEditText } from "@/components/shared/InlineEditText";

const FAILURE = "저장되지 않았습니다";

describe("U-7 자동 저장 실패 표시", () => {
  it("저장이 실패하면 필드에 표시가 남고 값이 유지된다 — 자동 재시도가 없다", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("서버가 응답하지 않습니다"));

    render(<InlineEditText ariaLabel="유형 이름" value="외부 미팅" onSave={onSave} />);

    const input = screen.getByLabelText("유형 이름");
    await userEvent.clear(input);
    await userEvent.type(input, "외부 미팅(신규)");
    // 포커스 해제 = 저장 시점(DEC-001 §5)
    await userEvent.tab();

    expect(await screen.findByText(FAILURE)).toBeInTheDocument();
    // **값을 되돌리지 않는다** — 지우면 사용자가 다시 입력해야 한다.
    expect(input).toHaveValue("외부 미팅(신규)");
    expect(input).toHaveAttribute("aria-invalid", "true");

    // **자동 재시도가 없다**(DEC-001 §7 · FE §3-2 `retry:false`). 시간이 지나도 한 번뿐이다.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("표시는 시간 경과로 사라지지 않고, 다른 곳을 만져도 남는다", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("실패"));

    render(
      <>
        <InlineEditText ariaLabel="유형 이름" value="외부 미팅" onSave={onSave} />
        <button type="button">다른 컨트롤</button>
      </>,
    );

    const input = screen.getByLabelText("유형 이름");
    await userEvent.type(input, "-수정");
    await userEvent.tab();
    expect(await screen.findByText(FAILURE)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "다른 컨트롤" }));
    await new Promise((resolve) => setTimeout(resolve, 60));

    // 해제 조건은 「다시 저장 성공」·「재편집 후 저장 성공」 **둘뿐**이다.
    expect(screen.getByText(FAILURE)).toBeInTheDocument();
  });

  it("「다시 저장」은 누를 때만 한 번 나가고, 성공하면 표시가 사라진다 — 해제 조건 ①", async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new Error("실패"))
      .mockResolvedValueOnce(undefined);

    render(<InlineEditText ariaLabel="유형 이름" value="외부 미팅" onSave={onSave} />);

    const input = screen.getByLabelText("유형 이름");
    await userEvent.type(input, "-수정");
    await userEvent.tab();
    expect(await screen.findByText(FAILURE)).toBeInTheDocument();
    expect(onSave).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "다시 저장" }));

    expect(await screen.findByLabelText("유형 이름")).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByText(FAILURE)).not.toBeInTheDocument();
    expect(onSave).toHaveBeenCalledTimes(2); // 누른 만큼만
  });

  it("그 필드를 다시 편집해 저장이 성공해도 표시가 사라진다 — 해제 조건 ②", async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new Error("실패"))
      .mockResolvedValueOnce(undefined);

    render(<InlineEditText ariaLabel="유형 이름" value="외부 미팅" onSave={onSave} />);

    const input = screen.getByLabelText("유형 이름");
    await userEvent.type(input, "-1");
    await userEvent.tab();
    expect(await screen.findByText(FAILURE)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("유형 이름"), "-2");
    await userEvent.tab();

    expect(screen.queryByText(FAILURE)).not.toBeInTheDocument();
  });

  it("값이 그대로면 요청을 만들지 않는다 — 포커스만 스쳐도 저장이 나가지 않는다", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<InlineEditText ariaLabel="유형 이름" value="외부 미팅" onSave={onSave} />);

    await userEvent.click(screen.getByLabelText("유형 이름"));
    await userEvent.tab();

    expect(onSave).not.toHaveBeenCalled();
  });

  it("기본 유형의 이름은 편집 컨트롤 자체가 없다 — 서버 판정과 두 겹으로 막는다", () => {
    const onSave = vi.fn();

    render(
      <InlineEditText ariaLabel="개인 업무 이름" value="개인 업무" onSave={onSave} readOnly />,
    );

    expect(screen.queryByLabelText("개인 업무 이름")).not.toBeInTheDocument();
    expect(screen.getByText("개인 업무")).toBeVisible();
  });
});
