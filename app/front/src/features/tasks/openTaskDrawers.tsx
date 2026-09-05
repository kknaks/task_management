"use client";

/**
 * 드로어를 여는 자리 하나 — **부모는 `openDrawer` 만 부른다**(FE §6-1).
 *
 * 드로어 컴포넌트는 **부모를 모른다**(F-4). 같은 드로어가 리스트·칸반·캘린더 어디서 열려도
 * 같은 규격이려면 여는 방법도 한 곳이어야 한다.
 */

import { TaskCreateDrawer } from "@/features/tasks/components/TaskCreateDrawer";
import { TaskDetailDrawer } from "@/features/tasks/components/TaskDetailDrawer";
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

export function openTaskDetailDrawer(overlay: Overlay, taskId: number): void {
  overlay.openDrawer({
    key: `task-detail-${taskId}`,
    /**
     * 프레임 헤더는 **화면 이름**만 든다 — 여는 시점에는 id 만 알고 제목은 로드 후에 온다.
     * **업무 제목은 본문 최상단**에서 `InlineEditText` 로 그린다(검수 F-1) —
     * 전체 페이지와 **같은 컴포넌트**라 두 표면이 다른 규격을 갖지 않는다(U-4).
     */
    title: "업무 상세",
    // **⤢ 는 전체 페이지로 승격**된다(F-5 · U-4). 드로어가 닫히고 이 라우트로 간다.
    expandTo: `/tasks/detail/?id=${taskId}`,
    content: <TaskDetailDrawer taskId={taskId} />,
  });
}
