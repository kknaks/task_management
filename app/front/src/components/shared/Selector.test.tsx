/**
 * **셀렉터 하단 「+ 새 프로젝트로 추가」 인라인 행 — SPEC-006 U-3 규격 대조**(WORK-006 Phase 5).
 *
 * > 36px 행 → [색 트리거 28][이름][추가] · `Enter`/「추가」 → 즉시 선택 + 팝오버 닫힘 ·
 * > 실패 인라인 + 입력 유지 · `Esc` 복귀.
 *
 * **전 영역 공통**이라 업무 생성 드로어도 이 행을 쓴다 — 여기서 닫아 두면 두 드로어가 같이 맞는다.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Selector, type SelectorOption } from "@/components/shared/Selector";
import { API_ERROR_CODE, ApiError } from "@/lib/api/errors";

const OPTIONS: SelectorOption[] = [{ id: 5, name: "소개서 개정", colorToken: "violet" }];

function setup(onCreate: (input: { name: string }) => Promise<SelectorOption | null>) {
  const onSelect = vi.fn();
  render(
    <Selector
      label="프로젝트"
      placeholder="프로젝트 없음"
      value={null}
      options={OPTIONS}
      clearable
      onSelect={onSelect}
      onCreate={onCreate}
      createErrorMessage={(error) =>
        error instanceof ApiError && error.code === API_ERROR_CODE.DUPLICATE_NAME
          ? "같은 이름의 프로젝트가 이미 있습니다"
          : null
      }
    />,
  );
  return { onSelect };
}

describe("U-3 인라인 행", () => {
  it("접힌 행 「+ 새 프로젝트로 추가」를 누르면 색 트리거 + 이름 입력 + 「추가」로 바뀐다", async () => {
    setup(async () => null);
    await userEvent.click(screen.getByRole("button", { name: "프로젝트" }));

    // 접힌 상태에는 입력이 없다.
    expect(screen.queryByRole("textbox", { name: "새 프로젝트 이름" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "새 프로젝트로 추가" }));

    expect(screen.getByRole("textbox", { name: "새 프로젝트 이름" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "새 프로젝트 색" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "추가" })).toBeInTheDocument();
  });

  it("`Enter` 로 만들면 **즉시 선택**되고 팝오버가 닫힌다", async () => {
    const onCreate = vi.fn(async ({ name }: { name: string }) => ({ id: 9, name, colorToken: "indigo" }));
    const { onSelect } = setup(onCreate);
    await userEvent.click(screen.getByRole("button", { name: "프로젝트" }));
    await userEvent.click(screen.getByRole("button", { name: "새 프로젝트로 추가" }));

    await userEvent.type(screen.getByRole("textbox", { name: "새 프로젝트 이름" }), "온보딩 개선{Enter}");

    expect(onCreate).toHaveBeenCalledWith({ name: "온보딩 개선", colorToken: "indigo" });
    expect(onSelect).toHaveBeenCalledWith({ id: 9, name: "온보딩 개선", colorToken: "indigo" });
    // 팝오버가 닫혔다 — 목록이 사라진다.
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("같은 이름이면 **행 아래 인라인 문구**가 뜨고 **입력이 남는다**", async () => {
    const { onSelect } = setup(async () => {
      throw new ApiError(409, API_ERROR_CODE.DUPLICATE_NAME, "같은 이름");
    });
    await userEvent.click(screen.getByRole("button", { name: "프로젝트" }));
    await userEvent.click(screen.getByRole("button", { name: "새 프로젝트로 추가" }));
    const input = screen.getByRole("textbox", { name: "새 프로젝트 이름" });

    await userEvent.type(input, "소개서 개정{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("같은 이름의 프로젝트가 이미 있습니다");
    expect(input).toHaveValue("소개서 개정");
    expect(onSelect).not.toHaveBeenCalled();
    // 팝오버는 열린 채다.
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("`Esc` 는 행을 원래 항목으로 되돌린다 — 팝오버는 그대로", async () => {
    setup(async () => null);
    await userEvent.click(screen.getByRole("button", { name: "프로젝트" }));
    await userEvent.click(screen.getByRole("button", { name: "새 프로젝트로 추가" }));
    await userEvent.type(screen.getByRole("textbox", { name: "새 프로젝트 이름" }), "임시");

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("textbox", { name: "새 프로젝트 이름" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "새 프로젝트로 추가" })).toBeInTheDocument();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("`onCreate` 가 없으면 인라인 행 자체가 없다 — 유형 셀렉터", async () => {
    render(
      <Selector label="유형" placeholder="유형" value={null} options={OPTIONS} onSelect={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "유형" }));
    expect(screen.queryByRole("button", { name: "새 프로젝트로 추가" })).not.toBeInTheDocument();
  });
});
