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
  KANBAN_MAX_SIZE,
  TASKS_PAGE_SIZE,
  useTasksViewParams,
} from "@/features/tasks/hooks/useTasksViewParams";
import { formatPeriod, periodRange, shiftPeriod } from "@/lib/datetime";
import { openTaskCreateDrawer, openTaskDetailDrawer } from "@/features/tasks/openTaskDrawers";
import { useWorkTypesQuery } from "@/features/settings/hooks/useWorkSettings";
import type { TaskListItem, TaskStatus, TasksView } from "@/features/tasks/types";
import { useOverlay } from "@/lib/overlay/OverlayProvider";
import { cn } from "@/lib/utils";

export function TasksScreen() {
  const params = useTasksViewParams();
  const overlay = useOverlay();
  const { data: workTypes = [] } = useWorkTypesQuery();
  const [menu, setMenu] = useState<ContextMenuTarget | null>(null);

  const { from, to } = periodRange(params.period);
  /**
   * **칸반은 페이지를 쓰지 않는다**(U-2 「데이터 범위」) — 그 기간 전체를 한 번에 그린다.
   * 리스트의 12건을 물려받으면 13번째 업무가 화면에 나타날 길이 없다(검수 F-2).
   */
  const board = params.view === "board";
  const query = useTasksQuery({
    from,
    to,
    workTypeId: params.workTypeId,
    status: params.status,
    projectId: params.projectId,
    sort: params.sort,
    page: board ? 1 : params.page,
    size: board ? KANBAN_MAX_SIZE : TASKS_PAGE_SIZE,
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
      /** 색칩은 **유형이 고른 팔레트**에서 온다 — 시안의 고정 4색이 아니다(§A-1) */
      colorToken: type.colorToken,
    })),
  ];

  return (
    <div className="flex min-w-0 flex-col">
      {/**
       * 헤더는 **두 묶음**이다(시안 53~80줄) — 좌(타이틀 + 기간 스테퍼, `gap 16`) /
       * 우(뷰토글·정렬·상태·새업무, `gap 10`)를 `justify-between` 으로 벌리고
       * `align-items: flex-end` 로 밑선을 맞춘다.
       *
       * 전에는 한 줄에 `flex-1` 스페이서가 있어 **기간 스테퍼가 우측 버튼 수를 따라 움직였다** —
       * 리스트와 칸반에서 자리가 달랐다. 스테퍼는 **좌측 묶음의 일부**라 뷰를 바꿔도 안 움직인다.
       *
       * **헤더는 뷰와 무관하게 하나다**(E-2 · DEC-002) — 뷰 토글은 그 아래 본문만 바꾼다.
       * 정렬·상태를 `view === "list"` 로 가르지 않는다. 칸반에 상태를 걸면 컬럼 하나만
       * 남는 것은 **의도된 동작**이다.
       */}
      <header className="flex items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-page-title text-foreground">내 업무</h1>
          <PeriodStepper
            period={params.period}
            onPrev={() => params.setPeriod(shiftPeriod(params.period, -1))}
            onNext={() => params.setPeriod(shiftPeriod(params.period, 1))}
            onPick={params.setPeriod}
          />
        </div>

        <div className="flex items-center gap-2.5">
          <ViewToggle view={params.view} onChange={(view) => params.setParams({ view, page: null })} />
          <SortPopover value={params.sort} onChange={(sort) => params.setParams({ sort })} />
          <StatusFilterPopover
            value={params.status}
            onChange={(status) => params.setParams({ status })}
          />
          {/* 「새 업무」 — h34 · `#7181F8` · 13/600 · padding 0 16 · gap 7(시안 75줄) */}
          <Button
            type="button"
            onClick={() => openTaskCreateDrawer(overlay, () => void query.refetch())}
            className="h-[34px] gap-[7px] rounded-control px-4 text-meta font-semibold [&_svg]:h-3.5 [&_svg]:w-3.5"
          >
            <Plus aria-hidden />새 업무
          </Button>
        </div>
      </header>

      {/* 타이틀 `top 66` → 유형 탭 `top 132`(시안 82줄). 타이틀 줄 높이 36 뒤 30 이 남는다 */}
      <div className="mt-[30px]" />

      <UnderlineTabs
        ariaLabel="유형"
        tabs={tabs}
        value={params.workTypeId}
        onChange={(next) => params.setParams({ workTypeId: next })}
      />

      {/* 필터·기간을 바꿀 때는 **이전 결과를 유지**하고 위에 얇은 진행 표시만 둔다(U-11) */}
      {query.isFetching && !query.isPending ? (
        <div className="mt-2 h-0.5 w-full overflow-hidden rounded-chip bg-row-divider">
          <div className="h-full w-1/3 animate-pulse bg-primary" />
        </div>
      ) : null}

      {/* 유형 탭 `top 132` + h42 → 본문 `top 198`(시안 90줄) */}
      <div className="mt-6">
      <TasksBody
        params={params}
        query={query}
        data={data}
        items={items}
        pendingId={status.pendingId}
        onOpen={openDetail}
        onSelectStatus={selectStatus}
        onContextMenu={(task, x, y) => setMenu({ ...task, x, y })}
        onAddTask={() => openTaskCreateDrawer(overlay, () => void query.refetch())}
      />
      </div>

      {/* 하단 카운트 + 페이지네이션(리스트만 — 칸반은 컬럼이 스크롤된다) */}
      {params.view === "list" && data !== undefined && data.total > 0 ? (
        <Pagination
          summary={`${formatPeriod(params.period)} · ${data.total}건 중 ${items.length}건 표시`}
          page={params.page}
          lastPage={Math.max(1, Math.ceil(data.total / data.size))}
          onGo={(page) => params.setParams({ page })}
        />
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
  data,
  items,
  pendingId,
  onOpen,
  onSelectStatus,
  onContextMenu,
  onAddTask,
}: {
  params: ReturnType<typeof useTasksViewParams>;
  query: ReturnType<typeof useTasksQuery>;
  data: ReturnType<typeof useTasksQuery>["data"];
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
        /* `n` 은 **기간만 적용한 총계**다(U-9 · §4 `unfilteredTotal`) — 「더 많은」이 아니라 수를 적는다 */
        hint={`유형·상태 필터를 지우면 ${data?.unfilteredTotal ?? 0}건이 보입니다`}
        action={
          <Button type="button" variant="outline" onClick={params.clearFilters}>
            필터 지우기
          </Button>
        }
      />
    ) : (
      <EmptyState
        message={`${formatPeriod(params.period)}에 등록된 업무가 없습니다`}
        hint="새 업무를 만들거나 다른 기간을 살펴보세요"
        action={
          <Button
            type="button"
            variant="outline"
            onClick={() => params.setPeriod(shiftPeriod(params.period, -1))}
          >
            이전 기간 보기
          </Button>
        }
      />
    );
  }

  return params.view === "board" ? (
    <KanbanBoard
      items={items}
      period={params.period}
      /** **기간 기준 수**는 집계에서 온다 — 카드를 세지 않는다(U-2 · 검수 F-2). */
      doneCount={data?.statusCounts.done ?? 0}
      total={data?.total ?? 0}
      limit={KANBAN_MAX_SIZE}
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

/**
 * **뷰 토글** — 시안 63~66줄: h34 · r8 · border `#D9D9D9` · `overflow:hidden` 세그먼트 2칸.
 * 칸은 `padding 0 13` · 13px · 아이콘 13 · `gap 6`, 사이는 `border-left #EBEBEB`.
 *
 * **활성은 `#1E1E1E` 배경 + 흰 글씨 13/700 이다**(시안 63~66·261~264줄).
 *
 * 정정 A-16 이 「유형 탭 밑줄도 Ink 라 화면당 하나가 깨진다」로 연보라(`--tm-current-bg`)를
 * 쓰게 했는데 **2026-09-06 사용자 확정으로 번복**됐다 — 유형 탭은 **밑줄**, 뷰 토글은
 * **배경**이라 표현 방식이 달라 경쟁하지 않는다. **시안이 정본이다**(REDRAW-05 F-3b).
 */
function ViewToggle({
  view,
  onChange,
}: {
  view: TasksView;
  onChange: (next: TasksView) => void;
}) {
  return (
    <div
      role="group"
      aria-label="뷰 전환"
      className="flex h-[34px] items-center overflow-hidden rounded-control border border-border bg-card"
    >
      {(["list", "board"] as const).map((item, index) => {
        const selected = view === item;
        return (
          <button
            key={item}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(item)}
            className={cn(
              "flex h-full items-center gap-1.5 px-[13px] text-meta [&_svg]:h-[13px] [&_svg]:w-[13px]",
              index > 0 && "border-l border-divider",
              selected
                ? "bg-ink font-bold text-primary-foreground"
                : "text-fg-meta hover:bg-muted hover:text-foreground",
            )}
          >
            {item === "list" ? <ListIcon /> : <BoardIcon />}
            {item === "list" ? "리스트" : "칸반"}
          </button>
        );
      })}
    </div>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <path d="M3 4.5h10M3 8h10M3 11.5h10" />
    </svg>
  );
}

function BoardIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <path d="M3 3.5h3.4v9H3zM9.6 3.5H13v6H9.6z" />
    </svg>
  );
}

/**
 * **페이지네이션** — 시안 210~217줄. 줄 전체 `justify-between`.
 * 좌측 요약 13px `#9EA2AE` · 우측 30×30 r8 버튼 `gap 6`,
 * **현재 페이지만 `#1E1E1E` 배경 + 흰 글씨 13/700**이고 나머지는 border + `#757575`.
 *
 * 문구·계산·조건은 그대로다 — 규격만 맞춘다.
 */
const PAGE_BUTTON = "flex h-[30px] w-[30px] items-center justify-center rounded-control text-meta";

function Pagination({
  summary,
  page,
  lastPage,
  onGo,
}: {
  summary: string;
  page: number;
  lastPage: number;
  onGo: (page: number) => void;
}) {
  const pages = Array.from({ length: lastPage }, (_, i) => i + 1);
  return (
    <footer className="mt-4 flex items-center justify-between gap-3">
      <span className="text-meta text-fg-caption">{summary}</span>
      <nav aria-label="페이지" className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label="이전 페이지"
          disabled={page <= 1}
          onClick={() => onGo(page - 1)}
          className={cn(PAGE_BUTTON, "border border-border text-fg-meta hover:bg-muted disabled:opacity-40")}
        >
          <svg width="7" height="11" viewBox="0 0 8 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5.5 1.5 1.5 6l4 4.5" />
          </svg>
        </button>
        {pages.map((item) => (
          <button
            key={item}
            type="button"
            aria-current={item === page ? "page" : undefined}
            onClick={() => onGo(item)}
            className={cn(
              PAGE_BUTTON,
              item === page
                ? "bg-ink font-bold text-primary-foreground"
                : "border border-border text-fg-meta hover:bg-muted",
            )}
          >
            {item}
          </button>
        ))}
        <button
          type="button"
          aria-label="다음 페이지"
          disabled={page >= lastPage}
          onClick={() => onGo(page + 1)}
          className={cn(PAGE_BUTTON, "border border-border text-fg-meta hover:bg-muted disabled:opacity-40")}
        >
          <svg width="7" height="11" viewBox="0 0 8 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M2.5 1.5 6.5 6l-4 4.5" />
          </svg>
        </button>
      </nav>
    </footer>
  );
}

export { STATUS_LABEL };
