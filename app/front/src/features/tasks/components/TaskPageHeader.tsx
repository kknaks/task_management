"use client";

/**
 * **확장 페이지 헤더**(시안 1536~1571 · REDRAW-03 §3-1·§3-2·§3-3).
 *
 * `align-items: flex-start` · `justify-between` — 좌(배지 줄 + 제목 32/700) / 우(컨트롤 `gap 10`).
 * 드로어와 **조각은 같고 크기만 다르다**(`TaskDetailHeader` 가 `size="page"` 로 낸다).
 *
 * ## 모드가 우측을 가른다
 *
 * | 읽기 | 수정 |
 * |---|---|
 * | 상태 칩 · 일정 칩 · `⋮`(수정·삭제) · 완료 처리 | **[취소] [저장]** 만 |
 *
 * **상태·완료를 수정 모드에 두지 않는다**(§1 규칙 3) — 서버가 `PATCH /status` 전용
 * 엔드포인트로 받고 게이트·로그·실행취소가 붙는다. 일반 저장에 `status` 를 실으면 422 다.
 * 상태는 「고쳐서 저장」이 아니라 **「지금 넘긴다」**이므로 **읽기 모드에서 즉시 반영**한다.
 *
 * 읽기 모드의 일정 칩도 **읽기 전용**이다 — 값은 텍스트로만 보고 바꾸려면 수정 모드로 간다(§3-2).
 */

import { Loader2 } from "lucide-react";

import {
  CompleteButton,
  MoreMenu,
  ProjectChipControl,
  ScheduleChipControl,
  StatusChipControl,
  TypeBadgeControl,
} from "@/features/tasks/components/TaskDetailHeader";
import { useTaskHeaderActions } from "@/features/tasks/components/TaskDetailParts";
import type { TaskEditDraft } from "@/features/tasks/hooks/useTaskEditDraft";
import type { TaskDetail } from "@/features/tasks/types";
import { cn } from "@/lib/utils";

export function TaskPageHeader({ task, draft }: { task: TaskDetail; draft: TaskEditDraft }) {
  const actions = useTaskHeaderActions(task);
  const editing = draft.editing;

  return (
    <header className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-3">
        {/* 배지 줄 — h24 · `gap 10`(시안 1540줄) */}
        <div className="flex items-center gap-2.5">
          <TypeBadgeControl
            task={task}
            size="page"
            readOnly={!editing}
            saveFailed={actions.hasFailed("workType")}
            onSelect={(id) => draft.setBody({ workTypeId: id })}
          />
          <ProjectChipControl
            task={task}
            size="page"
            readOnly={!editing}
            saveFailed={actions.hasFailed("project")}
            onSelect={(id) => draft.setBody({ projectId: id })}
          />
        </div>

        {/* 제목 32 / 700 / -0.03em — 수정 모드에서만 입력이 된다 */}
        {editing ? (
          <input
            aria-label="업무 제목"
            value={draft.body.title}
            onChange={(event) => draft.setBody({ title: event.target.value })}
            className={cn(
              "min-w-0 rounded-control border border-border bg-card px-3 py-1",
              "text-[32px] font-bold leading-[1.25] tracking-title text-foreground",
              "focus-visible:border-primary focus-visible:outline-none focus-visible:shadow-focus",
            )}
          />
        ) : (
          <h1 className="min-w-0 text-[32px] font-bold leading-[1.25] tracking-title text-foreground">
            {task.title}
          </h1>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
        {editing ? (
          <>
            {/* 저장 중에는 **[저장] 비활성 + 진행 표시** — 중복 제출이 나가지 않는다(§3-3) */}
            {/* 수정 모드에서도 **일정은 고칠 수 있다**(§3-3) — 값은 초안이다 */}
            <ScheduleChipControl
              value={{ startDate: draft.body.startDate, dueDate: draft.body.dueDate }}
              size="page"
              onChange={(next) => draft.setBody(next)}
            />
            <button
              type="button"
              onClick={draft.cancel}
              disabled={draft.saving}
              className="flex h-9 shrink-0 items-center rounded-control border border-border bg-card px-4 text-meta text-fg-muted hover:bg-muted disabled:opacity-50"
            >
              취소
            </button>
            <button
              type="button"
              onClick={draft.save}
              disabled={draft.saving || !draft.dirty}
              className="flex h-9 shrink-0 items-center gap-2 rounded-control bg-primary px-4 text-meta font-semibold text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {draft.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              저장
            </button>
          </>
        ) : (
          <>
            {/* 읽기 모드에서도 **상태·완료는 바로 동작한다**(§3-2) */}
            <StatusChipControl task={task} size="page" onSelect={actions.selectStatus} />
            <ScheduleChipControl
              value={{ startDate: task.startDate, dueDate: task.dueDate }}
              size="page"
              readOnly
              onChange={() => undefined}
            />
            <MoreMenu
              size="page"
              onEdit={draft.start}
              onDelete={() => actions.confirmDelete({ closeDrawer: false })}
            />
            <CompleteButton
              task={task}
              size="page"
              disabled={actions.statusPending}
              onComplete={actions.completeTask}
            />
          </>
        )}
      </div>
    </header>
  );
}
