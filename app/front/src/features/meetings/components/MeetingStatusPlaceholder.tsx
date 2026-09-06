"use client";

/**
 * **상세 라우트의 `recording`·`generating`·`ended` 분기 플레이스홀더**(WP §Internal Interface Contract 「상세 라우트 스위치」).
 *
 * WORK-007(회의 중) · WORK-008(생성중·종료 후)이 **`MeetingDetailPage` 의 스위치에서 그 분기만** 이 컴포넌트를
 * 자기 화면으로 교체한다. 여기서는 문구만 둔다 — 화면을 발명하지 않는다.
 */

import Link from "next/link";

import { Breadcrumb } from "@/components/shared/AppShell";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import type { MeetingDetail } from "@/features/meetings/types";

const OWNER: Record<Exclude<MeetingDetail["status"], "scheduled">, string> = {
  recording: "WORK-007",
  generating: "WORK-008",
  ended: "WORK-008",
};

const LABEL: Record<Exclude<MeetingDetail["status"], "scheduled">, string> = {
  recording: "회의 중",
  generating: "생성중",
  ended: "종료",
};

export function MeetingStatusPlaceholder({
  meeting,
}: {
  meeting: MeetingDetail & { status: Exclude<MeetingDetail["status"], "scheduled"> };
}) {
  return (
    <div className="flex flex-col gap-5">
      <Breadcrumb trail={["홈", "회의록", LABEL[meeting.status]]} />
      <h1 className="text-page-title text-foreground">{meeting.title}</h1>
      <EmptyState
        message={`이 화면은 ${OWNER[meeting.status]} 에서 만든다`}
        hint={`상태 ${meeting.status} 의 화면은 아직 없습니다`}
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/meetings/">목록으로</Link>
          </Button>
        }
      />
    </div>
  );
}
