"use client";

/**
 * 로고 마크 — 원본의 「M」 사각 + 「Managment」(`로그인 · 계정 · 프로필.dc.html [로그인]`).
 * 제품명 표기는 디자인 원본 철자를 그대로 쓴다.
 *
 * 브랜드 패널과 1280 구간의 폼 상단이 같은 마크를 쓰므로 컴포넌트로 뺐다.
 *
 * **규격이 두 벌이다** — 시안이 자리마다 다른 크기를 쓴다. 하나로 뭉개지 않는다.
 *
 * | `size` | 마크 | 「M」 | 제품명 | gap | 어디 |
 * |---|---|---|---|---|---|
 * | `md`(기본) | 32 · r8 | 16/800 | 20/800/-0.01em | 11 | 로그인 브랜드 패널·1280 폼 상단 |
 * | `sm` | 25 · r6 | 13/800 | 17/800/-0.01em | 8 | **사이드바**(`업무 화면 정의서.dc.html` 27~28줄) |
 *
 * 마크 바탕은 단색이 아니라 **그라디언트**이고 값은 `--tm-brand-mark` 하나다(§11 금지 목록 4).
 * 13·16·17·20 은 [03] TYPE 계단 밖의 **로고 전용 크기**라 프리셋으로 올리지 않았다.
 */

import { cn } from "@/lib/utils";

const SIZE = {
  md: {
    row: "gap-[11px]",
    mark: "h-8 w-8 rounded-control text-[16px]",
    name: "text-[20px]",
  },
  sm: {
    row: "gap-2",
    mark: "h-[25px] w-[25px] rounded-md text-[13px]",
    name: "text-[17px]",
  },
} as const;

export function BrandMark({
  className,
  size = "md",
}: {
  className?: string;
  size?: keyof typeof SIZE;
}) {
  const spec = SIZE[size];
  return (
    <div className={cn("flex items-center", spec.row, className)}>
      <span
        className={cn(
          "flex items-center justify-center bg-brand-mark font-extrabold leading-none text-primary-foreground",
          spec.mark,
        )}
      >
        M
      </span>
      <span className={cn("font-extrabold tracking-[-0.01em] text-foreground", spec.name)}>
        Managment
      </span>
    </div>
  );
}
