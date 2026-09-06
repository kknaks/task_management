"use client";

/**
 * **U-1 리스트 뷰**(SPEC-004 · P-18 정정 반영).
 *
 * 컬럼 6 — **업무명(flex) · 유형 170 · 상태 140 · 시작일 150 · 종료일 180 · 메모 120**. 행 52px.
 * **행 끝에 `⋯` 를 두지 않는다**(U-5) — 우클릭이 컨텍스트 메뉴를 연다.
 *
 * - 상태 셀은 **U-3 팝오버**를 연다 — 상세 헤더 드롭다운과 **같은 컴포넌트**다
 * - 취소 행은 제목 취소선 + 회색, **종료일 칸에 사유를 함께 적는다**(05-status §취소 처리)
 * - **1280~1439 에서 시작일 컬럼을 숨긴다**(U-13 · REDRAW-05 F-4) — 판단 근거는 종료일이고
 *   시작일은 보조 정보다. A-4 때문에 「메모를 대신 숨긴다」로 바꿨던 것이 번복됐다
 * - **낙관적으로 먼저 바꾸지 않는다** — 요청 중인 행만 흐려진다(FE §3-4)
 */

import { StatusDot, STATUS_LABEL } from "@/components/shared/StatusDot";
import { TypeBadge } from "@/components/shared/TypeBadge";
import type { TaskStatus as StatusKey } from "@/components/shared/StatusDot";
import { DueCell } from "@/features/tasks/components/TaskMeta";
import { formatDueDate } from "@/lib/datetime";
import { StatusPopover } from "@/features/tasks/components/StatusPopover";
import type { TaskListItem, TaskStatus } from "@/features/tasks/types";
import { cn } from "@/lib/utils";

/**
 * 상태 **텍스트 색** — 시안 104줄은 dot 과 글자가 **같은 상태색**이다.
 * dot 만 색이고 글자가 본문색이면 한 행에 상태가 두 번 말해지면서 어긋난다.
 * 지연은 상태가 아니라 파생값이라 여기 없다 — dot 만 지연색으로 덮인다(`StatusDot`).
 */
const STATUS_TEXT: Record<StatusKey, string> = {
  todo: "text-status-todo",
  in_progress: "text-status-progress",
  done: "text-status-done",
  cancelled: "text-status-cancelled",
};

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
      {/**
        * 컬럼 **6개** — 시안 92~99줄(REDRAW-05 F-2). 일정이 4필드로 돌아오면서
        * 「기한」 1컬럼이 **「시작일」·「종료일」 2컬럼**으로 갈렸다(A-4 번복).
        *
        * **1280~1439 에서 숨는 것은 「시작일」**이다(U-13 · F-4) — 원래 P-29 가 그랬고,
        * A-4 때문에 「메모를 대신 숨긴다」로 바꿨던 것이 번복됐다. **메모는 다시 보인다.**
        */}
      <colgroup>
        <col />
        <col className="w-[170px]" />
        <col className="w-[140px]" />
        {/* 시작일 — 1280~1439 에서 숨는다(U-13) */}
        <col className="hidden w-[150px] wide:table-column" />
        <col className="w-[180px]" />
        <col className="w-[120px]" />
      </colgroup>
      {/**
       * 헤더 — 시안 92~99줄: **h44 · 13px `#757575` · `border-bottom 1px #D9D9D9`**.
       * 업무명만 좌측(`padding-left 10`)이고 **나머지는 가운데**다.
       */}
      <thead>
        <tr className="h-11 border-b border-border text-center text-meta text-fg-meta">
          <th className="pl-2.5 text-left font-normal">
            <span className="inline-flex items-center gap-1.5">
              업무명
              {/* 정렬 caret 8×6 — 정렬 축이 업무명에 붙어 있음을 알린다(시안 93줄) */}
              <svg width="8" height="6" viewBox="0 0 8 6" fill="currentColor" aria-hidden>
                <path d="M4 5.5.3 1.1C.1.9.2.6.5.6h7c.3 0 .4.3.2.5L4 5.5Z" />
              </svg>
            </span>
          </th>
          <th className="font-normal">유형</th>
          <th className="font-normal">상태</th>
          <th className="hidden font-normal wide:table-cell">시작일</th>
          <th className="font-normal">종료일</th>
          <th className="font-normal">메모</th>
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
                // 행 구분선은 **`#EBEBEB`** 다(시안 101줄) — 헤더 아래 `#D9D9D9` 와 다른 선이다
                "h-row cursor-pointer border-b border-divider text-center hover:bg-row-hover",
                pendingId === task.id && "opacity-60",
              )}
            >
              <td className="truncate pl-2.5 text-left">
                <span
                  className={cn(
                    // 업무명 **14 / 600**(시안 102줄)
                    "text-item",
                    // 취소는 **목록에 남는다** — 제목 취소선 + 회색으로만 구분한다(§A-2)
                    cancelled ? "text-fg-caption line-through" : "text-foreground",
                  )}
                >
                  {task.title}
                </span>
              </td>

              <td>
                <TypeBadge name={task.workType.name} colorToken={task.workType.colorToken} />
              </td>

              {/* 상태 셀 — **진입점 ①**. 행 클릭(상세 열기)과 겹치지 않게 전파를 멈춘다 */}
              <td onClick={(event) => event.stopPropagation()}>
                <StatusPopover
                  current={task.status}
                  onSelect={(next) => onSelectStatus(task, next)}
                  trigger={
                    <button
                      type="button"
                      // 표시는 **dot 8px + 13px 상태색 텍스트**다(시안 104줄) — 본문색이 아니다
                      className={cn(
                        "mx-auto flex h-8 items-center gap-[7px] rounded-control px-2 text-meta hover:bg-muted",
                        STATUS_TEXT[task.status],
                      )}
                    >
                      <StatusDot status={task.status} />
                      {STATUS_LABEL[task.status]}
                    </button>
                  }
                />
              </td>

              {/* 시작일 — 13px `#757575`(시안 105줄). 없으면 `—` */}
              <td className="hidden text-meta text-fg-meta wide:table-cell">
                {task.startDate === null ? "—" : formatDueDate(task.startDate)}
              </td>

              <td>
                {cancelled && task.cancelReason ? (
                  // 취소 행은 **종료일 칸에 사유**를 적는다(시안 196줄 「일정 연기」)
                  <span className="truncate text-meta text-fg-caption">{task.cancelReason}</span>
                ) : (
                  <DueCell
                    dueDate={task.dueDate}
                    dDay={task.dDay}
                    isOverdue={task.isOverdue}
                    overdueDays={task.overdueDays}
                  />
                )}
              </td>

              <td className="text-meta text-fg-caption">
                {/* 메모가 없으면 **`—`** 다(시안 206줄) — 빈칸은 「모르는 값」처럼 읽힌다 */}
                {task.memoCount === 0 ? "—" : task.memoCount}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
