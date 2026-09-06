"use client";

/**
 * 상세 표면 둘이 함께 쓰는 조각 — 스켈레톤 · **헤더 블록**(SPEC-003 U-2·U-3·U-4).
 *
 * ## 시안대로 다시 그렸다(REDRAW-03 §2-1)
 *
 * 전에는 「업무 상세」 텍스트 + 셀렉터 박스 2개 + 「상태 변경」 버튼 + 전체폭 일정 입력 2칸이었다.
 * 시안(1888~1912)은 **배지 줄 / 제목 / 칩 줄** 세 겹이고 `⋮ ⤢ ✕` 가 첫 줄 우측에 붙는다.
 * 조각 자체는 `TaskDetailHeader.tsx` 가 갖고 **드로어와 확장 페이지가 같은 것을 쓴다**(U-4).
 *
 * ## 편집은 그대로 살아 있다
 *
 * 유형·프로젝트는 **배지/칩이 팝오버를 연다**(H-3) — 셀렉터 박스만 사라졌지 편집이 사라진 게
 * 아니다(WORK-004 검수 FAIL 을 되살리지 않는다). 상태는 **칩 자신이** 목록을 열고(H-4),
 * 일정은 **칩 하나**가 달력을 연다(H-5).
 *
 * ## 헤더 드롭다운은 **진입점 ②** 다
 *
 * 리스트 상태 셀과 **같은 `StatusPopover`**, 같은 `useTaskStatus()` 훅을 지난다 —
 * 「완료 처리」도 그 전이의 지름길일 뿐 다른 경로가 아니다(SPEC-004 U-3 · U-6).
 * **여기서 전이 호출을 새로 만들지 않는다.**
 *
 * **낙관적 갱신을 하지 않는다** — 일정·유형·프로젝트는 겹침·삭제된 항목이 **거부할 수 있다**
 * (§5 표). 그래서 **원복은 저절로 된다**: 값이 애초에 안 바뀐다.
 */

import { useState } from "react";
import { ArrowLeft, Maximize2, X } from "lucide-react";

import {
  CompleteButton,
  HeaderIconButton,
  MoreMenu,
  ProjectChipControl,
  ScheduleChipControl,
  StatusChipControl,
  TitleControl,
  TypeBadgeControl,
} from "@/features/tasks/components/TaskDetailHeader";
import { openCancelModal } from "@/features/tasks/components/CancelModal";
import { useTaskStatus } from "@/features/tasks/hooks/useTaskStatus";
import { useOverlay } from "@/lib/overlay/OverlayProvider";
import {
  useTaskFieldSave,
  type FieldInlineErrors,
  type TaskField,
} from "@/features/tasks/hooks/useTaskFieldSave";
import type { TaskDetail, TaskStatus } from "@/features/tasks/types";

/** 로딩 — 회색 블록(`--tm-row-divider`), **애니메이션 없음**(데스크톱 도구라 깜빡임을 만들지 않는다). */
export function TaskDetailSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="불러오는 중">
      <div className="h-8 w-2/3 rounded-control bg-row-divider" />
      <div className="h-24 rounded-card bg-row-divider" />
      <div className="h-24 rounded-card bg-row-divider" />
      <div className="h-40 rounded-card bg-row-divider" />
    </div>
  );
}

/**
 * 상세의 **편집 배선 한 벌** — 두 표면이 같은 훅을 지난다.
 * 헤더가 쓰는 것과 본문이 쓰는 것이 갈리지 않게 여기서 만들어 내려준다.
 */
export function useTaskHeaderActions(task: TaskDetail) {
  const { save, hasFailed, noticeFor } = useTaskFieldSave(task);
  const [inlineErrors, setInlineErrors] = useState<FieldInlineErrors>({});
  const overlay = useOverlay();
  const statusMutation = useTaskStatus();

  const onInlineError = (field: TaskField, message: string) =>
    setInlineErrors((prev) => ({ ...prev, [field]: message }));
  const clearInline = (field: TaskField) =>
    setInlineErrors((prev) => ({ ...prev, [field]: null }));

  /** 「취소」만 모달을 거쳐 **같은 훅으로** 돌아온다(U-3 CTA · 팝오버가 먼저 닫힌다). */
  const selectStatus = (next: TaskStatus) => {
    if (next === "cancelled") {
      openCancelModal(overlay, task, (input) => statusMutation.setStatus(task, input));
      return;
    }
    void statusMutation.setStatus(task, { status: next });
  };

  const confirmDelete = ({ closeDrawer }: { closeDrawer: boolean }) => {
    // **드로어 위에 모달을 겹치지 않는다** — 먼저 닫고 연다(FE §6-2).
    if (closeDrawer) {
      overlay.closeDrawer();
    }
    overlay.openConfirm({
      title: `'${task.title}' 업무를 삭제할까요?`,
      summary:
        "목록·칸반에서 사라지고 집계에서도 빠집니다. 할일·메모·첨부·로그도 함께 보이지 않게 됩니다.",
      warning: "v1 에는 복원 화면이 없습니다.",
      confirmLabel: "삭제",
      destructive: true,
      onConfirm: () => void statusMutation.removeTask(task.id),
    });
  };

  return {
    save,
    hasFailed,
    noticeFor,
    inlineErrors,
    onInlineError,
    clearInline,
    selectStatus,
    confirmDelete,
    statusPending: statusMutation.isPending,
    completeTask: () => void statusMutation.setStatus(task, { status: "done" }),
  };
}

/**
 * **드로어 헤더 블록**(시안 1888~1912).
 *
 * `padding 20px 28px 18px` · `border-bottom 1px #EBEBEB` · 줄 사이 **`gap 14`**.
 * 프레임의 타이틀 바를 쓰지 않고 이 블록이 헤더 자리를 통째로 갖는다(`renderHeader`).
 */
export function TaskDrawerHeader({
  task,
  fullscreen,
  expand,
  onClose,
}: {
  task: TaskDetail;
  /** 1280~1439 — 스크림이 없어지고 **`←` 가 닫는 길**이다(디자인 시스템 08). */
  fullscreen: boolean;
  expand: (() => void) | null;
  onClose: () => void;
}) {
  const actions = useTaskHeaderActions(task);

  return (
    <header className="flex flex-col gap-3.5 border-b border-divider px-7 pb-[18px] pt-5">
      {/* ① 배지 줄 — 좌 유형·프로젝트 / 우 `⋮ ⤢ ✕`(H-1·H-2) */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {fullscreen ? (
            <HeaderIconButton size="drawer" label="닫기" onClick={onClose}>
              <ArrowLeft className="h-[15px] w-[15px]" aria-hidden />
            </HeaderIconButton>
          ) : null}
          <TypeBadgeControl
            task={task}
            size="drawer"
            saveFailed={actions.hasFailed("workType")}
            onSelect={(id) => {
              actions.clearInline("workType");
              void actions.save("workType", { workTypeId: id }, actions.onInlineError);
            }}
          />
          <ProjectChipControl
            task={task}
            size="drawer"
            saveFailed={actions.hasFailed("project")}
            onSelect={(id) => {
              actions.clearInline("project");
              void actions.save("project", { projectId: id }, actions.onInlineError);
            }}
          />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* **`⋮` 에 「삭제」만**(H-7) — 이미 열려 있고 상태는 옆 칩이 바꾼다 */}
          <MoreMenu size="drawer" onDelete={() => actions.confirmDelete({ closeDrawer: true })} />
          {expand ? (
            <HeaderIconButton size="drawer" label="전체 페이지로 열기" onClick={expand}>
              <Maximize2 className="h-[13px] w-[13px]" aria-hidden />
            </HeaderIconButton>
          ) : null}
          {fullscreen ? null : (
            <HeaderIconButton size="drawer" label="드로어 닫기" onClick={onClose}>
              <X className="h-3 w-3" aria-hidden />
            </HeaderIconButton>
          )}
        </div>
      </div>

      {/* ② 제목 26/700/-0.03em — 인라인 편집(포커스 벗어나면 저장) */}
      <TitleControl
        task={task}
        size="drawer"
        saveFailed={actions.hasFailed("title")}
        onSave={(next) => actions.save("title", { title: next })}
      />

      {/* ③ 상태 칩 · 일정 칩 · 「완료 처리」(H-4·H-5·H-6) */}
      <div className="flex items-center gap-2.5">
        <StatusChipControl task={task} size="drawer" onSelect={actions.selectStatus} />
        <ScheduleChipControl
          value={{ startDate: task.startDate, dueDate: task.dueDate }}
          size="drawer"
          onChange={(next) => void actions.save("due", next)}
        />
        <span className="ml-auto flex items-center gap-2.5">
          <CompleteButton
            task={task}
            size="drawer"
            disabled={actions.statusPending}
            onComplete={actions.completeTask}
          />
        </span>
      </div>

      {actions.inlineErrors.workType ? (
        <p className="text-caption text-destructive">{actions.inlineErrors.workType}</p>
      ) : null}
      {actions.inlineErrors.project ? (
        <p className="text-caption text-destructive">{actions.inlineErrors.project}</p>
      ) : null}

      {/* U-7 — 캡션·「다시 저장」은 **이 블록의 인라인 자리 하나**에 모인다 */}
      {actions.noticeFor("title", "due", "workType", "project")}
    </header>
  );
}
