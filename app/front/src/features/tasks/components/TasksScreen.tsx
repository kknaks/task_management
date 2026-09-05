"use client";

/**
 * **내 업무 — 리스트·칸반의 껍데기 하나**(SPEC-004 §2 · U-1·U-2·U-12·U-13).
 *
 * 헤더(기간 스테퍼 · 뷰 토글 · 정렬·필터 · 「새 업무」) → 유형 탭 → 뷰.
 *
 * ## 여기서 못박는 것 넷
 *
 * 1. **화면당 Ink 는 하나** — 유형 탭 밑줄이 그 하나다. **뷰 토글은 「현재 값」 배경**으로
 *    그린다(§2 · S004-OQ-2). 이 파일에 `ink` 유틸이 없는 것이 그 증거다
 * 2. **조건은 전부 `?` 에 있다** — 기간·유형·상태·프로젝트·정렬·뷰. 뷰를 바꿔도 조건이
 *    유지되고 새로고침해도 그대로인 것이 여기서 저절로 따라온다
 * 3. **세 진입점이 훅 하나를 지난다** — 리스트 셀·컨텍스트 메뉴·칸반 드롭이 전부
 *    `useTaskStatus().setStatus` 를 부른다. 상세 드롭다운도 같은 훅이다(`TaskDetailParts`)
 * 4. **실패를 빈 목록으로 대체하지 않는다** — 실패 표시 + 「다시 시도」다(§4 · FE §3-5)
 */

import { useState } from "react";
import { Plus } from "lucide-react";

import { EmptyState } from "@/components/shared/EmptyState";
import { PeriodStepper } from "@/components/shared/PeriodStepper";
import { UnderlineTabs, type UnderlineTab } from "@/components/shared/UnderlineTabs";
import { STATUS_LABEL } from "@/components/shared/StatusDot";
import { Button } from "@/components/ui/button";
import { openCancelModal } from "@/features/tasks/components/CancelModal";
import { KanbanBoard } from "@/features/tasks/components/KanbanBoard";
import { StatusFilterPopover, SortPopover } from "@/features/tasks/components/TasksFilters";
import { TaskContextMenu, type ContextMenuTarget } from "@/features/tasks/components/TaskContextMenu";
import { TaskListView } from "@/features/tasks/components/TaskListView";
import { TaskBoardSkeleton, TaskListSkeleton } from "@/features/tasks/components/TaskSkeleton";
import { useTasksQuery } from "@/features/tasks/hooks/useTasksQuery";
import { useTaskStatus } from "@/features/tasks/hooks/useTaskStatus";
import {
  formatMonth,
  monthRange,
  shiftMonth,
  TASKS_PAGE_SIZE,
  useTasksViewParams,
} from "@/features/tasks/hooks/useTasksViewParams";
import { openTaskCreateDrawer, openTaskDetailDrawer } from "@/features/tasks/openTaskDrawers";
import { useWorkTypesQuery } from "@/features/settings/hooks/useWorkSettings";
import type { TaskListItem, TaskStatus } from "@/features/tasks/types";
import { useOverlay } from "@/lib/overlay/OverlayProvider";
import { cn } from "@/lib/utils";

export function TasksScreen() {
  const params = useTasksViewParams();
  const overlay = useOverlay();
  const { data: workTypes = [] } = useWorkTypesQuery();
  const [menu, setMenu] = useState<ContextMenuTarget | null>(null);

  const { from, to } = monthRange(params.month);
  const query = useTasksQuery({
    from,
    to,
    workTypeId: params.workTypeId,
    status: params.status,
    projectId: params.projectId,
    sort: params.sort,
    page: params.page,
    size: TASKS_PAGE_SIZE,
  });

  /**
   * **거부 토스트의 「결과 입력」** — WORK-004 가 내보낸 유도 진입을 부른다.
   * 상세를 열면서 그 카드로 스크롤·포커스·강조를 한다. 여기서 새로 만들지 않는다.
   */
  const status = useTaskStatus({
    onEnterCompletion: (taskId) => openTaskDetailDrawer(overlay, taskId, { focusCompletion: true }),
  });

  /** **세 진입점이 지나는 자리 하나.** 「취소」만 모달을 거쳐 같은 훅으로 돌아온다. */
  const selectStatus = (task: TaskListItem, next: TaskStatus) => {
    if (next === "cancelled") {
      openCancelModal(overlay, task, (input) => status.setStatus(task, input));
      return;
    }
    void status.setStatus(task, { status: next });
  };

  const openDetail = (id: number) => openTaskDetailDrawer(overlay, id);

  const confirmDelete = (task: TaskListItem) =>
    overlay.openConfirm({
      title: `'${task.title}' 업무를 삭제할까요?`,
      summary:
        "목록·칸반에서 사라지고 집계에서도 빠집니다. 할일·메모·첨부·로그도 함께 보이지 않게 됩니다.",
      warning: "v1 에는 복원 화면이 없습니다.",
      confirmLabel: "삭제",
      destructive: true,
      onConfirm: () => void status.removeTask(task.id),
    });

  const data = query.data;
  const items = data?.items ?? [];

  /**
   * 유형 탭 — **동적 유형 전체**를 그리고 수는 집계에서 찾는다.
   * `typeCounts` 에는 **그 기간에 업무가 있는 유형만** 담기므로, 없는 유형은 **0 을 그린다**
   * (탭을 감추면 「이 달에 그 유형이 없다」와 「그 유형이 없다」가 구분되지 않는다).
   */
  const counts = data?.typeCounts ?? [];
  const tabs: UnderlineTab[] = [
    { id: null, label: "전체", count: counts.find((c) => c.workTypeId === null)?.count ?? 0 },
    ...workTypes.map((type) => ({
      id: type.id,
      label: type.name,
      count: counts.find((c) => c.workTypeId === type.id)?.count ?? 0,
    })),
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4 px-gutter py-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-page-title text-foreground">내 업무</h1>

        {params.activeFilterCount > 0 ? (
          <button
            type="button"
            onClick={params.clearFilters}
            className="h-6 rounded-chip border border-primary bg-secondary px-2 text-badge text-secondary-foreground"
          >
            필터 {params.activeFilterCount} ✕
          </button>
        ) : null}

        <span className="flex-1" />

        <PeriodStepper
          label={formatMonth(params.month)}
          onPrev={() => params.setParams({ month: shiftMonth(params.month, -1) })}
          onNext={() => params.setParams({ month: shiftMonth(params.month, 1) })}
          onToday={() => params.setParams({ month: null })}
        />

        {/* 뷰 토글 — **현재 값 배경**이고 Ink 가 아니다(§2 · S004-OQ-2) */}
        <div role="group" aria-label="뷰 전환" className="flex rounded-control bg-muted p-0.5">
          {(["list", "board"] as const).map((view) => (
            <button
              key={view}
              type="button"
              aria-pressed={params.view === view}
              onClick={() => params.setParams({ view, page: null })}
              className={cn(
                "h-8 rounded-control px-3 text-meta",
                params.view === view
                  ? "bg-current font-bold text-current-foreground"
                  : "text-muted-foreground",
              )}
            >
              {view === "list" ? "리스트" : "칸반"}
            </button>
          ))}
        </div>

        {/* 리스트는 **상태** 필터, 칸반은 **프로젝트** — 칸반은 컬럼이 이미 상태 축이다(U-12) */}
        {params.view === "list" ? (
          <>
            <SortPopover value={params.sort} onChange={(sort) => params.setParams({ sort })} />
            <StatusFilterPopover
              value={params.status}
              onChange={(status) => params.setParams({ status })}
            />
          </>
        ) : null}

        <Button type="button" onClick={() => openTaskCreateDrawer(overlay, () => void query.refetch())}>
          <Plus aria-hidden />새 업무
        </Button>
      </header>

      <UnderlineTabs
        ariaLabel="유형"
        tabs={tabs}
        value={params.workTypeId}
        onChange={(next) => params.setParams({ workTypeId: next })}
      />

      {/* 필터·기간을 바꿀 때는 **이전 결과를 유지**하고 위에 얇은 진행 표시만 둔다(U-11) */}
      {query.isFetching && !query.isPending ? (
        <div className="h-0.5 w-full overflow-hidden rounded-chip bg-row-divider">
          <div className="h-full w-1/3 animate-pulse bg-primary" />
        </div>
      ) : null}

      <TasksBody
        params={params}
        query={query}
        items={items}
        pendingId={status.pendingId}
        onOpen={openDetail}
        onSelectStatus={selectStatus}
        onContextMenu={(task, x, y) => setMenu({ ...task, x, y })}
        onAddTask={() => openTaskCreateDrawer(overlay, () => void query.refetch())}
      />

      {/* 하단 카운트 + 페이지네이션(리스트만 — 칸반은 컬럼이 스크롤된다) */}
      {params.view === "list" && data !== undefined && data.total > 0 ? (
        <footer className="flex items-center justify-between gap-3 text-meta text-fg-meta">
          <span>
            {formatMonth(params.month)} · {data.total}건 중 {items.length}건 표시
          </span>
          <span className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={params.page <= 1}
              onClick={() => params.setParams({ page: params.page - 1 })}
            >
              이전
            </Button>
            <span className="text-caption">
              {params.page} / {Math.max(1, Math.ceil(data.total / data.size))}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={params.page >= Math.ceil(data.total / data.size)}
              onClick={() => params.setParams({ page: params.page + 1 })}
            >
              다음
            </Button>
          </span>
        </footer>
      ) : null}

      <TaskContextMenu
        target={menu}
        onClose={() => setMenu(null)}
        onOpen={openDetail}
        onSelectStatus={(next) => {
          const task = items.find((item) => item.id === menu?.id);
          if (task) {
            selectStatus(task, next);
          }
        }}
        onDelete={() => {
          const task = items.find((item) => item.id === menu?.id);
          if (task) {
            confirmDelete(task);
          }
        }}
      />
    </div>
  );
}

/** 로딩·실패·빈 상태·뷰 넷을 가르는 자리 하나 — 화면이 어느 갈래인지 한눈에 보이게. */
function TasksBody({
  params,
  query,
  items,
  pendingId,
  onOpen,
  onSelectStatus,
  onContextMenu,
  onAddTask,
}: {
  params: ReturnType<typeof useTasksViewParams>;
  query: ReturnType<typeof useTasksQuery>;
  items: readonly TaskListItem[];
  pendingId: number | null;
  onOpen: (id: number) => void;
  onSelectStatus: (task: TaskListItem, next: TaskStatus) => void;
  onContextMenu: (task: TaskListItem, x: number, y: number) => void;
  onAddTask: () => void;
}) {
  // **첫 로딩에만** 스켈레톤(U-11).
  if (query.isPending) {
    return params.view === "board" ? <TaskBoardSkeleton /> : <TaskListSkeleton />;
  }

  /**
   * **실패를 빈 목록으로 대체하지 않는다**(§4 Case Matrix · DEC-003 §7 승계).
   * `retry:false` 라 「다시 시도」가 **요청을 한 번만** 보낸다.
   */
  if (query.isError) {
    return (
      <EmptyState
        message="업무를 불러오지 못했습니다"
        hint="잠시 후 다시 시도해 주세요"
        action={
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>
            다시 시도
          </Button>
        }
      />
    );
  }

  if (items.length === 0) {
    // 빈 상태 3종 중 둘 — **필터가 걸려 있으면** 「조건에 맞는 업무가 없습니다」(U-9)
    return params.activeFilterCount > 0 ? (
      <EmptyState
        message="조건에 맞는 업무가 없습니다"
        hint="유형·상태 필터를 지우면 더 많은 업무가 보입니다"
        action={
          <Button type="button" variant="outline" onClick={params.clearFilters}>
            필터 지우기
          </Button>
        }
      />
    ) : (
      <EmptyState
        message={`${formatMonth(params.month)}에 등록된 업무가 없습니다`}
        hint="새 업무를 만들거나 이전 달을 살펴보세요"
        action={
          <Button
            type="button"
            variant="outline"
            onClick={() => params.setParams({ month: shiftMonth(params.month, -1) })}
          >
            이전 달 보기
          </Button>
        }
      />
    );
  }

  return params.view === "board" ? (
    <KanbanBoard
      items={items}
      month={params.month}
      pendingId={pendingId}
      onOpen={onOpen}
      onDropStatus={onSelectStatus}
      onContextMenu={onContextMenu}
      onAddTask={onAddTask}
    />
  ) : (
    <TaskListView
      items={items}
      pendingId={pendingId}
      onOpen={onOpen}
      onSelectStatus={onSelectStatus}
      onContextMenu={onContextMenu}
    />
  );
}

export { STATUS_LABEL };
