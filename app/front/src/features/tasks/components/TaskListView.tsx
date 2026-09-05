"use client";

/**
 * **U-1 리스트 뷰**(SPEC-004 · P-18 정정 반영).
 *
 * 컬럼 5 — **업무명(flex) · 유형 170 · 상태 140 · 기한 200 · 메모 120**. 행 52px.
 * **행 끝에 `⋯` 를 두지 않는다**(U-5) — 우클릭이 컨텍스트 메뉴를 연다.
 *
 * - 상태 셀은 **U-3 팝오버**를 연다 — 상세 헤더 드롭다운과 **같은 컴포넌트**다
 * - 취소 행은 제목 취소선 + 회색, **기한 칸에 사유를 함께 적는다**(05-status §취소 처리)
 * - **1280~1439 에서 메모 컬럼을 숨긴다**(U-13) — 업무명·유형·상태·기한은 판단 근거이고
 *   메모 수는 보조 정보다
 * - **낙관적으로 먼저 바꾸지 않는다** — 요청 중인 행만 흐려진다(FE §3-4)
 */

import { StatusDot, STATUS_LABEL } from "@/components/shared/StatusDot";
import { TypeBadge } from "@/components/shared/TypeBadge";
import { DueCell } from "@/features/tasks/components/TaskMeta";
import { StatusPopover } from "@/features/tasks/components/StatusPopover";
import type { TaskListItem, TaskStatus } from "@/features/tasks/types";
import { cn } from "@/lib/utils";

export function TaskListView({
  items,
  pendingId,
  onOpen,
  onSelectStatus,
  onContextMenu,
}: {
  items: readonly TaskListItem[];
  /** 요청이 나가 있는 행 — 낙관적으로 옮기지 않으므로 **표시만** 흐려진다. */
  pendingId: number | null;
  onOpen: (id: number) => void;
  onSelectStatus: (task: TaskListItem, next: TaskStatus) => void;
  onContextMenu: (task: TaskListItem, x: number, y: number) => void;
}) {
  return (
    <table className="w-full table-fixed border-collapse">
      <colgroup>
        <col />
        <col className="w-[170px]" />
        <col className="w-[140px]" />
        <col className="w-[200px]" />
        {/* 메모 — 1280~1439 에서 숨는다(U-13) */}
        <col className="hidden w-[120px] wide:table-column" />
      </colgroup>
      <thead>
        <tr className="border-b border-divider text-left text-caption text-fg-caption">
          <th className="h-9 px-3 font-normal">업무명</th>
          <th className="h-9 px-3 font-normal">유형</th>
          <th className="h-9 px-3 font-normal">상태</th>
          <th className="h-9 px-3 font-normal">기한</th>
          <th className="hidden h-9 px-3 font-normal wide:table-cell">메모</th>
        </tr>
      </thead>
      <tbody>
        {items.map((task) => {
          const cancelled = task.status === "cancelled";
          return (
            <tr
              key={task.id}
              onClick={() => onOpen(task.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                onContextMenu(task, event.clientX, event.clientY);
              }}
              className={cn(
                "h-row cursor-pointer border-b border-row-divider hover:bg-row-hover",
                pendingId === task.id && "opacity-60",
              )}
            >
              <td className="truncate px-3">
                <span
                  className={cn(
                    "text-body",
                    // 취소는 **목록에 남는다** — 제목 취소선 + 회색으로만 구분한다(§A-2)
                    cancelled ? "text-fg-caption line-through" : "text-foreground",
                  )}
                >
                  {task.title}
                </span>
              </td>

              <td className="px-3">
                <TypeBadge name={task.workType.name} colorToken={task.workType.colorToken} />
              </td>

              {/* 상태 셀 — **진입점 ①**. 행 클릭(상세 열기)과 겹치지 않게 전파를 멈춘다 */}
              <td className="px-3" onClick={(event) => event.stopPropagation()}>
                <StatusPopover
                  current={task.status}
                  onSelect={(next) => onSelectStatus(task, next)}
                  trigger={
                    <button
                      type="button"
                      className="flex h-8 items-center gap-1.5 rounded-control px-2 text-meta text-foreground hover:bg-muted"
                    >
                      <StatusDot status={task.status} />
                      {STATUS_LABEL[task.status]}
                    </button>
                  }
                />
              </td>

              <td className="px-3">
                {cancelled && task.cancelReason ? (
                  // 취소 행은 기한 칸에 **사유를 함께** 적는다(05-status §취소 처리)
                  <span className="truncate text-meta text-fg-caption">{task.cancelReason}</span>
                ) : (
                  <DueCell
                    dueDate={task.dueDate}
                    dueStartTime={task.dueStartTime}
                    dueEndTime={task.dueEndTime}
                    dDay={task.dDay}
                    isOverdue={task.isOverdue}
                    overdueDays={task.overdueDays}
                  />
                )}
              </td>

              <td className="hidden px-3 text-meta text-fg-meta wide:table-cell">
                {task.memoCount === 0 ? "" : task.memoCount}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
