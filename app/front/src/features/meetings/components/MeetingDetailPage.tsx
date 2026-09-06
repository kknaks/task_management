"use client";

/**
 * **`/meetings/detail?id=` — `status` 로 화면을 고르는 스위치**(FE §1 L47 · WP §Internal Interface Contract).
 *
 * | `scheduled` | `MeetingScheduledPage`(WORK-006) |
 * | `recording` | `MeetingLiveView`(WORK-007) — 「회의 종료」의 동작(`/end`)은 **WORK-008** 이 `onEnd` 로 붙인다 |
 * | `generating` · `ended` | `MeetingClosedPage`(**WORK-008**) — 생성중 · 실패 배너 · 통합본 · 편집 |
 *
 * `/start` · `/end` 성공 후 **페이지 이동 없이** 캐시의 `status` 가 바뀌어 스위치가 바뀐다.
 * 없는 회의록은 「없는 회의록입니다」 + 「목록으로」 — **리다이렉트하지 않는다**(FE §1-2).
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { MeetingClosedPage } from "@/features/meetings/components/MeetingClosedPage";
import { MeetingLiveView } from "@/features/meetings/components/MeetingLiveView";
import { MeetingScheduledPage } from "@/features/meetings/components/MeetingScheduledPage";
import { MeetingDetailSkeleton } from "@/features/meetings/components/MeetingSkeleton";
import { END_FAILED_MESSAGE, INVALID_STATUS_MESSAGE, isInvalidMeetingStatus, isMeetingNotFound, meetingInlineError } from "@/features/meetings/errors";
import { useMeetingDetail } from "@/features/meetings/hooks/useMeetingDetail";
import { useMeetingFinalizeJob } from "@/features/meetings/hooks/useMeetingFinalizeJob";
import { useMeetingMutations } from "@/features/meetings/hooks/useMeetingMutations";
import type { MeetingDetail } from "@/features/meetings/types";

function parseId(raw: string | null): number | null {
  const parsed = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function MeetingDetailPage() {
  const id = parseId(useSearchParams().get("id"));
  const { data: meeting, isPending, error, refetch } = useMeetingDetail(id);

  if (id === null) {
    return <NotFound />;
  }
  if (isPending) {
    return <MeetingDetailSkeleton />;
  }
  if (error) {
    return isMeetingNotFound(error) ? (
      <NotFound />
    ) : (
      <EmptyState
        message="회의록을 불러오지 못했습니다"
        action={
          <Button type="button" variant="outline" onClick={() => void refetch()}>
            다시 시도
          </Button>
        }
      />
    );
  }

  if (meeting.status === "scheduled") {
    return <MeetingScheduledPage meeting={meeting} />;
  }
  if (meeting.status === "recording") {
    return <LiveWithEnd meeting={meeting} />;
  }
  return <MeetingClosedPage meeting={{ ...meeting, status: meeting.status }} />;
}

/**
 * 회의 중 화면 + 「회의 종료」의 동작(SPEC-008 U-1 진입) — 버튼 자리 · 활성 조건은 WORK-007, 눌렀을 때 부를 요청과 그 뒤가 이 work 다.
 * `202` 가 오면 `useMeetingFinalizeJob` 이 캐시를 `generating` 으로 바꿔 **같은 라우트에서** 스위치가 바뀐다. WS 는 서버가 닫는다.
 */
function LiveWithEnd({ meeting }: { meeting: MeetingDetail }) {
  const finalize = useMeetingFinalizeJob(meeting);
  const mutations = useMeetingMutations(meeting.id);

  const end = async () => {
    try {
      await finalize.end();
    } catch (error) {
      if (isInvalidMeetingStatus(error)) {
        // 이미 끝났거나 아직 시작 전(다른 창) — 토스트 + 상세 재조회(Case Matrix).
        toast.error(INVALID_STATUS_MESSAGE);
        void mutations.refreshDetail();
        return;
      }
      toast.error(meetingInlineError(error)?.message ?? END_FAILED_MESSAGE);
    }
  };

  return <MeetingLiveView meeting={meeting} onEnd={() => void end()} />;
}

/** **자동으로 튕기지 않는다** — 「없는 회의록입니다」 + 「목록으로」(U-4 · FE §1-2). */
function NotFound() {
  return (
    <EmptyState
      message="없는 회의록입니다"
      action={
        <Button asChild variant="outline" size="sm">
          <Link href="/meetings/">목록으로</Link>
        </Button>
      }
    />
  );
}
