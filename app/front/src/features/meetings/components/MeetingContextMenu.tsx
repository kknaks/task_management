"use client";

/**
 * **행 컨텍스트 메뉴 220**(SPEC-006 U-2 · SPEC-004 U-5 규격 — `TaskContextMenu` 와 같은 프레임, 항목만 다르다).
 *
 * 「열기」 / 구분선 / 「삭제」(`#E2685B`). **`recording`·`generating` 행에서는 「삭제」가 비활성**이다
 * (§4 상태별 허용 표 — 서버도 409 로 막는다).
 *
 * 우클릭 좌표에 뜨므로 팝오버 트리거를 **0×0 앵커**로 그 자리에 놓는다.
 */

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { MeetingStatus } from "@/features/meetings/types";
import { cn } from "@/lib/utils";

export interface MeetingMenuTarget {
  id: number;
  title: string;
  status: MeetingStatus;
  x: number;
  y: number;
}

/** 삭제가 막히는 상태 — 스트림·job 이 돌고 있다(§4 상태별 허용 표). */
export function canDeleteMeeting(status: MeetingStatus): boolean {
  return status === "scheduled" || status === "ended";
}

export function MeetingContextMenu({
  target,
  onClose,
  onOpen,
  onDelete,
}: {
  target: MeetingMenuTarget | null;
  onClose: () => void;
  onOpen: (id: number) => void;
  onDelete: (target: MeetingMenuTarget) => void;
}) {
  if (target === null) {
    return null;
  }
  const deletable = canDeleteMeeting(target.status);

  return (
    <Popover open onOpenChange={(open) => (open ? undefined : onClose())}>
      <PopoverTrigger asChild>
        <span aria-hidden className="fixed h-0 w-0" style={{ left: target.x, top: target.y }} />
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

        <div className="mt-1 border-t border-divider pt-1">
          <button
            type="button"
            disabled={!deletable}
            onClick={() => {
              onClose();
              onDelete(target);
            }}
            className={cn(
              "flex h-9 w-full items-center rounded-control px-3 text-left text-meta",
              deletable
                ? "text-destructive hover:bg-muted"
                : "cursor-not-allowed text-fg-caption",
            )}
          >
            삭제
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
