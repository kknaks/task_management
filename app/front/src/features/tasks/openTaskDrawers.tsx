"use client";

/**
 * 드로어를 여는 자리 하나 — **부모는 `openDrawer` 만 부른다**(FE §6-1).
 *
 * 드로어 컴포넌트는 **부모를 모른다**(F-4). 같은 드로어가 리스트·칸반·캘린더 어디서 열려도
 * 같은 규격이려면 여는 방법도 한 곳이어야 한다.
 */

import { TaskCreateDrawer } from "@/features/tasks/components/TaskCreateDrawer";
import {
  TaskDetailDrawer,
  TaskDrawerHeaderConnected,
} from "@/features/tasks/components/TaskDetailDrawer";
import type { TaskDetail } from "@/features/tasks/types";
import type { useOverlay } from "@/lib/overlay/OverlayProvider";

type Overlay = ReturnType<typeof useOverlay>;

export function openTaskCreateDrawer(
  overlay: Overlay,
  onCreated: (task: TaskDetail) => void,
): void {
  overlay.openDrawer({
    key: "task-create",
    title: "새 업무",
    // 생성 드로어에는 **⤢ 가 없다**(U-1 헤더) — 아직 승격할 대상이 없다.
    content: (
      <TaskCreateDrawer
        onCancel={overlay.closeDrawer}
        onCreated={(task) => {
          overlay.closeDrawer();
          onCreated(task);
        }}
      />
    ),
  });
}

export function openTaskDetailDrawer(
  overlay: Overlay,
  taskId: number,
  options: {
    /**
     * **게이트 유도 진입**(SPEC-004 U-6) — 거부 토스트의 「결과 입력」으로 들어온 경우다.
     * 상세가 열리면 「결과자료 · 완료 결과」 카드로 스크롤하고 입력에 포커스가 잡힌다.
     * 규격은 WORK-004 의 `useCompletionCardFocus()` 가 든다 — 여기서 만들지 않는다.
     */
    focusCompletion?: boolean;
  } = {},
): void {
  overlay.openDrawer({
    key: `task-detail-${taskId}`,
    /**
     * 프레임 타이틀은 **접근성 이름**으로만 남는다 — 시안 헤더에 「업무 상세」 텍스트가 없고
     * 그 자리는 유형 배지 + 프로젝트 칩이다(REDRAW-03 H-1). 헤더 자체는 `TaskDetailDrawer` 가
     * `renderHeader` 로 그린다.
     */
    title: "업무 상세",
    // **⤢ 는 전체 페이지로 승격**된다(F-5 · U-4). 드로어가 닫히고 이 라우트로 간다.
    expandTo: `/tasks/detail/?id=${taskId}`,
    /** 시안 헤더는 3겹이라 프레임 타이틀 바를 쓰지 않는다(REDRAW-03 §2-1). */
    renderHeader: ({ fullscreen, expand, onClose }) => (
      <TaskDrawerHeaderConnected
        taskId={taskId}
        fullscreen={fullscreen}
        expand={expand}
        onClose={onClose}
      />
    ),
    content: <TaskDetailDrawer taskId={taskId} focusCompletion={options.focusCompletion} />,
  });
}
