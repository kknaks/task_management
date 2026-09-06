"use client";

/**
 * **첨부 파일 탭**(SPEC-006 U-7 · 회의록.dc.html L739~757 · 시각 L1160~1194).
 *
 * 시작 전 · 회의 중(SPEC-007) · 종료 후(SPEC-008) **세 화면이 이 컴포넌트를 그대로 쓴다** —
 * 회의 상태·라우트를 import 하지 않고 prop 으로만 갈린다.
 *
 * - 탭 라벨·「추가」는 **탭 줄**(`PanelTabs`)에 있다 — 여기서는 `AttachmentAddTrigger` 를 내보내고
 *   소유 화면이 탭 줄 우측에 놓는다
 * - 빈 상태: 「첨부한 파일이 없습니다」 + 「파일 첨부하기」 40px → **같은 팝오버**(SPEC-003 U-7)
 * - 목록 행: **`AttachmentList` 재사용**(두 번째 구현 금지) — 메타는 문서 「<크기> · <수정일> · <폴더 경로>」,
 *   링크 「<도메인>」. 삭제된 문서는 흐림 + 「삭제된 문서입니다」
 * - 푸터 44 「끌어다 놓아도 첨부됩니다 · 최대 50MB」 — **`V2Gate` 아래**. 놓으면 「v2에서 제공됩니다」
 *   토스트만, 요청 없음. **50MB 는 검증 대상이 아니다**
 * - **PNG·PDF 행과 「회의 중 작성」 메타는 그리지 않는다**(§7)
 */

import { Paperclip } from "lucide-react";

import { AttachmentList, domainOf } from "@/components/shared/AttachmentList";
import { AttachmentPopover } from "@/components/shared/AttachmentPopover";
import { V2Gate } from "@/components/shared/V2Gate";
import type { MeetingAttachment } from "@/features/meetings/types";
import { formatTimestamp } from "@/lib/datetime";

/** `4096` → 「4KB」. 표시용이라 1024 단위 정수로 자른다. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) {
    return "";
  }
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** 목록 행 메타(U-7) — 문서 「<크기> · <수정일> · <폴더 경로>」 / 링크 「<도메인>」. */
export function attachmentMeta(attachment: MeetingAttachment, now?: Date): string {
  if (attachment.kind === "link") {
    return attachment.url ? domainOf(attachment.url) : "";
  }
  return [formatBytes(attachment.sizeBytes), formatTimestamp(attachment.updatedAt, now), attachment.folderPath]
    .filter((part) => part && part.length > 0)
    .join(" · ");
}

export type AddLinkHandler = (input: { url: string; label: string | null }) => Promise<boolean | void>;

/** 탭 줄 우측 「추가」 12/`#9EA2AE`(시안 L1164) — SPEC-003 U-7 팝오버를 연다. */
export function AttachmentAddTrigger({ onAddLink }: { onAddLink: AddLinkHandler }) {
  return (
    <AttachmentPopover
      /* 회의 첨부에는 역할(참고/결과) 축이 없다 — 팝오버 계약상 필수라 채워 보내고 **버린다** */
      role="reference"
      onAddLink={({ url, label }) => onAddLink({ url, label })}
      trigger={
        <button
          type="button"
          aria-label="첨부 추가"
          className="text-caption text-fg-caption hover:text-foreground"
        >
          추가
        </button>
      }
    />
  );
}

export function MeetingAttachmentsTab({
  attachments,
  onAddLink,
  onRemove,
  onOpenDoc,
}: {
  attachments: readonly MeetingAttachment[];
  onAddLink: AddLinkHandler;
  onRemove: (attachment: MeetingAttachment) => void;
  /** 문서 행 → 파일 드로어. 소유 화면이 `openAttachmentFileDrawer` 로 연다. */
  onOpenDoc: (attachment: MeetingAttachment) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-[18px]">
        {attachments.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-[18px] py-10 text-center">
            <p className="text-meta text-fg-caption">첨부한 파일이 없습니다</p>
            <AttachmentPopover
              role="reference"
              onAddLink={({ url, label }) => onAddLink({ url, label })}
              trigger={
                <button
                  type="button"
                  className="flex h-10 items-center gap-2 rounded-control bg-primary px-[18px] text-control-label font-semibold text-primary-foreground hover:bg-primary-hover [&_svg]:h-3.5 [&_svg]:w-3.5"
                >
                  <Paperclip aria-hidden />
                  파일 첨부하기
                </button>
              }
            />
          </div>
        ) : (
          <AttachmentList
            attachments={attachments}
            emptyMessage="첨부한 파일이 없습니다"
            onRemove={onRemove}
            onOpenDoc={onOpenDoc}
            renderMeta={(attachment) => attachmentMeta(attachment)}
          />
        )}
      </div>

      {/* 푸터 44 — 드롭 영역·문구는 `V2Gate` 하나 아래다(DEC-003 §1 표 · FE §9) */}
      <V2Gate reason="v2" className="block w-full">
        <div className="flex h-11 items-center border-t border-divider px-[18px]">
          <span className="text-caption text-fg-caption">끌어다 놓아도 첨부됩니다 · 최대 50MB</span>
        </div>
      </V2Gate>
    </div>
  );
}
