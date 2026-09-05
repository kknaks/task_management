"use client";

/**
 * **U-4 전체 페이지 승격**(SPEC-003 · P-23).
 *
 * 좌(유동) 본문 + 우(528) 메모·로그 2단. 1280~1439 에서는 **우 400**(U-11).
 * breadcrumb 「홈 › 내 업무 › <제목>」. **드로어로 되돌리는 버튼은 없다** — 승격은 한 방향(F-5).
 *
 * 본문은 `TaskDetailBody` 가 내보내는 **같은 블록**이다 — 드로어와 다른 규격을 갖지 않는다(U-4).
 */

import Link from "next/link";

import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { TaskAsideBlocks, TaskMainBlocks } from "@/features/tasks/components/TaskDetailBody";
import { TaskDetailSkeleton, TaskHeaderControls } from "@/features/tasks/components/TaskDetailParts";
import { isTaskNotFound } from "@/features/tasks/errors";
import { useTaskDetailQuery } from "@/features/tasks/hooks/useTaskMutations";
import { useTasksViewParams } from "@/features/tasks/hooks/useTasksViewParams";

export function TaskDetailPage() {
  const { id } = useTasksViewParams();
  const { data: task, isPending, error } = useTaskDetailQuery(id);

  if (id === null) {
    return <NotFound />;
  }
  if (isPending) {
    return <TaskDetailSkeleton />;
  }
  if (error) {
    return isTaskNotFound(error) ? (
      <NotFound />
    ) : (
      <EmptyState message="업무를 불러오지 못했습니다" />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="breadcrumb" className="flex items-center gap-1.5 text-meta text-fg-caption">
        <span>홈</span>
        <span aria-hidden>›</span>
        <Link href="/tasks/" className="hover:underline">
          내 업무
        </Link>
        <span aria-hidden>›</span>
        <span className="truncate text-fg-meta">{task.title}</span>
      </nav>

      <h1 className="text-detail-title text-foreground">{task.title}</h1>
      <TaskHeaderControls task={task} />

      {/* 좌(유동) + 우(≥1440 은 528 · 1280~1439 는 400) 2단(U-11) */}
      <div className="flex flex-col gap-5 desk:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <TaskMainBlocks task={task} />
        </div>
        <aside className="flex w-full shrink-0 flex-col gap-6 desk:w-[400px] wide:w-detail-aside">
          <TaskAsideBlocks task={task} />
        </aside>
      </div>
    </div>
  );
}

/** **자동으로 튕기지 않는다** — 「없는 업무입니다」 + 「목록으로」(U-3 · FE §1-2). */
function NotFound() {
  return (
    <EmptyState
      message="없는 업무입니다"
      action={
        <Button asChild variant="outline" size="sm">
          <Link href="/tasks/">목록으로</Link>
        </Button>
      }
    />
  );
}
