"use client";

/**
 * **회의록 목록 페이지**(SPEC-006 U-1·U-2·U-8 · 회의록.dc.html L24~231).
 *
 * 타이틀 28/700 + **월 스테퍼**(`PeriodStepper` 재사용 · `?month=`) + 「새 회의록」 34 → 2패널
 * (좌 500 고정 / 우 유동 · 1280~1439 에서는 좌 400).
 *
 * - **조건은 전부 `?` 에 있다** — 달·프로젝트·정렬·선택 행. 새로고침해도 그 달이다
 * - 첫 진입에 **가장 최근 행이 선택**되어 우측에 보인다. 생성 직후엔 **새 행이 선택**된다.
 *   삭제하면 **다음 행**이 선택된다
 * - 행 우클릭 → 컨텍스트 메뉴 220 → 「삭제」 → **U-5 모달**(`recording`·`generating` 비활성)
 * - 회의록 검색은 v1 에 없다(§1) — 검색 입력을 두지 않는다
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { PeriodStepper } from "@/components/shared/PeriodStepper";
import { Button } from "@/components/ui/button";
import { MeetingContextMenu, type MeetingMenuTarget } from "@/features/meetings/components/MeetingContextMenu";
import { openMeetingDeleteModal } from "@/features/meetings/components/MeetingDeleteModal";
import { MeetingListPanel } from "@/features/meetings/components/MeetingListPanel";
import { MeetingPreviewPanel, meetingDetailHref } from "@/features/meetings/components/MeetingPreviewPanel";
import { isMeetingNotFound, meetingInlineError } from "@/features/meetings/errors";
import { useMeetingMutations } from "@/features/meetings/hooks/useMeetingMutations";
import { useMeetingsQuery } from "@/features/meetings/hooks/useMeetingsQuery";
import { useMeetingsViewParams } from "@/features/meetings/hooks/useMeetingsViewParams";
import { openMeetingCreateDrawer } from "@/features/meetings/openMeetingDrawers";
import type { MeetingListItem } from "@/features/meetings/types";
import { monthKeyOf, monthOf, periodRange, shiftPeriod } from "@/lib/datetime";
import { useOverlay } from "@/lib/overlay/OverlayProvider";

/** 첫 진입·선택이 사라졌을 때의 기본 선택 — **가장 최근 행**(U-2 기대 결과). */
function defaultSelection(items: readonly MeetingListItem[]): number | null {
  if (items.length === 0) {
    return null;
  }
  return items.reduce((latest, item) => (item.startAt > latest.startAt ? item : latest)).id;
}

export function MeetingsScreen() {
  const params = useMeetingsViewParams();
  const overlay = useOverlay();
  const router = useRouter();
  const mutations = useMeetingMutations();
  const [menu, setMenu] = useState<MeetingMenuTarget | null>(null);

  const { from, to } = periodRange(params.period);
  const query = useMeetingsQuery({ from, to, projectId: params.projectId, sort: params.sort });
  const items = query.data?.items ?? [];

  // `?id=` 가 이 달 목록에 없으면(삭제·달 이동) 기본 선택으로 떨어진다 — URL 은 건드리지 않는다.
  const selectedId =
    params.id !== null && items.some((item) => item.id === params.id)
      ? params.id
      : defaultSelection(items);

  const setMonth = (period: { from: string }) =>
    params.setParams({ month: monthKeyOf(monthOf(period.from)), id: null });

  const openDetail = (id: number) => router.push(meetingDetailHref(id));

  const create = () =>
    openMeetingCreateDrawer(overlay, {
      onCreated: (detail) => {
        // **새 행이 선택·하이라이트**되고 우측이 그 회의로 바뀐다(U-3 기대 결과). 달도 그 회의의 달로.
        params.setParams({ month: monthKeyOf(monthOf(detail.startAt.slice(0, 10))), id: detail.id });
      },
    });

  const confirmDelete = (target: { id: number; title: string }) =>
    openMeetingDeleteModal(overlay, target, async () => {
      // 삭제 뒤 **다음 행**을 고른다 — 현재 순서에서 바로 아래, 없으면 바로 위.
      const index = items.findIndex((item) => item.id === target.id);
      const next = items[index + 1] ?? items[index - 1] ?? null;
      try {
        await mutations.remove.mutateAsync(target.id);
        params.setParams({ id: next?.id ?? null });
      } catch (error) {
        const inline = meetingInlineError(error);
        const gone = isMeetingNotFound(error);
        toast.error(gone ? "이미 없는 회의록입니다" : (inline?.message ?? "회의록을 삭제하지 못했습니다"));
        // **목록 갱신**(Case Matrix) — 상태 가드(409)도, 이미 지워진 행(404)도 화면이 낡은 것이 원인이다.
        if (inline?.toast || gone) {
          void mutations.refresh();
        }
        throw error;
      }
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-page-title text-foreground">회의록</h1>
          {/* **월 단위** — `‹`·`›` 는 한 달씩. 달력에서 임의 범위를 골라도 그 달로 떨어진다(U-1) */}
          <PeriodStepper
            period={params.period}
            onPrev={() => setMonth(shiftPeriod(params.period, -1))}
            onNext={() => setMonth(shiftPeriod(params.period, 1))}
            onPick={setMonth}
          />
        </div>
        <Button
          type="button"
          onClick={create}
          className="h-[34px] gap-[7px] rounded-control px-4 text-meta font-semibold [&_svg]:h-3.5 [&_svg]:w-3.5"
        >
          <Plus aria-hidden />새 회의록
        </Button>
      </header>

      {/* 타이틀 `top 66` → 패널 `top 140`(시안 L70) */}
      <div className="mt-8 flex min-h-[560px] min-w-0 flex-1 gap-6">
        <MeetingListPanel
          period={params.period}
          data={query.data}
          isPending={query.isPending}
          isFetching={query.isFetching}
          isError={query.isError}
          projectId={params.projectId}
          sort={params.sort}
          selectedId={selectedId}
          onSelect={(id) => params.setParams({ id })}
          onOpen={openDetail}
          onContextMenu={(meeting, x, y) =>
            setMenu({ id: meeting.id, title: meeting.title, status: meeting.status, x, y })
          }
          onProjectChange={(next) => params.setParams({ projectId: next, id: null })}
          onSortChange={(next) => params.setParams({ sort: next })}
          onRetry={() => void query.refetch()}
          onCreate={create}
          onPrevMonth={() => setMonth(shiftPeriod(params.period, -1))}
        />
        <MeetingPreviewPanel meetingId={selectedId} />
      </div>

      <MeetingContextMenu
        target={menu}
        onClose={() => setMenu(null)}
        onOpen={openDetail}
        onDelete={(target) => confirmDelete(target)}
      />
    </div>
  );
}
