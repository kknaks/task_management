"use client";

/**
 * **U-11 스켈레톤** — 리스트는 행 52 자리에 8줄, 칸반은 컬럼마다 카드 3.
 *
 * 색은 `--tm-row-divider` 토큰, **애니메이션 없음**(데스크톱 도구라 깜빡임을 만들지 않는다).
 * **첫 로딩에만 뜬다** — 필터·기간을 바꿀 때는 이전 결과를 유지하고 진행 표시만 둔다.
 * 「불러오는 중…」 문구를 쓰지 않는다.
 */

import { KANBAN_COLUMNS } from "@/features/tasks/hooks/useTasksQuery";

export function TaskListSkeleton() {
  return (
    <div className="flex flex-col" aria-busy="true" aria-label="불러오는 중">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="flex h-row items-center border-b border-row-divider px-3">
          <div className="h-4 w-1/3 rounded-chip bg-row-divider" />
        </div>
      ))}
    </div>
  );
}

export function TaskBoardSkeleton() {
  return (
    <div className="flex gap-4 overflow-x-auto" aria-busy="true" aria-label="불러오는 중">
      {KANBAN_COLUMNS.map((column) => (
        <div
          key={column}
          className="flex w-kanban-col shrink-0 flex-col gap-2 rounded-card bg-column p-3 wide:w-auto wide:flex-1"
        >
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="h-24 rounded-control bg-row-divider" />
          ))}
        </div>
      ))}
    </div>
  );
}
