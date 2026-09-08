"use client";

/**
 * **U-2 칸반 뷰 · U-4 DnD**(SPEC-004).
 *
 * 4컬럼(시작전/진행중/완료/취소) · 컬럼 배경 `--tm-column` r16 · 카드 r8.
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
import { KANBAN_COLUMNS } from "@/features/tasks/hooks/useTasksQuery";
import { useKanbanDnd } from "@/features/tasks/hooks/useKanbanDnd";
import type { TaskListItem, TaskStatus } from "@/features/tasks/types";
import {
  completionDelta,
  currentDate,
  formatDueDate,
  formatPeriod,
  formatPeriodShort,
  formatSchedule,
  type Period,
} from "@/lib/datetime";
import { cn } from "@/lib/utils";

/**
 * **카드 하단 행**(시안 285~310·322~410줄 · DEC-002 §「칸반 카드 하단 행」).
 *
 * `justify-between` 한 줄이고 **12px `#757575`** 다. 전에는 이 행이 통째로 빠져 있었다.
 *
 * | 자리 | 무엇 |
 * |---|---|
 * | 좌 | 계획 기간 `MM.DD – MM.DD`. 한쪽만 있으면 그것만, 둘 다 없으면 **「미정」** |
 * | 좌(취소) | **취소일** 「08.20 취소」 — `cancelledAt` |
 * | 우(시작전·진행중) | **`D-n`** — 오늘 `D-0`, 지났으면 `D+n` |
 * | 우(완료) | 계획 대비 차이 — 「정시 / N일 늦음 / N일 빠름」(`dueDate` ↔ `completedAt`) |
 * | 우(취소) | 취소 사유 |
 * | 우(D-day 없음) | 메모 수가 그 자리를 쓴다(시안 300줄 「메모 1」) — **D-day·차이가 우선**이다 |
 *
 * **기한이 없으면 「미정」**이다 — 빈칸으로 두면 「안 정했다」와 「못 읽었다」가 구분되지 않는다.
 * 실적 3개는 **목록 응답에 실려 온다**(계약 0004) — 상세를 따로 부르지 않는다.
 */
function CardFooter({ task }: { task: TaskListItem }) {
  const cancelled = task.status === "cancelled";
  const left = cancelled
    ? task.cancelledAt
      ? `${formatDueDate(currentDate(new Date(task.cancelledAt)))} 취소`
      : "취소"
    : formatSchedule(task.startDate, task.dueDate);

  return (
    <span
      className={cn(
        "flex items-center justify-between gap-2 text-caption",
        cancelled ? "text-fg-caption" : "text-fg-meta",
      )}
    >
      <span className="truncate">{left}</span>
      <CardFooterRight task={task} />
    </span>
  );
}

function CardFooterRight({ task }: { task: TaskListItem }) {
  if (task.status === "cancelled") {
    return task.cancelReason ? <span className="shrink-0">{task.cancelReason}</span> : null;
  }

  if (task.status === "done") {
    const delta = completionDelta(task.dueDate, task.completedAt);
    if (delta === null) {
      return <span className="shrink-0 text-fg-caption">미정</span>;
    }
    return (
      <span
        className={cn(
          "shrink-0",
          delta.tone === "late"
            ? "font-semibold text-status-overdue"
            : delta.tone === "early"
              ? "font-semibold text-primary"
              : "text-fg-meta",
        )}
      >
        {delta.label}
      </span>
    );
  }

  // 시작전·진행중 — `dueDate` 까지의 D-day. 없으면 메모 수가, 그것도 없으면 「미정」이다
  if (task.dueDate === null || task.dDay === null) {
    return task.memoCount > 0 ? (
      <span className="shrink-0">메모 {task.memoCount}</span>
    ) : (
      <span className="shrink-0 text-fg-caption">미정</span>
    );
  }
  return (
    <span
      className={cn(
        "shrink-0",
        task.dDay < 0
          ? "font-semibold text-status-overdue"
          : task.dDay === 0
            ? "font-semibold text-primary"
            : "text-fg-meta",
      )}
    >
      D{task.dDay === 0 ? "-0" : task.dDay > 0 ? `-${task.dDay}` : `+${-task.dDay}`}
    </span>
  );
}

export function KanbanBoard({
  items,
  period,
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
  /** 보고 있는 기간 — 완료 컬럼 헤더·캡션이 이 표기를 쓴다(E-3·E-4). */
  period: Period;
  /**
   * **그 기간의 완료 건수** — 응답 `statusCounts.done` 이다(U-2 · §4).
   * 카드를 세면 「지금 받아온 것 중 완료 수」가 되고 상한에 걸리는 순간 두 수가 갈린다.
   */
  doneCount: number;
  /** 그 기간 총계. `limit` 을 넘으면 **조용히 자르지 않고** 하단에 알린다. */
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
  /**
   * 「지금 하고 있는」 카드 — **진행중 컬럼의 첫 카드 하나**다(시안 322줄).
   * 화면이 고르는 표시이지 데이터가 아니다. 없으면 아무 카드도 강조되지 않는다.
   */
  const current = items.find((item) => item.status === "in_progress")?.id ?? null;
  /** 그 기간 업무가 상한을 넘었나 — 넘으면 **말한다**(U-2 「조용히 자르지 않는다」). */
  const truncated = total > limit;

  return (
    <>
    {/**
      * 보드 — ≥1440 은 `repeat(4,1fr)` · `gap 20`(시안 276줄).
      * 1280~1439 는 **컬럼 320 고정 + 가로 스크롤**이라 grid 로 묶지 않는다(U-13).
      */}
    <div className="flex gap-5 overflow-x-auto pb-2 wide:grid wide:grid-cols-4 wide:overflow-visible">
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
              // **320 고정 + 가로 스크롤**(1280~1439) → ≥1440 에서 4컬럼 균등
              // 컬럼 — 배경 `--tm-column` · border `#EBEBEB` · **r16** · padding 16 · gap 12(시안 278줄)
              "flex w-kanban-col shrink-0 flex-col gap-3 rounded-panel border bg-column p-4 wide:w-auto wide:min-w-0",
              isOver ? "border-primary bg-secondary" : "border-divider",
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

            {/* 헤더 — dot 8 + 이름 **14/700** + 카운트 **12 `#757575`**, gap 8(시안 279~283줄) */}
            <header className="flex items-center gap-2">
              <StatusDot status={status} />
              <span className="flex-1 text-control-label font-bold text-foreground">
                {STATUS_LABEL[status]}
              </span>
              <span className="text-caption text-fg-meta">
                {/* 완료 컬럼은 건수 대신 **「8월 12」**(기간 기준 — U-2). 카드를 세지 않는다 */}
                {status === "done" ? `${formatPeriodShort(period)} ${doneCount}` : columnItems.length}
              </span>
            </header>

            <ul className="flex min-h-16 flex-col gap-3">
              {columnItems.length === 0 ? (
                <li className="py-6 text-center text-caption text-fg-caption">없음</li>
              ) : (
                columnItems.map((task) => {
                  const isDragging = dnd.draggingId === task.id;
                  return (
                    <li key={task.id}>
                      <article
                        {...dnd.dragProps(task)}
                        onClick={() => {
                          // **드래그 직후의 클릭 한 번을 무시한다** — 끌어다 놓으면 브라우저가
                          // `click` 을 이어서 쏘고, 그대로 두면 드롭과 동시에 드로어가 열린다.
                          if (dnd.consumeDragClick()) {
                            return;
                          }
                          onOpen(task.id);
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          onContextMenu(task, event.clientX, event.clientY);
                        }}
                        className={cn(
                          // `select-none` — 카드는 **끌기 대상**이라 텍스트 선택이 드래그와
                          // 경쟁하면 안 된다(끌다가 글자가 잡히면 드롭이 아니라 선택이 된다).
                          // 규격 — 흰 배경 · border `#D9D9D9` · **r8** · padding 14 · gap 8(시안 285줄)
                          "flex cursor-pointer select-none flex-col gap-2 rounded-card border bg-card p-3.5",
                          /**
                           * **「지금 하고 있는」 카드 하나만** 강조한다(시안 322줄) —
                           * 진행중 컬럼의 **첫 카드**다. 여럿이 강조되면 「하나」가 아니게 된다.
                           */
                          current === task.id
                            ? "border-primary shadow-kanban-active"
                            : "border-border shadow-card",
                          /**
                           * **끌고 있는 카드는 흐려질 뿐 사라지지 않는다**(U-4 · REDRAW-06 G-0).
                           *
                           * 전에는 점선 플레이스홀더가 이 `<article>` 을 **대체**했는데,
                           * 브라우저는 **드래그 소스가 언마운트되면 드래그 세션을 중단한다** —
                           * 카드만 없어지고 드롭이 성사되지 않았다. 시안의 「원래 자리
                           * 플레이스홀더」는 카드를 지우라는 뜻이 아니라 **그 자리가 비어 보이지
                           * 않게 하라는 것**이고, 흐린 카드가 그 역할을 그대로 한다.
                           */
                          isDragging && "opacity-40",
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
                            // 제목 **14 / 600 / lh 1.4**(시안 287줄)
                            "text-item leading-[1.4]",
                            task.status === "cancelled"
                              ? "text-fg-caption line-through"
                              : "text-foreground",
                          )}
                        >
                          {task.title}
                        </span>
                        {/* 하단 행 — 좌 일정 / 우 상태별 값(시안 288줄 · REDRAW-05 F-3) */}
                        <CardFooter task={task} />
                      </article>
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
                // **h38 · r8 · dashed `#D9D9D9`** · 13px `#9EA2AE` · hover 흰 배경(시안 309줄)
                className="flex h-[38px] items-center justify-center gap-1.5 rounded-control border border-dashed border-border text-meta text-fg-caption hover:bg-card hover:text-foreground"
              >
                <Plus className="h-[13px] w-[13px]" aria-hidden />
                업무 추가
              </button>
            ) : null}

            {/* 완료 컬럼 하단 캡션 — 이전 달은 기간 이동으로 본다(U-2) */}
            {status === "done" ? (
              <p className="text-caption text-fg-caption">
                {formatPeriod(period)} 완료 {doneCount}건 · 이전 기간은 기간 이동으로 보기
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
        이 기간 업무가 {total}건이라 {limit}건까지만 그립니다 · 리스트에서 보기
      </p>
    ) : null}
    </>
  );
}
