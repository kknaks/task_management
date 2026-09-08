"use client";

/**
 * **8px 색 dot** — 프로젝트 행이 쓴다(SPEC-002 U-5).
 *
 * 배지와 같은 렌더 계약이다 — `data-color-token` 만 받고 CSS 가 색을 고른다(§5-3).
 * dot 은 면 하나뿐이라 **전경색(`fg`)** 을 쓴다. 배경 틴트는 8px 에서 거의 보이지 않는다.
 */

import { cn } from "@/lib/utils";
import type { ColorToken } from "@/types/api";

export function ColorDot({
  colorToken,
  className,
}: {
  colorToken: ColorToken | string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-color-token={colorToken}
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full bg-palette-fg", className)}
    />
  );
}
