"use client";

/**
 * **S-08 상태 dot 8px** — `09-design-tokens.md` §상태·유형 5색.
 *
 * 색은 `tokens.css` 의 `--tm-status-*` 다(컴포넌트에 hex 없음 — §11 금지 목록 4).
 * **이 컴포넌트는 상태를 바꾸지 않는다** — 표시만 한다. 전이는 WORK-005 몫이다.
 */

import { cn } from "@/lib/utils";

/** 저장·전송은 영문 소문자다. 화면 문구는 아래 매핑이다(DB G-4). */
export type TaskStatus = "todo" | "in_progress" | "done" | "cancelled";

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "시작전",
  in_progress: "진행중",
  done: "완료",
  cancelled: "취소",
};

/** 「지연」은 상태가 아니라 파생값이다 — 서버 `isOverdue` 가 켜지면 dot 만 지연색이 된다. */
const STATUS_DOT: Record<TaskStatus, string> = {
  todo: "bg-status-todo",
  in_progress: "bg-status-progress",
  done: "bg-status-done",
  cancelled: "bg-status-cancelled",
};

export function StatusDot({
  status,
  overdue = false,
  className,
}: {
  status: TaskStatus;
  overdue?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        overdue ? "bg-status-overdue" : STATUS_DOT[status],
        className,
      )}
    />
  );
}
