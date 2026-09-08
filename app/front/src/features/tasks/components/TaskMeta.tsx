"use client";

/**
 * 목록·칸반이 함께 쓰는 **작은 표시 조각** — 지연 뱃지(U-10)와 기한 칸(U-1).
 *
 * **파생값을 다시 계산하지 않는다**(T-4 · G-7). `dDay`·`isOverdue`·`overdueDays` 는 서버가
 * 준 값을 그대로 그린다 — 화면이 다시 세면 자정 근처에서 서버와 다른 답이 나온다.
 */

import { formatDueDate } from "@/lib/datetime";
import { cn } from "@/lib/utils";

/**
 * **U-10 지연 뱃지** — 기한이 지났고 완료·취소가 아니면 자동으로 붙는다.
 * **상태가 아니다** — 상태 셀은 원래 상태 그대로다(05-status).
 */
export function OverdueBadge({ days }: { days: number | null }) {
  if (days === null || days <= 0) {
    return null;
  }
  return <span className="shrink-0 text-caption text-status-overdue">{days}일 지남</span>;
}

/**
 * 종료일 칸 — 날짜 **13/600** + D-day(시안 106줄).
 * **기한이 없으면 빈칸**이다(U-1 · T-1-a — 「기한 없음」 문구를 목록에 넣지 않는다).
 * 지연이면 D-day 자리를 **「n일 지남」이 대신한다**.
 *
 * **시각이 없다** — `dueStartTime`·`dueEndTime` 은 제거됐다(DEC-002 §「업무의 시간 지정 제거」).
 * 업무는 날짜 단위이고 시각을 갖는 것은 회의다.
 */
export function DueCell({
  dueDate,
  dDay,
  isOverdue,
  overdueDays,
}: {
  dueDate: string | null;
  dDay: number | null;
  isOverdue: boolean;
  overdueDays: number | null;
}) {
  if (dueDate === null) {
    return null;
  }

  return (
    <span className="flex min-w-0 items-center justify-center gap-1.5">
      <span className="truncate text-meta font-semibold text-foreground">
        {formatDueDate(dueDate)}
      </span>
      {isOverdue ? (
        <OverdueBadge days={overdueDays} />
      ) : dDay === null ? null : (
        // `D-0` 은 오늘이라 강조색, 그 밖은 메타색(U-1 기한 칸)
        <span className={cn("shrink-0 text-caption", dDay === 0 ? "text-primary" : "text-fg-meta")}>
          D{dDay === 0 ? "-0" : dDay > 0 ? `-${dDay}` : `+${-dDay}`}
        </span>
      )}
    </span>
  );
}
