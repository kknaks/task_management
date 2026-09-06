"use client";

/**
 * **파일 드로어**(SPEC-006 U-7 · 시각 회의록.dc.html L1349~1393). 폭은 `DrawerFrame` 이 정한다.
 *
 * `DrawerFrame` 위에 얹는다 — 폭·스크림·닫는 길은 프레임이 정한다(FE §6-2).
 * 헤더 72 = MD 타일 34 + 이름 17/700 + 메타 12 + 「다운로드」 32 + 「자료함에서 열기」 32 + ×.
 * 탭 44 「미리보기」/「원문 텍스트」.
 *
 * **본문은 문서함 전까지 「자료함이 아직 없습니다」 스텁**이다(WP §Open Issues 임시 계약) —
 * `GET /api/documents/{id}/content` 가 아직 없다. 「다운로드」·「자료함에서 열기」도 같은 이유로
 * 비활성이다(v2 가 아니라 **문서함 work 가 실체화**한다 — `V2Gate` 를 쓰지 않는다).
 * 링크 행은 드로어 대신 **기본 브라우저**라 여기 오지 않는다.
 *
 * 세 화면(시작 전 · 회의 중 · 종료 후)이 같은 컴포넌트를 쓴다 — 회의 상태·라우트를 import 하지 않는다.
 * **「안건 1」 같은 안건 연결 메타(L1354)는 없다**(회의 중 md 작성이 v2 — M-17).
 */

import { useState } from "react";
import { ArrowLeft, X } from "lucide-react";

import { PanelTabs } from "@/components/shared/PanelTabs";
import { attachmentMeta } from "@/features/meetings/components/MeetingAttachmentsTab";
import type { MeetingAttachment } from "@/features/meetings/types";
import type { useOverlay } from "@/lib/overlay/OverlayProvider";

type FileTab = "preview" | "source";

const TABS = [
  { key: "preview", label: "미리보기" },
  { key: "source", label: "원문 텍스트" },
] as const;

/** MD 타일 — 드로어 헤더 34 / 목록 행 32([09] · 시안 L1170). */
export function MdTile({ size = 34 }: { size?: 32 | 34 }) {
  return (
    <span
      aria-hidden
      className={
        size === 34
          ? "flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-secondary text-tile-mark text-secondary-foreground"
          : "flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-secondary text-tile-mark text-secondary-foreground"
      }
    >
      MD
    </span>
  );
}

/** 프레임의 `renderHeader` 에 꽂는 헤더 — 프레임이 닫기·전체화면 여부만 넘긴다. */
export function AttachmentFileDrawerHeader({
  attachment,
  fullscreen,
  onClose,
}: {
  attachment: MeetingAttachment;
  fullscreen: boolean;
  onClose: () => void;
}) {
  const action =
    "flex h-8 shrink-0 items-center rounded-control border border-border bg-card px-3 text-meta text-fg-meta hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <header className="flex h-[72px] items-center gap-3 border-b border-divider px-7">
      {fullscreen ? (
        <button
          type="button"
          aria-label="닫기"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-muted"
        >
          <ArrowLeft className="h-[15px] w-[15px]" aria-hidden />
        </button>
      ) : null}
      <MdTile size={34} />
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="truncate text-subhead tracking-title text-foreground">
          {attachment.name}
        </span>
        <span className="truncate text-caption text-fg-caption">{attachmentMeta(attachment)}</span>
      </div>
      {/* 문서함 전이라 본문 조회 표면이 없다 — 둘 다 비활성(스텁) */}
      <button type="button" className={action} disabled title="자료함이 아직 없습니다">
        다운로드
      </button>
      <button type="button" className={action} disabled title="자료함이 아직 없습니다">
        자료함에서 열기
      </button>
      {fullscreen ? null : (
        <button
          type="button"
          aria-label="드로어 닫기"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-muted"
        >
          <X className="h-[15px] w-[15px]" aria-hidden />
        </button>
      )}
    </header>
  );
}

export function AttachmentFileDrawer({ attachment }: { attachment: MeetingAttachment }) {
  const [tab, setTab] = useState<FileTab>("preview");

  return (
    <div className="-mx-6 -my-5 flex min-h-full flex-col">
      <PanelTabs ariaLabel="파일 보기" tabs={TABS} value={tab} onChange={setTab} className="px-7" />
      <div className="flex flex-1 flex-col items-center justify-center gap-1 px-8 py-7 text-center">
        {/* **스텁** — 문서함(SPEC-005)이 아직 없다. 렌더 규약(GFM·앵커·하이라이트)은 그 work 가 붙인다 */}
        <p className="text-meta text-fg-caption">자료함이 아직 없습니다</p>
        <p className="text-caption text-fg-caption">
          {tab === "preview"
            ? "자료함이 열리면 md 미리보기가 여기에 렌더됩니다"
            : "자료함이 열리면 원문 텍스트가 여기에 보입니다"}
        </p>
        <span className="sr-only">{attachment.name}</span>
      </div>
    </div>
  );
}

/**
 * 파일 드로어(U-7)를 여는 함수 — 드로어가 없는 화면(시작 전 · 회의 중 · 종료 후)에서만 연다(FE §6-2).
 * `openMeetingDrawers` 가 다시 내보낸다. 여기 두는 이유 — 종료 후 본문(`MeetingDetailBody`)이 레지스트리를 import 하면
 * 레지스트리 → 상세 드로어 → 본문 순환이 생긴다(WORK-008).
 */
export function openAttachmentFileDrawer(overlay: ReturnType<typeof useOverlay>, attachment: MeetingAttachment): void {
  overlay.openDrawer({
    key: `attachment-${attachment.id}`,
    title: attachment.name,
    renderHeader: ({ fullscreen, onClose }) => (
      <AttachmentFileDrawerHeader attachment={attachment} fullscreen={fullscreen} onClose={onClose} />
    ),
    content: <AttachmentFileDrawer attachment={attachment} />,
  });
}
