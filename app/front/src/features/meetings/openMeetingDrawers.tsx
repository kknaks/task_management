"use client";

/**
 * 드로어를 여는 자리 하나 — **부모는 `openDrawer` 만 부른다**(FE §6-1).
 *
 * 드로어 컴포넌트는 **부모를 모른다**(F-4). 캘린더가 `openMeetingCreateDrawer(overlay, { startAt, endAt, onCreated })`
 * 로 **같은 드로어**를 연다(SPEC-009 U-6 · DEC-005 §5). 폭·스크림은 `DrawerFrame` 이 정한다(폭 prop 없음).
 */

import { openAddLineDrawer } from "@/features/meetings/components/AddLineDrawer";
import { openAttachmentFileDrawer } from "@/features/meetings/components/AttachmentFileDrawer";
import { openCreateTaskFromLineDrawer } from "@/features/meetings/components/CreateTaskFromLineDrawer";
import { openLinkTaskDrawer } from "@/features/meetings/components/LinkTaskDrawer";
import {
  MeetingCreateDrawer,
  MeetingCreateDrawerHeader,
} from "@/features/meetings/components/MeetingCreateDrawer";
import { MeetingDetailDrawer, MeetingDrawerHeaderConnected } from "@/features/meetings/components/MeetingDetailDrawer";
import type { MeetingDetail } from "@/features/meetings/types";
import type { useOverlay } from "@/lib/overlay/OverlayProvider";

/**
 * 파일 드로어(U-7) · 논의/결정 추가 드로어(SPEC-008 U-8) · 연관 업무(U-9) · 업무 생성(U-10) 드로어는 **각 드로어 파일이 여는 함수를 갖고**
 * 여기서 다시 내보낸다 — 종료 후 본문(`MeetingDetailBody`)이 이 레지스트리를 import 하면 레지스트리 → 상세 드로어 → 본문 순환이 생기기 때문이다(WORK-008).
 */
export { openAddLineDrawer, openAttachmentFileDrawer, openCreateTaskFromLineDrawer, openLinkTaskDrawer };

type Overlay = ReturnType<typeof useOverlay>;

/** 전체 페이지 라우트 — 드로어 ⤢ 의 목적지(F-5). 목록 「상세보기」와 같은 주소다. */
export function meetingDetailRoute(id: number): string {
  return `/meetings/detail/?id=${id}`;
}

/**
 * **회의 상세 드로어**(SPEC-008 U-4) — 목록 · 캘린더(SPEC-009 U-7)가 **같은 드로어**를 연다(F-4 · DEC-005 §2).
 * 키 `meeting-detail`. ⤢ 는 전체 페이지로 승격된다(한 방향). 드로어는 부모를 모른다.
 */
export function openMeetingDetailDrawer(overlay: Overlay, meetingId: number): void {
  overlay.openDrawer({
    key: "meeting-detail",
    /** 프레임 타이틀은 접근성 이름으로만 — 헤더는 `renderHeader` 가 3겹으로 그린다(REDRAW-03 §2-1 결). */
    title: "회의 상세",
    expandTo: meetingDetailRoute(meetingId),
    renderHeader: ({ fullscreen, expand, onClose }) => (
      <MeetingDrawerHeaderConnected meetingId={meetingId} fullscreen={fullscreen} expand={expand} onClose={onClose} />
    ),
    content: <MeetingDetailDrawer meetingId={meetingId} />,
  });
}


export function openMeetingCreateDrawer(
  overlay: Overlay,
  options: {
    onCreated: (meeting: MeetingDetail) => void;
    /** 캘린더가 고른 시각. 둘 다 있어야 미리 채운다. */
    startAt?: string;
    endAt?: string;
  },
): void {
  overlay.openDrawer({
    key: "meeting-create",
    title: "새 회의록",
    // 생성 드로어에는 ⤢ 가 없다 — 승격할 대상이 아직 없다.
    renderHeader: ({ fullscreen, onClose }) => (
      <MeetingCreateDrawerHeader fullscreen={fullscreen} onClose={onClose} />
    ),
    content: (
      <MeetingCreateDrawer
        initial={{ startAt: options.startAt, endAt: options.endAt }}
        onCancel={overlay.closeDrawer}
        onCreated={(meeting) => {
          overlay.closeDrawer();
          options.onCreated(meeting);
        }}
      />
    ),
  });
}

