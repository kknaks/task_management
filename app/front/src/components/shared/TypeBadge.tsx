"use client";

/**
 * **S-09 유형 배지** — `09-design-tokens.md` §상태·유형 「유형 배지 h20 r4 11px/600」.
 *
 * 색은 **`data-color-token` 으로만** 고른다 — CSS 가 `--tm-palette-bg`/`-fg` 쌍을 골라 준다
 * (frontend/README.md §5-3 · SPEC-002 §4 렌더 계약). **인라인 `style` 로 hex 를 넣지 않는다**
 * (§11 금지 목록 4). 팔레트에 없는 토큰명이 오면 CSS 기본 선언이 **중립 색**으로 떨어뜨리고
 * 항목을 숨기지 않는다.
 *
 * `TypeBadge`(S-09)의 **고정 4종은 폐기**됐다(§A-1) — 색은 사용자가 고른 런타임 값이다.
 */

import { cn } from "@/lib/utils";
import type { ColorToken } from "@/types/api";

export function TypeBadge({
  name,
  colorToken,
  className,
}: {
  name: string;
  /**
   * 팔레트 토큰명. **검증하지 않는다** — 팔레트 밖 값이 와도 CSS 가 중립으로 떨어뜨리므로
   * 여기서 걸러 내면 「항목이 사라진다」가 된다(§5-3 규칙 4).
   */
  colorToken: ColorToken | string;
  className?: string;
}) {
  return (
    <span
      data-color-token={colorToken}
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-chip px-2 text-badge",
        "bg-palette-bg text-palette-fg",
        className,
      )}
    >
      {name}
    </span>
  );
}
