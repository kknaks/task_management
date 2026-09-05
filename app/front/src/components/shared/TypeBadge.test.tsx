/**
 * **색 렌더 계약**(frontend/README.md §5-3 · SPEC-002 §4 렌더 계약).
 *
 * > 배지·칩·dot 은 **토큰명으로 색을 고른다.** 화면도 hex 를 인라인 스타일로 쓰지 않는다.
 * > 팔레트에 없는 토큰명이 오면(옛 값 등) **중립으로 떨어뜨리되 항목을 숨기지 않는다.**
 *
 * jsdom 은 Tailwind·`tokens.css` 를 로드하지 않으므로 「보이는 색」은 볼 수 없다. 대신 **계약**을
 * 본다 — `data-color-token` 이 붙는가, 인라인 hex 가 없는가, 모르는 토큰에도 항목이 남는가.
 * 실제 색 값은 `tokens.css` 의 `[data-color-token="…"]` 규칙이 정하고 그 값은 앱 창에서 확인한다.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ColorDot } from "@/components/shared/ColorDot";
import { TypeBadge } from "@/components/shared/TypeBadge";
import { PALETTE_TOKENS } from "@/lib/palette";

describe("색 렌더 — data-color-token 으로만 고른다", () => {
  it("팔레트 8종 전부가 자기 토큰명을 속성으로 싣는다", () => {
    render(
      <>
        {PALETTE_TOKENS.map((token) => (
          <TypeBadge key={token} name={token} colorToken={token} />
        ))}
      </>,
    );

    expect(PALETTE_TOKENS).toHaveLength(8);
    for (const token of PALETTE_TOKENS) {
      expect(screen.getByText(token)).toHaveAttribute("data-color-token", token);
    }
  });

  it("배지에 인라인 style 로 색을 넣지 않는다", () => {
    render(<TypeBadge name="외부 미팅" colorToken="mint" />);

    const badge = screen.getByText("외부 미팅");
    // `style` 속성 자체가 없어야 한다 — hex 가 컴포넌트에 들어오는 순간 팔레트 제약이 사라진다.
    expect(badge).not.toHaveAttribute("style");
    expect(badge.outerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("팔레트에 없는 토큰명이 와도 항목이 사라지지 않는다 — 중립으로 떨어진다", () => {
    // 삭제된 유형의 옛 값 등. CSS 의 `[data-color-token]` 기본 선언이 중립을 준다.
    render(<TypeBadge name="옛 유형" colorToken="chartreuse-없는색" />);

    const badge = screen.getByText("옛 유형");
    expect(badge).toBeVisible();
    expect(badge).toHaveAttribute("data-color-token", "chartreuse-없는색");
  });

  it("dot 도 같은 계약을 따른다", () => {
    const { container } = render(<ColorDot colorToken="violet" />);

    const dot = container.querySelector("[data-color-token]");
    expect(dot).toHaveAttribute("data-color-token", "violet");
    expect(dot).not.toHaveAttribute("style");
  });
});
