"use client";

/**
 * 드로어를 여는 자리 하나 — **부모는 `openDrawer` 만 부른다**(FE §6-1).
 *
 * 드로어 컴포넌트는 **부모를 모른다**(F-4). 캘린더가 `openMeetingCreateDrawer(overlay, { startAt, endAt, onCreated })`
 * 로 **같은 드로어**를 연다(SPEC-009 U-6 · DEC-005 §5). 폭·스크림은 `DrawerFrame` 이 정한다(폭 prop 없음).
 */

import {
  AttachmentFileDrawer,
  AttachmentFileDrawerHeader,
} from "@/features/meetings/components/AttachmentFileDrawer";
import {
  MeetingCreateDrawer,
  MeetingCreateDrawerHeader,
} from "@/features/meetings/components/MeetingCreateDrawer";
import type { MeetingAttachment, MeetingDetail } from "@/features/meetings/types";
import type { useOverlay } from "@/lib/overlay/OverlayProvider";

type Overlay = ReturnType<typeof useOverlay>;

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

/** 파일 드로어(U-7) — 드로어가 없는 화면(시작 전 · 회의 중 · 종료 후)에서만 연다(FE §6-2). */
export function openAttachmentFileDrawer(overlay: Overlay, attachment: MeetingAttachment): void {
  overlay.openDrawer({
    key: `attachment-${attachment.id}`,
    title: attachment.name,
    renderHeader: ({ fullscreen, onClose }) => (
      <AttachmentFileDrawerHeader attachment={attachment} fullscreen={fullscreen} onClose={onClose} />
    ),
    content: <AttachmentFileDrawer attachment={attachment} />,
  });
}
