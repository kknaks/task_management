"use client";

/**
 * **S-34 빈 상태** — 목록이 비었을 때 자리를 비워 두지 않는다.
 *
 * 문구는 화면이 준다 — 「할일이 없습니다」·「메모가 없습니다」처럼 **무엇이 없는지**를
 * 그 자리가 안다(SPEC-003 U-5·U-9).
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function EmptyState({
  message,
  hint,
  action,
  className,
}: {
  message: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-1 py-6 text-center", className)}>
      <p className="text-meta text-fg-caption">{message}</p>
      {hint ? <p className="text-caption text-fg-caption">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
