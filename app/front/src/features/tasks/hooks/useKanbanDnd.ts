"use client";

/**
 * **U-4 칸반 DnD 규격**(SPEC-004). HTML5 드래그앤드롭만 쓴다 — 라이브러리를 늘리지 않는다.
 *
 * ## 이 훅이 드는 규칙 셋
 *
 * 1. **드롭 차단과 서버 판정은 별개다.** 전이 그래프로 막히는 컬럼은 **드롭 자체를 막고**
 *    (흐림 + `not-allowed` + 툴팁), **완료 컬럼은 언제나 드롭을 허용한다** —
 *    결과자료 유무를 화면이 미리 판단하면 서버와 어긋난다(§5 · WP §Internal Interface Contract)
 * 2. **같은 컬럼에 다시 놓으면 요청을 내지 않는다.** 서버는 같은 상태 재전송을 409 로 돌려주므로
 *    (전이 그래프에 자기 자신이 없다) 요청을 내면 **사용자가 아무것도 안 했는데 에러를 본다.**
 *    조용히 아무 일도 일어나지 않는다
 * 3. **낙관적으로 옮기지 않는다.** 즉각성은 **드래그 고스트**가 주고, 놓은 뒤에는 응답까지
 *    그 자리를 로딩(불투명도 0.6)으로 유지한다(FE §3-4)
 */

import { useCallback, useState } from "react";

import { transitionBlockedReason } from "@/features/tasks/statusTransitions";
import type { TaskListItem, TaskStatus } from "@/features/tasks/types";

export interface KanbanDnd {
  /** 잡고 있는 카드 — 원래 자리에 **점선 플레이스홀더**를 남기는 판정에 쓴다. */
  draggingId: number | null;
  /** 지금 커서가 올라가 있는 컬럼 — 드롭 가능이면 선택 색이 된다. */
  overStatus: TaskStatus | null;
  dragProps: (task: TaskListItem) => {
    draggable: true;
    onDragStart: (event: React.DragEvent) => void;
    onDragEnd: () => void;
  };
  columnProps: (status: TaskStatus) => {
    onDragOver: (event: React.DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (event: React.DragEvent) => void;
  };
  /** 이 컬럼에 놓을 수 있나 — `null` 이면 놓을 수 있고, 문자열이면 그게 툴팁 문구다. */
  blockedReason: (status: TaskStatus) => string | null;
}

export function useKanbanDnd({
  items,
  onDrop,
}: {
  items: readonly TaskListItem[];
  /** 컬럼이 실제로 바뀔 때만 불린다 — 같은 컬럼 재드롭은 여기까지 오지 않는다. */
  onDrop: (task: TaskListItem, next: TaskStatus) => void;
}): KanbanDnd {
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [overStatus, setOverStatus] = useState<TaskStatus | null>(null);

  const dragging = items.find((item) => item.id === draggingId) ?? null;

  /**
   * **완료 컬럼은 언제나 열려 있다** — 게이트는 서버가 판정한다.
   * 전이 그래프가 막는 조합만 여기서 막는다(예: 완료 → 취소).
   */
  const blockedReason = useCallback(
    (status: TaskStatus): string | null => {
      if (dragging === null || dragging.status === status) {
        return null;
      }
      return transitionBlockedReason(dragging.status, status);
    },
    [dragging],
  );

  const dragProps = useCallback(
    (task: TaskListItem) => ({
      draggable: true as const,
      onDragStart: (event: React.DragEvent) => {
        setDraggingId(task.id);
        event.dataTransfer.effectAllowed = "move";
        // 값이 없으면 일부 브라우저가 드래그를 시작하지 않는다.
        event.dataTransfer.setData("text/plain", String(task.id));
      },
      onDragEnd: () => {
        setDraggingId(null);
        setOverStatus(null);
      },
    }),
    [],
  );

  const columnProps = useCallback(
    (status: TaskStatus) => ({
      onDragOver: (event: React.DragEvent) => {
        if (dragging === null) {
          return;
        }
        if (blockedReason(status) !== null) {
          // **놓을 수 없다** — `preventDefault` 를 하지 않으면 브라우저가 드롭을 거절한다.
          event.dataTransfer.dropEffect = "none";
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOverStatus(status);
      },
      onDragLeave: () => setOverStatus((prev) => (prev === status ? null : prev)),
      onDrop: (event: React.DragEvent) => {
        event.preventDefault();
        setOverStatus(null);
        setDraggingId(null);
        if (dragging === null || blockedReason(status) !== null) {
          return;
        }
        // **같은 컬럼이면 요청이 나가지 않는다**(규칙 2).
        if (dragging.status === status) {
          return;
        }
        onDrop(dragging, status);
      },
    }),
    [blockedReason, dragging, onDrop],
  );

  return { draggingId, overStatus, dragProps, columnProps, blockedReason };
}
