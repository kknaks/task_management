"use client";

/**
 * **U-4 전체 페이지 승격**(SPEC-003 · P-23 · REDRAW-03 §3).
 *
 * 좌 **1080**(설명·할일·메모) + 우 **528**(참고자료·결과자료·연관업무·로그) 2단.
 * 1280~1439 에서는 우 400(U-11). breadcrumb 「홈 › 내 업무 › <제목>」.
 * **드로어로 되돌리는 버튼은 없다** — 승격은 한 방향(F-5).
 *
 * ## 모드가 둘이다(§1 사용자 확정)
 *
 * | | 읽기 | 수정 |
 * |---|---|---|
 * | 값 | **텍스트로 보기만** | 전부 입력 |
 * | 상태·완료 | **바로 동작** | **없다**(전용 엔드포인트라 일반 저장에 못 싣는다) |
 * | 헤더 우측 | `⋮`(수정·삭제) | **[취소] [저장]** |
 *
 * **수정 모드는 전부 초안이다** — [저장] 이면 한 번에, **[취소] 면 제목도 할일도 전부 버린다.**
 * 블록 배치는 드로어와 다르지만 **블록 내부 규격은 같다**(폭만 다르다).
 */

import Link from "next/link";

import { DetailHeaderBar, HOME_CRUMB, TASKS_CRUMB, TASKS_ROUTE } from "@/components/shared/AppShell";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { TaskPageBlocks } from "@/features/tasks/components/TaskDetailBody";
import { TaskDetailSkeleton } from "@/features/tasks/components/TaskDetailParts";
import { TaskPageHeader } from "@/features/tasks/components/TaskPageHeader";
import { useTaskEditDraft } from "@/features/tasks/hooks/useTaskEditDraft";
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

  return <PageBody task={task} />;
}

function PageBody({ task }: { task: import("@/features/tasks/types").TaskDetail }) {
  const draft = useTaskEditDraft(task);

  return (
    <div className="flex flex-col">
      {/* 「←」 + breadcrumb — 공용 부품 하나다(FE §6-3 · MF-7). 「←」는 `/tasks/`(부모 라우트 · `router.back()` 아님) */}
      <DetailHeaderBar trail={[HOME_CRUMB, TASKS_CRUMB, { label: task.title }]} backTo={TASKS_ROUTE} />

      {/* 헤더 — 시안 1536~1571. `top 66` 이라 breadcrumb 아래 20 이 남는다 */}
      <div className="mt-5">
        <TaskPageHeader task={task} draft={draft} />
      </div>

      {/* 좌 1080 / 우 528 — 시안 1574·1657줄. 둘 다 `top 180 · gap 24` */}
      <div className="mt-6 flex flex-col gap-6 desk:flex-row">
        <TaskPageBlocks task={task} draft={draft} />
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
