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
 *
 * ## 순서를 저장하지 않는다(2026-09-06 사용자 확정 · DEC-002)
 *
 * **업무는 서로 순서 관계가 없다** — 각자 상태를 가질 뿐이고 「A 다음에 B」가 도메인에 없다.
 * 그래서 **「이 카드 뒤에」를 지원하지 않고 삽입 가이드선도 두지 않는다.** `order_index` 가 없다.
 * 컬럼 안 정렬은 **정렬 드롭다운을 그대로 따른다.** 드래그는 **상태 변경 UI** 하나다.
 */

import { useCallback, useRef, useState } from "react";

import { transitionBlockedReason } from "@/features/tasks/statusTransitions";
import type { TaskListItem, TaskStatus } from "@/features/tasks/types";

export interface KanbanDnd {
  /** 잡고 있는 카드 — **흐리게 그리는** 판정에 쓴다(언마운트하지 않는다 — REDRAW-06 G-0). */
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
  /**
   * **드래그 직후의 클릭 한 번을 삼킨다.** `true` 면 그 클릭을 무시하라는 뜻이다.
   *
   * 끌어다 놓으면 브라우저가 `dragend` 뒤에 `click` 을 이어서 쏜다 — 그대로 두면
   * 드롭과 동시에 상세 드로어가 열린다. **끌지 않은 순수 클릭은 영향을 받지 않는다**
   * (`dragstart` 가 없으면 플래그가 서지 않는다).
   */
  consumeDragClick: () => boolean;
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
  /**
   * 방금 드래그가 있었나 — **렌더에 쓰이지 않으므로 `ref` 다.**
   * `state` 로 두면 플래그를 내리는 것 자체가 리렌더를 부른다.
   */
  const draggedRef = useRef(false);

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
        draggedRef.current = true;
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

  /** 한 번 읽으면 내려간다 — 다음 클릭은 정상적으로 드로어를 연다. */
  const consumeDragClick = useCallback(() => {
    if (!draggedRef.current) {
      return false;
    }
    draggedRef.current = false;
    return true;
  }, []);

  return { draggingId, overStatus, dragProps, columnProps, blockedReason, consumeDragClick };
}
