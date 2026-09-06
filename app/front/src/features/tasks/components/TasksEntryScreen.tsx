"use client";

/**
 * **임시 진입 화면** — 「새 업무」 버튼 + 방금 만든 업무.
 *
 * 목록·칸반은 **WORK-005** 가 이 자리를 대체한다(WP Phase 5 설명). 여기서 리스트를 만들지
 * 않는 이유가 그것이다 — **상태를 바꾸는 UI 를 만들지 않는다**(리스트 셀·칸반·상태 드롭다운).
 */

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import { TypeBadge } from "@/components/shared/TypeBadge";
import { Button } from "@/components/ui/button";
import { openTaskCreateDrawer, openTaskDetailDrawer } from "@/features/tasks/openTaskDrawers";
import type { TaskDetail } from "@/features/tasks/types";
import { useOverlay } from "@/lib/overlay/OverlayProvider";

export function TasksEntryScreen() {
  const overlay = useOverlay();
  const [created, setCreated] = useState<TaskDetail[]>([]);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center justify-between">
        <h1 className="text-page-title text-foreground">내 업무</h1>
        <Button
          type="button"
          onClick={() =>
            openTaskCreateDrawer(overlay, (task) => setCreated((prev) => [task, ...prev]))
          }
        >
          <Plus aria-hidden />새 업무
        </Button>
      </header>

      {created.length === 0 ? (
        <p className="text-body text-muted-foreground">
          「새 업무」로 업무를 만들면 여기에 나타납니다. 목록·칸반은 다음 배치가 채웁니다.
        </p>
      ) : (
        <ul className="rounded-card border border-border bg-card">
          {created.map((task) => (
            <li
              key={task.id}
              className="flex h-16 items-center gap-3 border-b border-row-divider px-5 last:border-b-0 hover:bg-row-hover"
            >
              <TypeBadge name={task.workType.name} colorToken={task.workType.colorToken} />
              <button
                type="button"
                onClick={() => openTaskDetailDrawer(overlay, task.id)}
                className="min-w-0 flex-1 truncate text-left text-body text-foreground hover:underline"
              >
                {task.title}
              </button>
              <Link
                href={`/tasks/detail/?id=${task.id}`}
                className="shrink-0 text-meta text-muted-foreground hover:underline"
              >
                전체 페이지
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
