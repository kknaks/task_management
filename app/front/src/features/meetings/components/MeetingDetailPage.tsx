"use client";

/**
 * **`/meetings/detail?id=` — `status` 로 화면을 고르는 스위치**(FE §1 L47 · WP §Internal Interface Contract).
 *
 * | `scheduled` | `MeetingScheduledPage`(이 work) |
 * | `recording` | 플레이스홀더 — **WORK-007** 이 이 분기만 교체 |
 * | `generating` · `ended` | 플레이스홀더 — **WORK-008** 이 이 분기만 교체 |
 *
 * `/start` 성공 후 **페이지 이동 없이** 캐시의 `status` 가 바뀌어 스위치가 바뀐다.
 * 없는 회의록은 「없는 회의록입니다」 + 「목록으로」 — **리다이렉트하지 않는다**(FE §1-2).
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { MeetingScheduledPage } from "@/features/meetings/components/MeetingScheduledPage";
import { MeetingDetailSkeleton } from "@/features/meetings/components/MeetingSkeleton";
import { MeetingStatusPlaceholder } from "@/features/meetings/components/MeetingStatusPlaceholder";
import { isMeetingNotFound } from "@/features/meetings/errors";
import { useMeetingDetail } from "@/features/meetings/hooks/useMeetingDetail";

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
  return <MeetingStatusPlaceholder meeting={{ ...meeting, status: meeting.status }} />;
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
