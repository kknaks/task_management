"use client";

/**
 * **S-22 진행률 바** — 할일 「n / m」(SPEC-003 U-5).
 *
 * 값은 서버 파생값 `todoProgress` 를 그대로 그린다 — 화면이 다시 세지 않는다
 * (WORK-004 Internal Interface Contract 파생값 행).
 */

import { cn } from "@/lib/utils";

export function ProgressBar({
  done,
  total,
  className,
}: {
  done: number;
  total: number;
  className?: string;
}) {
  const ratio = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="shrink-0 text-meta text-fg-meta">
        {done} / {total}
      </span>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="h-1.5 min-w-[80px] flex-1 overflow-hidden rounded-chip bg-row-divider"
      >
        {/*
          완료색은 `--tm-status-done` — 09-design-tokens §상태.
          **인라인 `style` 은 폭 하나뿐이고 색이 아니다** — 금지 목록 4 는 「인라인 `style` 로
          색 hex 지정」이다(§11). 런타임 비율은 유틸 클래스로 표현할 수 없다.
        */}
        <div className="h-full rounded-chip bg-status-done" style={{ width: `${ratio}%` }} />
      </div>
    </div>
  );
}
