"use client";

/**
 * **좌 목록 패널 500**(SPEC-006 U-2 · 회의록.dc.html L70~146) — 1280~1439 에서는 400(U-6).
 *
 * 헤더 48(「8월 회의록」 13/700 + 「n건」 + 정렬 트리거) → 필터 칩 행 52 → 행 목록(세로 스크롤).
 *
 * - *로딩*: 스켈레톤은 **첫 로딩에만**. 달·필터를 바꿀 때는 **이전 결과를 유지한 채** 얇은 진행 표시
 * - *빈 상태* 2종: 이번 달 없음(「새 회의록」 + 「이전 달 보기」) / 필터 결과 없음(「필터 지우기」 + 「필터를 지우면 n건이 보입니다」)
 * - *조회 실패*: **빈 목록으로 대체하지 않는다** — 실패 표시 + 「다시 시도」(요청 1회)
 *
 * `total` 은 필터 적용 후(헤더 「n건」), 칩 숫자는 필터 전(`projectCounts`) — 칩이 흔들리지 않는다.
 */

import { Plus } from "lucide-react";

import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { MeetingProjectChips } from "@/features/meetings/components/MeetingProjectChips";
import { MeetingRow } from "@/features/meetings/components/MeetingRow";
import { MeetingListSkeleton } from "@/features/meetings/components/MeetingSkeleton";
import { MeetingSortPopover } from "@/features/meetings/components/MeetingSortPopover";
import type {
  MeetingListItem,
  MeetingListResponse,
  MeetingProjectFilter,
  MeetingSort,
} from "@/features/meetings/types";
import { formatPeriod, formatPeriodShort, type Period } from "@/lib/datetime";

export function MeetingListPanel({
  period,
  data,
  isPending,
  isFetching,
  isError,
  projectId,
  sort,
  selectedId,
  onSelect,
  onOpen,
  onContextMenu,
  onProjectChange,
  onSortChange,
  onRetry,
  onCreate,
  onPrevMonth,
}: {
  period: Period;
  data: MeetingListResponse | undefined;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  projectId: MeetingProjectFilter;
  sort: MeetingSort;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onOpen: (id: number) => void;
  onContextMenu: (meeting: MeetingListItem, x: number, y: number) => void;
  onProjectChange: (next: MeetingProjectFilter) => void;
  onSortChange: (next: MeetingSort) => void;
  onRetry: () => void;
  onCreate: () => void;
  onPrevMonth: () => void;
}) {
  const items = data?.items ?? [];
  /** 「필터를 지우면 n건이 보입니다」의 n — 칩 집계의 합(필터 전 그 달 전체). */
  const unfiltered = (data?.projectCounts ?? []).reduce((sum, row) => sum + row.count, 0);

  return (
    <section
      aria-label="회의록 목록"
      className="flex w-[400px] shrink-0 flex-col overflow-hidden rounded-panel border border-border bg-card wide:w-[500px]"
    >
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-[18px]">
        <span className="text-meta font-bold text-foreground">{formatPeriodShort(period)} 회의록</span>
        <span className="text-caption text-fg-caption">{data?.total ?? 0}건</span>
        <span className="ml-auto">
          <MeetingSortPopover value={sort} onChange={onSortChange} />
        </span>
      </header>

      <MeetingProjectChips counts={data?.projectCounts ?? []} value={projectId} onChange={onProjectChange} />

      {/* 달·필터를 바꿀 때는 **이전 결과를 유지**하고 위에 얇은 진행 표시만 둔다 */}
      {isFetching && !isPending ? (
        <div role="progressbar" aria-label="불러오는 중" className="h-0.5 w-full overflow-hidden bg-row-divider">
          <div className="h-full w-1/3 animate-pulse bg-primary" />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isPending ? (
          <MeetingListSkeleton />
        ) : isError ? (
          <EmptyState
            message="회의록을 불러오지 못했습니다"
            hint="잠시 후 다시 시도해 주세요"
            action={
              <Button type="button" variant="outline" onClick={onRetry}>
                다시 시도
              </Button>
            }
          />
        ) : items.length === 0 ? (
          projectId !== null ? (
            <EmptyState
              message="이 프로젝트의 회의록이 없습니다"
              hint={`필터를 지우면 ${unfiltered}건이 보입니다`}
              action={
                <Button type="button" variant="outline" onClick={() => onProjectChange(null)}>
                  필터 지우기
                </Button>
              }
            />
          ) : (
            <EmptyState
              message={`${formatPeriod(period)}에 회의록이 없습니다`}
              action={
                <span className="flex items-center gap-2">
                  <Button type="button" onClick={onCreate} className="gap-1.5 [&_svg]:h-3.5 [&_svg]:w-3.5">
                    <Plus aria-hidden />새 회의록
                  </Button>
                  <Button type="button" variant="outline" onClick={onPrevMonth}>
                    이전 달 보기
                  </Button>
                </span>
              }
            />
          )
        ) : (
          <ul className="flex flex-col">
            {items.map((meeting) => (
              <MeetingRow
                key={meeting.id}
                meeting={meeting}
                selected={meeting.id === selectedId}
                onSelect={onSelect}
                onOpen={onOpen}
                onContextMenu={onContextMenu}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
