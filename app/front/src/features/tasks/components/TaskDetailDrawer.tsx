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

import { useEffect } from "react";
import { X } from "lucide-react";

import { EmptyState } from "@/components/shared/EmptyState";
import { TaskDetailBody } from "@/features/tasks/components/TaskDetailBody";
import {
  TaskDetailSkeleton,
  TaskDrawerHeader,
} from "@/features/tasks/components/TaskDetailParts";
import { HeaderIconButton } from "@/features/tasks/components/TaskDetailHeader";
import { isTaskNotFound } from "@/features/tasks/errors";
import { useCompletionCardFocus } from "@/features/tasks/hooks/useCompletionCardFocus";
import { useTaskDetailQuery } from "@/features/tasks/hooks/useTaskMutations";

/**
 * 드로어 헤더 — `renderHeader` 는 **여는 시점**에 불리므로 `taskId` 만 안다.
 * 여기서 같은 쿼리를 다시 읽는다 — **TanStack Query 가 같은 키를 합쳐** 요청이 늘지 않는다.
 * 로드 전에는 **헤더 자리를 비워 둔다**(빈 껍데기를 먼저 보여주지 않는다 — U-3).
 */
export function TaskDrawerHeaderConnected({
  taskId,
  fullscreen,
  expand,
  onClose,
}: {
  taskId: number;
  fullscreen: boolean;
  expand: (() => void) | null;
  onClose: () => void;
}) {
  const { data: task } = useTaskDetailQuery(taskId);
  if (!task) {
    return (
      <header className="flex items-center justify-end gap-2 border-b border-divider px-7 pb-[18px] pt-5">
        <HeaderIconButton size="drawer" label="드로어 닫기" onClick={onClose}>
          <X className="h-3 w-3" aria-hidden />
        </HeaderIconButton>
      </header>
    );
  }
  return (
    <TaskDrawerHeader task={task} fullscreen={fullscreen} expand={expand} onClose={onClose} />
  );
}

export function TaskDetailDrawer({
  taskId,
  focusCompletion = false,
}: {
  taskId: number;
  /** 게이트 유도 진입(SPEC-004 U-6) — 로드가 끝나면 완료 결과로 데려간다. */
  focusCompletion?: boolean;
}) {
  const { data: task, isPending, error } = useTaskDetailQuery(taskId);
  const completion = useCompletionCardFocus();

  /**
   * **로드가 끝난 뒤에** 부른다 — 스켈레톤 상태에서는 카드도 입력도 아직 없다.
   * `focus()` 가 스크롤·포커스·1.5초 강조 셋을 함께 한다(WORK-004 가 소유한 규격).
   */
  const ready = !isPending && !error;
  useEffect(() => {
    if (focusCompletion && ready) {
      completion.focus();
    }
    // `completion.focus` 는 안정적인 콜백이다(useCallback []).
  }, [completion.focus, focusCompletion, ready]);

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

  return <TaskDetailBody task={task} completion={completion} />;
}
