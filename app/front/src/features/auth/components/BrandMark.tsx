"use client";

/**
 * 로고 마크 — 원본의 「M」 사각 + 「Managment」(`로그인 · 계정 · 프로필.dc.html [로그인]`).
 * 제품명 표기는 디자인 원본 철자를 그대로 쓴다.
 *
 * 브랜드 패널과 1280 구간의 폼 상단이 같은 마크를 쓰므로 컴포넌트로 뺐다.
 */

import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span className="flex h-9 w-9 items-center justify-center rounded-control bg-primary text-section text-primary-foreground">
        M
      </span>
      <span className="text-panel text-foreground">Managment</span>
    </div>
  );
}
