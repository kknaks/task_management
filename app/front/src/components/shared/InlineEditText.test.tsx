/**
 * `InlineEditText` 의 **몫만** 본다 — 저장 시점(포커스 해제)·값 유지·재시도를 만들지 않음.
 *
 * **실패 표시는 이제 이 컴포넌트의 state 가 아니다**(SPEC-002 U-7 구현 규약 · 검수 F-1).
 * 소유자가 `saveFailed` 로 내려 주고, 캡션·「다시 저장」은 행 아래 인라인 자리 하나가 그린다 —
 * 그 전체 규격(토스트 + 필드 표시 + 자동 재시도 없음)은 `WorkTypePanel.test.tsx` 가 본다.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { InlineEditText } from "@/components/shared/InlineEditText";

describe("InlineEditText — 자동 저장 컨트롤의 몫", () => {
  it("포커스 해제 때 저장하고, 실패해도 값을 되돌리지 않는다", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("서버가 응답하지 않습니다"));

    render(<InlineEditText ariaLabel="유형 이름" value="외부 미팅" onSave={onSave} />);

    const input = screen.getByLabelText("유형 이름");
    await userEvent.clear(input);
    await userEvent.type(input, "외부 미팅(신규)");
    await userEvent.tab();

    expect(onSave).toHaveBeenCalledExactlyOnceWith("외부 미팅(신규)");
    // **값을 되돌리지 않는다** — 지우면 사용자가 다시 입력해야 한다.
    expect(input).toHaveValue("외부 미팅(신규)");
  });

  it("**자동 재시도를 만들지 않는다** — 실패해도 한 번뿐이다", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("실패"));

    render(<InlineEditText ariaLabel="유형 이름" value="외부 미팅" onSave={onSave} />);

    await userEvent.type(screen.getByLabelText("유형 이름"), "-수정");
    await userEvent.tab();

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("실패 표시는 **prop 으로 들어온다** — 내부 state 로 켜지지 않는다", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("실패"));

    const { rerender } = render(
      <InlineEditText ariaLabel="유형 이름" value="외부 미팅" onSave={onSave} />,
    );

    await userEvent.type(screen.getByLabelText("유형 이름"), "-수정");
    await userEvent.tab();

    // 저장이 거절됐지만 소유자가 아직 켜지 않았으므로 표시가 없다.
    expect(screen.getByLabelText("유형 이름")).toHaveAttribute("aria-invalid", "false");

    rerender(
      <InlineEditText ariaLabel="유형 이름" value="외부 미팅" onSave={onSave} saveFailed />,
    );
    expect(screen.getByLabelText("유형 이름")).toHaveAttribute("aria-invalid", "true");
  });

  it("값이 그대로면 요청을 만들지 않는다 — 포커스만 스쳐도 저장이 나가지 않는다", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<InlineEditText ariaLabel="유형 이름" value="외부 미팅" onSave={onSave} />);

    await userEvent.click(screen.getByLabelText("유형 이름"));
    await userEvent.tab();

    expect(onSave).not.toHaveBeenCalled();
  });

  it("기본 유형의 이름은 편집 컨트롤 자체가 없다 — 서버 판정과 두 겹으로 막는다", () => {
    render(
      <InlineEditText ariaLabel="개인 업무 이름" value="개인 업무" onSave={vi.fn()} readOnly />,
    );

    expect(screen.queryByLabelText("개인 업무 이름")).not.toBeInTheDocument();
    expect(screen.getByText("개인 업무")).toBeVisible();
  });
});
