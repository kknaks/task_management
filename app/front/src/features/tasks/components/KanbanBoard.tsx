"use client";

/**
 * **U-2 칸반 뷰 · U-4 DnD**(SPEC-004).
 *
 * 4컬럼(시작전/진행중/완료/취소) · 컬럼 배경 `--tm-column` r16 · 카드 w320 r8.
 * **리스트와 같은 응답**을 상태로 나눠 그릴 뿐이다 — 컬럼별 쿼리를 내지 않는다.
 *
 * - 드래그 중: 잡은 카드는 **고스트**(그림자만, **회전 없음**), 원래 자리는 **점선 플레이스홀더**
 * - 드롭 가능 컬럼: 선택 색 배경 + `--tm-primary` 테두리
 * - **드롭 불가 컬럼: 불투명도 0.5 + `not-allowed` + 툴팁**(전이 그래프가 막는 조합만)
 * - 놓은 직후 응답까지 **로딩 유지**(불투명도 0.6) — 낙관적으로 옮기지 않는다
 * - **1280~1439: 컬럼 320 고정 + 가로 스크롤**. 리스트로 자동 전환하지 않는다(U-13)
 */

import { Plus } from "lucide-react";

import { StatusDot, STATUS_LABEL } from "@/components/shared/StatusDot";
import { TypeBadge } from "@/components/shared/TypeBadge";
import { DueCell } from "@/features/tasks/components/TaskMeta";
import { KANBAN_COLUMNS } from "@/features/tasks/hooks/useTasksQuery";
import { useKanbanDnd } from "@/features/tasks/hooks/useKanbanDnd";
import type { TaskListItem, TaskStatus } from "@/features/tasks/types";
import { formatMonth, formatMonthShort, formatTimestamp } from "@/lib/datetime";
import { cn } from "@/lib/utils";

export function KanbanBoard({
  items,
  month,
  doneCount,
  total,
  limit,
  pendingId,
  onOpen,
  onDropStatus,
  onContextMenu,
  onAddTask,
}: {
  items: readonly TaskListItem[];
  month: string;
  /**
   * **그 달의 완료 건수** — 응답 `statusCounts.done` 이다(U-2 · §4).
   * 카드를 세면 「지금 받아온 것 중 완료 수」가 되고 상한에 걸리는 순간 두 수가 갈린다.
   */
  doneCount: number;
  /** 그 달 총계. `limit` 을 넘으면 **조용히 자르지 않고** 하단에 알린다. */
  total: number;
  limit: number;
  pendingId: number | null;
  onOpen: (id: number) => void;
  onDropStatus: (task: TaskListItem, next: TaskStatus) => void;
  onContextMenu: (task: TaskListItem, x: number, y: number) => void;
  /** 「업무 추가」 — **상태는 항상 시작전**이다(03-create-task §진입). */
  onAddTask: () => void;
}) {
  const dnd = useKanbanDnd({ items, onDrop: onDropStatus });
  /** 그 달 업무가 상한을 넘었나 — 넘으면 **말한다**(U-2 「조용히 자르지 않는다」). */
  const truncated = total > limit;

  return (
    <>
    <div className="flex gap-4 overflow-x-auto pb-2">
      {KANBAN_COLUMNS.map((status) => {
        const columnItems = items.filter((item) => item.status === status);
        const blocked = dnd.blockedReason(status);
        const isOver = dnd.overStatus === status;

        return (
          <section
            key={status}
            {...dnd.columnProps(status)}
            title={blocked ?? undefined}
            className={cn(
              // **320 고정 + 가로 스크롤**(1280~1439) → ≥1440 에서 4컬럼 균등(최소 240)
              "flex w-kanban-col shrink-0 flex-col rounded-card border bg-column p-3 wide:w-auto wide:min-w-60 wide:flex-1",
              isOver ? "border-primary bg-secondary" : "border-transparent",
              // **놓을 수 없는 컬럼** — 흐림 + not-allowed. 툴팁이 이유를 알린다
              blocked !== null && "cursor-not-allowed opacity-50",
            )}
          >
            {/*
              **왜 못 놓는지 컬럼 안에 적는다.** `title` 은 네이티브 툴팁이라
              **드래그 중에는 뜨지 않는다**(실물에서 확인) — 흐림만 남으면 이유를 알 수 없다.
            */}
            {blocked !== null ? (
              <p role="status" className="mb-2 rounded-control bg-card px-2 py-1 text-caption text-fg-caption">
                {blocked}
              </p>
            ) : null}

            <header className="mb-2 flex items-center justify-between gap-2 px-1">
              <span className="flex items-center gap-1.5 text-section text-foreground">
                <StatusDot status={status} />
                {STATUS_LABEL[status]}
              </span>
              <span className="text-caption text-fg-caption">
                {/* 완료 컬럼은 건수 대신 **「8월 12」**(월 기준 — U-2). 카드를 세지 않는다 */}
                {status === "done" ? `${formatMonthShort(month)} ${doneCount}` : columnItems.length}
              </span>
            </header>

            <ul className="flex min-h-16 flex-col gap-2">
              {columnItems.length === 0 ? (
                <li className="py-6 text-center text-caption text-fg-caption">없음</li>
              ) : (
                columnItems.map((task) => {
                  const isDragging = dnd.draggingId === task.id;
                  return (
                    <li key={task.id}>
                      {isDragging ? (
                        // **원래 자리** — 1px 점선 + 옅은 배경, 카드와 같은 높이
                        <div className="h-24 rounded-control border border-dashed border-drop-placeholder-border bg-drop-placeholder" />
                      ) : (
                        <article
                          {...dnd.dragProps(task)}
                          onClick={() => onOpen(task.id)}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            onContextMenu(task, event.clientX, event.clientY);
                          }}
                          className={cn(
                            // `select-none` — 카드는 **끌기 대상**이라 텍스트 선택이 드래그와
                            // 경쟁하면 안 된다(끌다가 글자가 잡히면 드롭이 아니라 선택이 된다).
                            "flex cursor-pointer select-none flex-col gap-1.5 rounded-control border border-border bg-card p-3 shadow-card",
                            // 놓은 뒤 응답까지 **로딩 유지** — 낙관적으로 옮기지 않는다
                            pendingId === task.id && "opacity-60",
                          )}
                        >
                          <TypeBadge
                            name={task.workType.name}
                            colorToken={task.workType.colorToken}
                            className="self-start"
                          />
                          <span
                            className={cn(
                              "text-body",
                              task.status === "cancelled"
                                ? "text-fg-caption line-through"
                                : "text-foreground",
                            )}
                          >
                            {task.title}
                          </span>
                          <span className="flex flex-wrap items-center gap-2 text-caption text-fg-caption">
                            <DueCell
                              dueDate={task.dueDate}
                              dueStartTime={task.dueStartTime}
                              dueEndTime={task.dueEndTime}
                              dDay={task.dDay}
                              isOverdue={task.isOverdue}
                              overdueDays={task.overdueDays}
                            />
                            {task.memoCount > 0 ? <span>메모 {task.memoCount}</span> : null}
                          </span>
                          {/*
                            취소 카드는 **취소일과 사유**를 함께 적는다(U-2).
                            `cancelledAt` 은 서버가 취소 전이 로그에서 파생해 내려준다 — 화면이 세지 않는다.
                          */}
                          {task.status === "cancelled" ? (
                            <span className="text-caption text-fg-caption">
                              {[
                                task.cancelledAt ? formatTimestamp(task.cancelledAt) : null,
                                task.cancelReason,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          ) : null}
                        </article>
                      )}
                    </li>
                  );
                })
              )}
            </ul>

            {/* **시작전·진행중 컬럼에만** 「업무 추가」 — 만들면 상태는 항상 시작전이다 */}
            {status === "todo" || status === "in_progress" ? (
              <button
                type="button"
                onClick={onAddTask}
                className="mt-2 flex h-9 items-center justify-center gap-1 rounded-control border border-dashed border-border text-meta text-muted-foreground hover:bg-muted"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                업무 추가
              </button>
            ) : null}

            {/* 완료 컬럼 하단 캡션 — 이전 달은 기간 이동으로 본다(U-2) */}
            {status === "done" ? (
              <p className="mt-2 px-1 text-caption text-fg-caption">
                {formatMonth(month)} 완료 {doneCount}건 · 이전 달은 기간 이동으로 보기
              </p>
            ) : null}
          </section>
        );
      })}
    </div>

    {/*
      **조용히 자르지 않는다**(U-2 「데이터 범위」) — 상한에 걸렸다는 사실과
      전부 보는 길을 함께 준다. 완료 컬럼의 수는 집계에서 오므로 여기서도 어긋나지 않는다.
    */}
    {truncated ? (
      <p role="status" className="mt-2 text-caption text-fg-caption">
        이 달 업무가 {total}건이라 {limit}건까지만 그립니다 · 리스트에서 보기
      </p>
    ) : null}
    </>
  );
}
