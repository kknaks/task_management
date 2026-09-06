"use client";

/**
 * **U-5 카드·행 컨텍스트 메뉴 220**(SPEC-004).
 *
 * 「열기」 / 구분선 / 상태 4(현재 값에 체크, 전이 불가는 비활성) / 구분선 / 「삭제」.
 * **행 끝에 `⋯` 버튼을 따로 두지 않는다** — 컬럼을 늘리면 1280 에서 먼저 잘린다.
 *
 * 리스트 행과 칸반 카드가 **같은 메뉴**를 연다. 마우스 없는 경로는 상세 헤더 `⋯` 가 든다.
 *
 * 우클릭 좌표에 뜨므로 팝오버 트리거를 **0×0 앵커**로 그 자리에 놓는다 —
 * `Popover` 규격(그림자·radius)은 그대로 쓰고 위치만 우리가 정한다.
 */

import { Check } from "lucide-react";

import { StatusDot, STATUS_LABEL } from "@/components/shared/StatusDot";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { transitionBlockedReason } from "@/lib/taskStatus";
import type { TaskStatus } from "@/features/tasks/types";
import { cn } from "@/lib/utils";

const ITEMS: readonly TaskStatus[] = ["todo", "in_progress", "done", "cancelled"];

export interface ContextMenuTarget {
  id: number;
  title: string;
  status: TaskStatus;
  /** 우클릭한 화면 좌표. */
  x: number;
  y: number;
}

export function TaskContextMenu({
  target,
  onClose,
  onOpen,
  onSelectStatus,
  onDelete,
}: {
  target: ContextMenuTarget | null;
  onClose: () => void;
  onOpen: (id: number) => void;
  onSelectStatus: (status: TaskStatus) => void;
  onDelete: () => void;
}) {
  if (target === null) {
    return null;
  }

  return (
    <Popover open onOpenChange={(open) => (open ? undefined : onClose())}>
      {/* 우클릭 좌표에 붙는 **보이지 않는 앵커** — 메뉴 규격은 팝오버 그대로다 */}
      <PopoverTrigger asChild>
        <span
          aria-hidden
          className="fixed h-0 w-0"
          style={{ left: target.x, top: target.y }}
        />
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-popover-menu rounded-card border-border bg-card p-1 shadow-popover"
      >
        <button
          type="button"
          onClick={() => {
            onClose();
            onOpen(target.id);
          }}
          className="flex h-9 w-full items-center rounded-control px-3 text-left text-meta text-foreground hover:bg-muted"
        >
          열기
        </button>

        <ul className="mt-1 border-t border-divider pt-1">
          {ITEMS.map((status) => {
            const isCurrent = status === target.status;
            const disabled = !isCurrent && transitionBlockedReason(target.status, status) !== null;
            return (
              <li key={status}>
                <button
                  type="button"
                  disabled={disabled || isCurrent}
                  onClick={() => {
                    onClose();
                    onSelectStatus(status);
                  }}
                  className={cn(
                    "flex h-9 w-full items-center gap-2 rounded-control px-3 text-left text-meta",
                    isCurrent
                      ? "bg-pick font-bold text-pick-foreground"
                      : disabled
                        ? "cursor-not-allowed text-fg-caption"
                        : "text-foreground hover:bg-muted",
                  )}
                >
                  <StatusDot status={status} />
                  <span className="flex-1">{STATUS_LABEL[status]}</span>
                  {isCurrent ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-1 border-t border-divider pt-1">
          <button
            type="button"
            onClick={() => {
              onClose();
              onDelete();
            }}
            className="flex h-9 w-full items-center rounded-control px-3 text-left text-meta text-destructive hover:bg-muted"
          >
            삭제
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
