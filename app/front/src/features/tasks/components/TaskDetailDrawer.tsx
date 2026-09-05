"use client";

/**
 * **U-3 업무 상세 드로어** — 본문을 감싸는 **껍데기 하나**(SPEC-003).
 *
 * 헤더: 유형 배지 + 프로젝트 칩 / 제목 26·700 / **상태 드롭다운 · 기한 · 「완료 처리」 · `⋯`** ·
 * ⤢ · ×. **상태 드롭다운 · 「완료 처리」 · `⋯` 는 자리와 표시만 계약**이고 동작은
 * SPEC-004(WORK-005)가 정의한다 — 여기서는 **비활성**이라 눌러도 요청이 나가지 않는다.
 *
 * 폭·헤더 높이·스크림은 `DrawerFrame` 이 정한다. 이 파일은 **본문과 헤더 내용**만 준다.
 * 본문은 `TaskDetailBody` 하나 — 전체 페이지와 **같은 블록·같은 규격**이다(U-4).
 */

import { EmptyState } from "@/components/shared/EmptyState";
import { TaskDetailBody } from "@/features/tasks/components/TaskDetailBody";
import { TaskDetailSkeleton, TaskHeaderControls } from "@/features/tasks/components/TaskDetailParts";
import { isTaskNotFound } from "@/features/tasks/errors";
import { useTaskDetailQuery } from "@/features/tasks/hooks/useTaskMutations";

export function TaskDetailDrawer({ taskId }: { taskId: number }) {
  const { data: task, isPending, error } = useTaskDetailQuery(taskId);

  if (isPending) {
    // **빈 드로어를 먼저 보여주지 않는다** — 스켈레톤(애니메이션 없음 · U-3).
    return <TaskDetailSkeleton />;
  }

  if (error) {
    // **리다이렉트하지 않는다**(U-3 · FE §1-2).
    return (
      <EmptyState
        message={isTaskNotFound(error) ? "없는 업무입니다" : "업무를 불러오지 못했습니다"}
        hint="목록으로 돌아가 다시 골라 주세요"
      />
    );
  }

  return (
    <>
      <TaskHeaderControls task={task} />
      <TaskDetailBody task={task} />
    </>
  );
}
