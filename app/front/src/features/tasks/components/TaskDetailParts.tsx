"use client";

/**
 * 상세 표면 둘이 함께 쓰는 조각 — 스켈레톤 · **편집 가능한 헤더**(SPEC-003 U-2·U-3·U-4).
 *
 * ## 헤더는 표시 전용이 아니다
 *
 * U-2 의 인라인 편집 대상은 **제목**·배경·목표·완료 결과 넷이고, §4 PATCH 는 `workTypeId`·
 * `projectId`·기한도 받는다. 전에는 헤더가 배지·칩·기한을 **그리기만** 해서 편집 대상 4종이
 * 통째로 빠져 있었다(검수 F-1·F-2·F-3 — 뿌리가 하나다).
 *
 * **제목은 드로어 헤더가 아니라 여기 최상단**에 있다 — `openTaskDetailDrawer` 는 id 만 알고
 * 제목은 로드 후에 오기 때문이다. 그래서 **드로어와 전체 페이지가 같은 컴포넌트**로 제목을
 * 그린다(U-4 「두 표면이 다른 규격을 갖지 않는다」).
 *
 * ## 헤더 드롭다운은 **진입점 ②** 다(WORK-005 에서 살아났다)
 *
 * 상태 드롭다운 · 「완료 처리」 · `⋯` 는 WORK-004 가 **자리와 표시만** 그려 둔 곳이었다.
 * 이제 리스트 상태 셀과 **같은 `StatusPopover`**, 같은 `useTaskStatus()` 훅을 지난다 —
 * 「완료 처리」도 그 전이의 지름길일 뿐 다른 경로가 아니다(SPEC-004 U-3 · U-6).
 * **여기서 전이 호출을 새로 만들지 않는다** — 만들면 요청 본문·에러 분기·토스트가 갈린다.
 *
 * **낙관적 갱신을 하지 않는다** — 기한·유형·프로젝트는 겹침·삭제된 항목이 **거부할 수 있다**
 * (§5 표). 그래서 **원복은 저절로 된다**: 값이 애초에 안 바뀐다.
 */

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";

import { InlineEditText } from "@/components/shared/InlineEditText";
import { Selector } from "@/components/shared/Selector";
import { StatusDot, STATUS_LABEL } from "@/components/shared/StatusDot";
import { Button } from "@/components/ui/button";
import { DueDateField } from "@/features/tasks/components/DueDateField";
import { openCancelModal } from "@/features/tasks/components/CancelModal";
import { StatusPopover } from "@/features/tasks/components/StatusPopover";
import {
  TaskContextMenu,
  type ContextMenuTarget,
} from "@/features/tasks/components/TaskContextMenu";
import { useTaskStatus } from "@/features/tasks/hooks/useTaskStatus";
import { useOverlay } from "@/lib/overlay/OverlayProvider";
import {
  useTaskFieldSave,
  type FieldInlineErrors,
  type TaskField,
} from "@/features/tasks/hooks/useTaskFieldSave";
import { useProjectsQuery, useWorkTypesQuery } from "@/features/settings/hooks/useWorkSettings";
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

export function TaskHeaderControls({ task }: { task: TaskDetail }) {
  const { data: workTypes = [] } = useWorkTypesQuery();
  const { data: projects = [] } = useProjectsQuery();
  const { save, hasFailed, noticeFor } = useTaskFieldSave(task);
  /** 삭제된 유형·프로젝트처럼 **그 컨트롤 옆에 붙는** 사유(§4 Case Matrix). */
  const [inlineErrors, setInlineErrors] = useState<FieldInlineErrors>({});
  const [menu, setMenu] = useState<ContextMenuTarget | null>(null);
  const overlay = useOverlay();
  /**
   * **진입점 ② 는 새 호출을 만들지 않는다** — 리스트·칸반과 같은 훅이다.
   * 여기서 `changeTaskStatus` 를 직접 부르면 요청 본문·에러 분기·토스트가 갈린다.
   */
  const statusMutation = useTaskStatus();

  /** 「취소」만 모달을 거쳐 **같은 훅으로** 돌아온다(U-3 CTA · 팝오버가 먼저 닫힌다). */
  const selectStatus = (next: TaskStatus) => {
    setMenu(null);
    if (next === "cancelled") {
      openCancelModal(overlay, task, (input) => statusMutation.setStatus(task, input));
      return;
    }
    void statusMutation.setStatus(task, { status: next });
  };

  const onInlineError = (field: TaskField, message: string) =>
    setInlineErrors((prev) => ({ ...prev, [field]: message }));
  const clearInline = (field: TaskField) =>
    setInlineErrors((prev) => ({ ...prev, [field]: null }));

  return (
    <header className="mb-4 flex flex-col gap-3 border-b border-divider pb-4">
      {/* 제목 26·700 — **드로어와 전체 페이지가 같은 컨트롤을 쓴다**(U-3 문구·구성 · U-4) */}
      <InlineEditText
        ariaLabel="업무 제목"
        value={task.title}
        placeholder="업무 제목"
        className="[&_input]:text-detail-title [&_input]:h-auto [&_input]:py-1"
        saveFailed={hasFailed("title")}
        onSave={(next) => save("title", { title: next })}
      />

      <div className="flex flex-wrap items-center gap-2">
        {/* 유형(필수) · 프로젝트(0..1) — 값 표시는 그대로, 누르면 팝오버(F-3) */}
        <Selector
          label="유형"
          placeholder="유형"
          value={{
            id: task.workType.id,
            name: task.workType.name,
            colorToken: task.workType.colorToken,
          }}
          options={workTypes.map((item) => ({
            id: item.id,
            name: item.name,
            colorToken: item.colorToken,
          }))}
          saveFailed={hasFailed("workType")}
          onSelect={(option) => {
            if (!option) {
              return;
            }
            clearInline("workType");
            void save("workType", { workTypeId: option.id }, onInlineError);
          }}
        />
        <Selector
          label="프로젝트"
          placeholder="프로젝트 없음"
          clearable
          value={
            task.project
              ? {
                  id: task.project.id,
                  name: task.project.name,
                  colorToken: task.project.colorToken,
                }
              : null
          }
          options={projects.map((item) => ({
            id: item.id,
            name: item.name,
            colorToken: item.colorToken,
          }))}
          saveFailed={hasFailed("project")}
          onSelect={(option) => {
            clearInline("project");
            void save("project", { projectId: option?.id ?? null }, onInlineError);
          }}
        />

        <span className="flex items-center gap-1.5 text-meta text-fg-meta">
          <StatusDot status={task.status} overdue={task.isOverdue} />
          {STATUS_LABEL[task.status]}
        </span>

        <span className="flex-1" />

        {/*
          **진입점 ② — 상세 헤더 드롭다운.** 리스트 상태 셀과 **같은 `StatusPopover`** 를 쓰고
          **같은 `useTaskStatus()` 훅**을 지난다(SPEC-004 U-3 · WP §Internal Interface Contract).
          「완료 처리」는 그 전이의 지름길일 뿐 다른 경로가 아니다.
        */}
        <StatusPopover
          current={task.status}
          align="end"
          onSelect={(next) => selectStatus(next)}
          trigger={
            <Button type="button" variant="outline" size="sm">
              상태 변경
            </Button>
          }
        />
        <Button
          type="button"
          size="sm"
          disabled={task.status === "done" || statusMutation.isPending}
          onClick={() => void statusMutation.setStatus(task, { status: "done" })}
        >
          완료 처리
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="더 보기"
          onClick={(event) => setMenu({ ...task, x: event.clientX, y: event.clientY })}
        >
          <MoreHorizontal aria-hidden />
        </Button>
      </div>

      {/* 마우스 없는 경로 — 헤더 `⋯` 가 행·카드 우클릭과 **같은 메뉴**를 연다(U-5) */}
      <TaskContextMenu
        target={menu}
        onClose={() => setMenu(null)}
        onOpen={() => setMenu(null)}
        onSelectStatus={(next) => selectStatus(next)}
        onDelete={() => {
          // **드로어 위에 모달을 겹치지 않는다** — 먼저 닫고 연다(FE §6-2).
          overlay.closeDrawer();
          overlay.openConfirm({
            title: `'${task.title}' 업무를 삭제할까요?`,
            summary:
              "목록·칸반에서 사라지고 집계에서도 빠집니다. 할일·메모·첨부·로그도 함께 보이지 않게 됩니다.",
            warning: "v1 에는 복원 화면이 없습니다.",
            confirmLabel: "삭제",
            destructive: true,
            onConfirm: () => void statusMutation.removeTask(task.id),
          });
        }}
      />

      {/* 기한 — 시간까지 지정하면 겹침 검사 대상이다(DEC-005 §7). 거부되면 값이 안 바뀐다 */}
      <DueDateField
        value={{
          dueDate: task.dueDate,
          dueStartTime: task.dueStartTime,
          dueEndTime: task.dueEndTime,
        }}
        saveFailed={hasFailed("due")}
        onChange={(next) => void save("due", next)}
      />

      {inlineErrors.workType ? (
        <p className="text-caption text-destructive">{inlineErrors.workType}</p>
      ) : null}
      {inlineErrors.project ? (
        <p className="text-caption text-destructive">{inlineErrors.project}</p>
      ) : null}

      {/* U-7 — 캡션·「다시 저장」은 **이 블록의 인라인 자리 하나**에 모인다 */}
      {noticeFor("title", "due", "workType", "project")}
    </header>
  );
}
