"use client";

/**
 * **U-3 상태 변경 팝오버 — 세 진입점 중 둘이 공유한다**(SPEC-004).
 *
 * 리스트 상태 셀과 **상세 헤더 드롭다운**이 같은 컴포넌트를 쓴다. 규격이 갈리면
 * 「어디서는 눌리고 어디서는 안 눌리는」 항목이 생긴다.
 *
 * - 항목 4 + **취소 앞 구분선**. 현재 값은 배경 `--tm-current-bg` + 상태색 텍스트
 * - **전이 불가 항목은 비활성 + 캡션** — 다만 그건 **편의**이고 판정은 서버다(§5)
 * - **「완료」는 언제나 열려 있다** — 결과자료 유무를 화면이 미리 판단하지 않는다.
 *   게이트는 놓은 뒤 서버가 판정한다(WP §Internal Interface Contract)
 * - 「취소」를 고르면 **팝오버가 먼저 닫히고** 취소 모달이 열린다(겹치지 않는다 — FE §6-2)
 * - **낙관적으로 먼저 바꾸지 않는다**(FE §3-4)
 */

import { useState, type ReactNode } from "react";

import { StatusDot, STATUS_LABEL } from "@/components/shared/StatusDot";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { transitionBlockedReason } from "@/features/tasks/statusTransitions";
import type { TaskStatus } from "@/features/tasks/types";
import { cn } from "@/lib/utils";

/** 시작전 / 진행중 / 완료 / (구분선) / 취소 — **「지연」은 목록에 없다**(표시 전용 · T-4). */
const ITEMS: readonly TaskStatus[] = ["todo", "in_progress", "done", "cancelled"];

const STATUS_TEXT: Record<TaskStatus, string> = {
  todo: "text-status-todo",
  in_progress: "text-status-progress",
  done: "text-status-done",
  cancelled: "text-status-cancelled",
};

export function StatusPopover({
  current,
  onSelect,
  trigger,
  align = "start",
}: {
  current: TaskStatus;
  /** 「취소」면 호출자가 **모달을 연다** — 이 컴포넌트는 전이를 직접 내지 않는다. */
  onSelect: (next: TaskStatus) => void;
  trigger: ReactNode;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={8}
        className="w-popover-menu rounded-card border-border bg-card p-1 shadow-popover"
      >
        <ul role="listbox" aria-label="상태 변경">
          {ITEMS.map((status) => {
            const blocked = transitionBlockedReason(current, status);
            const isCurrent = status === current;
            // 현재 값은 「고를 수 없다」가 아니라 「지금 그 값이다」 — 비활성 문구를 붙이지 않는다.
            const disabled = !isCurrent && blocked !== null;

            return (
              <li key={status} className={cn(status === "cancelled" && "mt-1 border-t border-divider pt-1")}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isCurrent}
                  disabled={disabled || isCurrent}
                  onClick={() => {
                    setOpen(false);
                    onSelect(status);
                  }}
                  className={cn(
                    "flex h-9 w-full items-center gap-2 rounded-control px-3 text-left text-meta",
                    isCurrent
                      ? cn("bg-current font-bold", STATUS_TEXT[status])
                      : disabled
                        ? "cursor-not-allowed text-fg-caption"
                        : "text-foreground hover:bg-muted",
                  )}
                >
                  <StatusDot status={status} />
                  <span className="flex-1">{STATUS_LABEL[status]}</span>
                </button>

                {/* 왜 못 고르는지 **그 조합에서만** 적는다 — 일반 문구를 줄줄이 달지 않는다 */}
                {disabled && status === "cancelled" && current === "done" ? (
                  <p className="px-3 pb-1 text-caption text-fg-caption">{blocked}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
