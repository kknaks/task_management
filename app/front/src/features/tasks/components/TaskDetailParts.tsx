"use client";

/**
 * 상세 표면 둘이 함께 쓰는 조각 — 스켈레톤·헤더 컨트롤(SPEC-003 U-3).
 *
 * **상태 드롭다운 · 「완료 처리」 · `⋯` 는 자리와 표시만**이다. 동작은 SPEC-004(WORK-005)가
 * 정의한다 — 여기서는 **비활성**이고 눌러도 아무 요청이 나가지 않는다.
 */

import { MoreHorizontal } from "lucide-react";

import { StatusDot, STATUS_LABEL } from "@/components/shared/StatusDot";
import { TypeBadge } from "@/components/shared/TypeBadge";
import { Button } from "@/components/ui/button";
import type { TaskDetail } from "@/features/tasks/types";
import { formatDue } from "@/lib/datetime";

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
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-divider pb-4">
      <TypeBadge name={task.workType.name} colorToken={task.workType.colorToken} />
      {task.project ? (
        <span className="inline-flex h-5 shrink-0 items-center rounded-chip bg-row-divider px-2 text-badge text-muted-foreground">
          {task.project.name}
        </span>
      ) : null}

      <span className="flex items-center gap-1.5 text-meta text-fg-meta">
        <StatusDot status={task.status} overdue={task.isOverdue} />
        {STATUS_LABEL[task.status]}
      </span>

      {/* 기한 — 없으면 「기한 없음」을 회색으로 적는다(빈칸으로 두지 않는다 · U-3) */}
      <span className="text-meta text-fg-caption">
        {formatDue(task.dueDate, task.dueStartTime, task.dueEndTime)}
      </span>

      <span className="flex-1" />

      {/*
        아래 셋은 **자리와 표시만**이다 — 동작은 SPEC-004(WORK-005).
        `disabled` 라 눌러도 **아무 요청이 나가지 않는다.**
      */}
      <Button type="button" variant="outline" size="sm" disabled title="다음 배치에서 연결됩니다">
        상태 변경
      </Button>
      <Button type="button" size="sm" disabled title="다음 배치에서 연결됩니다">
        완료 처리
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled
        aria-label="더 보기"
        title="다음 배치에서 연결됩니다"
      >
        <MoreHorizontal aria-hidden />
      </Button>
    </div>
  );
}
