"use client";

/**
 * **목록 행**(SPEC-006 U-2 · 회의록.dc.html L84~122).
 *
 * padding 14/18 · 구분 `#F1F2F5` · hover `#FAFBFC` · **선택 행 `#F8FAFF`**. 세 줄 —
 * 1. 일시 12/`#757575` 「08월 27일 (목) 09:30」 + **상태 표기** + 우측 **유형 배지**(동적 유형 색 토큰)
 * 2. 제목 15/700
 * 3. **`headline`** 이 있으면 그것, 없으면 사람 트랙 안건 제목을 「 · 」로, 그것도 없으면 「안건 없음」
 *
 * **상태 표기**(시안 없음 → 디자인 시스템으로 조립): `scheduled` 「예정」 · `recording` 「기록 중」 + 7px dot
 * `#7181F8` + 3px 광륜 · `generating` 「생성중」 · `ended` 없음 · `ended + failed` 「통합 실패」 `#E2685B`.
 *
 * **없는 것**(§7): 취소 행(취소 배지 + 취소선 — status 에 취소가 없다) · 「반복」·「외부」·「개인」 고정 배지.
 *
 * 행 클릭 → **선택**(우측 미리보기). 상세는 더블클릭 또는 미리보기의 「상세보기」.
 */

import { TypeBadge } from "@/components/shared/TypeBadge";
import type { IntegrationState, MeetingListItem, MeetingStatus } from "@/features/meetings/types";
import { formatMeetingDateTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";

/** 셋째 줄 문구 — `headline` ?? 안건 제목 「 · 」 ?? 「안건 없음」. 화면이 트리를 다시 조립하지 않는다. */
export function meetingThirdLine(meeting: Pick<MeetingListItem, "headline" | "agendaTitles">): {
  text: string;
  muted: boolean;
} {
  if (meeting.headline) {
    return { text: meeting.headline, muted: false };
  }
  if (meeting.agendaTitles.length > 0) {
    return { text: meeting.agendaTitles.join(" · "), muted: false };
  }
  return { text: "안건 없음", muted: true };
}

/** 상태 표기 — `ended` 정상은 **아무 표기가 없다**. */
export function MeetingStatusMark({
  status,
  integrationState,
}: {
  status: MeetingStatus;
  integrationState: IntegrationState;
}) {
  if (status === "scheduled") {
    return <span className="text-caption text-fg-meta">예정</span>;
  }
  if (status === "recording") {
    return (
      <span className="flex items-center gap-1.5 text-caption text-fg-meta">
        <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full bg-primary shadow-halo" />
        기록 중
      </span>
    );
  }
  if (status === "generating") {
    return <span className="text-caption text-fg-meta">생성중</span>;
  }
  if (integrationState === "failed") {
    return <span className="text-caption text-destructive">통합 실패</span>;
  }
  return null;
}

export function MeetingRow({
  meeting,
  selected,
  onSelect,
  onOpen,
  onContextMenu,
}: {
  meeting: MeetingListItem;
  selected: boolean;
  onSelect: (id: number) => void;
  onOpen: (id: number) => void;
  onContextMenu: (meeting: MeetingListItem, x: number, y: number) => void;
}) {
  const third = meetingThirdLine(meeting);
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        aria-label={meeting.title}
        onClick={() => onSelect(meeting.id)}
        onDoubleClick={() => onOpen(meeting.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            onSelect(meeting.id);
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onContextMenu(meeting, event.clientX, event.clientY);
        }}
        className={cn(
          "flex cursor-pointer flex-col gap-[7px] border-b border-row-divider px-[18px] py-3.5",
          selected ? "bg-row-selected" : "hover:bg-row-hover",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2 text-caption text-fg-meta">
            <span className="truncate">{formatMeetingDateTime(meeting.startAt)}</span>
            <MeetingStatusMark status={meeting.status} integrationState={meeting.integrationState} />
          </span>
          <TypeBadge name={meeting.workType.name} colorToken={meeting.workType.colorToken} />
        </div>
        <span className="truncate text-section text-foreground">{meeting.title}</span>
        <span className={cn("truncate text-meta", third.muted ? "text-fg-caption" : "text-muted-foreground")}>
          {third.text}
        </span>
      </div>
    </li>
  );
}
