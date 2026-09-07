"use client";

/**
 * **생성중 · 종료 후 전체 페이지의 껍데기**(SPEC-008 U-1 · U-2 · U-3 · 시안 L1403~1607) — `/meetings/detail?id=` 의 `generating`·`ended` 분기.
 *
 * breadcrumb 「홈 › 회의록 › <제목>」 → 헤더(제목 28/700 인라인 편집 · 메타 한 줄 인라인 컨트롤 | 「삭제」 34 · 상태 칩) →
 * **`MeetingDetailBody mode="page"`**(상단 바 슬롯 · 두 패널). 본문은 드로어와 **같은 컴포넌트**다 — 이 파일은 헤더만 갖는다.
 *
 * - `generating` — 제목 · 메타 잠금 · 「삭제」 비활성(U-1 「`generating` 은 지울 수 없다」)
 * - 「삭제」 → SPEC-006 U-5 모달 → 삭제 뒤 **목록으로 이동**
 * - 유형명은 설정의 동적 이름(§A-7) · 「MM.DD HH:mm 생성」 · 하단 프롬프트 바는 **없다**(§7)
 */

import { useRouter } from "next/navigation";

import { DetailHeaderBar, HOME_CRUMB, MEETINGS_CRUMB, MEETINGS_ROUTE } from "@/components/shared/AppShell";
import { MeetingDetailBody } from "@/features/meetings/components/MeetingDetailBody";
import { openMeetingDeleteModal } from "@/features/meetings/components/MeetingDeleteModal";
import { MeetingBadgeRow, MeetingMetaLine, MeetingTitleInline, useMeetingMetaSave } from "@/features/meetings/components/MeetingMetaInline";
import { MeetingStatusChip } from "@/features/meetings/components/MeetingStatusChip";
import { useMeetingMutations } from "@/features/meetings/hooks/useMeetingMutations";
import type { MeetingDetail } from "@/features/meetings/types";
import { useOverlay } from "@/lib/overlay/OverlayProvider";

export function MeetingClosedPage({ meeting }: { meeting: MeetingDetail & { status: "generating" | "ended" } }) {
  const router = useRouter();
  const overlay = useOverlay();
  const mutations = useMeetingMutations(meeting.id);
  const meta = useMeetingMetaSave(meeting);
  const locked = meeting.status === "generating";

  const confirmDelete = () =>
    openMeetingDeleteModal(overlay, meeting, async () => {
      await mutations.remove.mutateAsync(meeting.id);
      router.push("/meetings/");
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ① breadcrumb + 「←」 */}
      <DetailHeaderBar trail={[HOME_CRUMB, MEETINGS_CRUMB, { label: meeting.title }]} backTo={MEETINGS_ROUTE} />

      {/* ② 배지 줄 → ③ 제목 → ④ 메타 한 줄(MF-8 · SPEC-008 U-3) */}
      <header className="mt-2 flex min-w-0 flex-col gap-1.5">
        <MeetingBadgeRow
          meeting={meeting}
          meta={meta}
          locked={locked}
          actions={
            <>
              {/* 시안대로 텍스트 버튼 「삭제」(L1440) — SPEC-006 U-5 모달을 연다 */}
              <button
                type="button"
                onClick={confirmDelete}
                disabled={locked || mutations.remove.isPending}
                className="flex h-[34px] items-center rounded-control border border-border bg-card px-3.5 text-meta text-fg-meta hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                삭제
              </button>
              <MeetingStatusChip status={meeting.status} />
            </>
          }
        />
        <MeetingTitleInline meeting={meeting} meta={meta} size="page" locked={locked} />
        <MeetingMetaLine meeting={meeting} meta={meta} locked={locked} />
        {meta.notice}
      </header>

      <MeetingDetailBody meeting={meeting} mode="page" />
    </div>
  );
}
