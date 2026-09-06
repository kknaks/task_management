"use client";

/**
 * **S-23 첨부 목록** — 확장자 타일(MD) 또는 링크 글리프 + 이름 + (폴더 경로 / 도메인)(SPEC-003 U-7).
 *
 * hover 시 우측 「제거」. **문서를 여는 경로는 문서함 work 가 붙인다** — 이 work 시점에는
 * 링크만 실체가 있고, 링크는 **기본 브라우저로 연다**.
 */

import { ExternalLink, FileText } from "lucide-react";

import { EmptyState } from "@/components/shared/EmptyState";
import { ItemRow, ItemRows } from "@/components/shared/ItemRow";
import { Button } from "@/components/ui/button";
import type { TaskAttachment } from "@/features/tasks/types";

/** `https://a.example/b` → `a.example`. 주소 표시용이라 실패하면 원문을 그대로 쓴다. */
function domainOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function AttachmentList({
  attachments,
  emptyMessage,
  onRemove,
}: {
  attachments: readonly TaskAttachment[];
  emptyMessage: string;
  onRemove: (attachment: TaskAttachment) => void;
}) {
  if (attachments.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    /* 행 카드 — 흰 배경 · border `#D9D9D9` · r8 · h40 · 좌측 타일 22px r5(시안 631줄 · G-0b) */
    <ItemRows>
      {attachments.map((attachment) => (
        <ItemRow
          key={attachment.id}
          leading={
            <span
              aria-hidden
              className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground [&_svg]:h-3 [&_svg]:w-3"
            >
              {attachment.kind === "doc" ? <FileText aria-hidden /> : <ExternalLink aria-hidden />}
            </span>
          }
          trailing={
            <>
              {/**
                * 폴더 경로 / 도메인 — **U-7 이 요구하는 정보**다. 시안 행 카드는 h40 한 줄이라
                * 두 줄로 쌓을 자리가 없어 **같은 줄 우측에 붙인다**(REDRAW-06 보고 참조).
                */}
              <span className="hidden shrink-0 truncate text-caption text-fg-caption wide:block">
                {attachment.kind === "doc"
                  ? (attachment.folderPath ?? "")
                  : attachment.url
                    ? domainOf(attachment.url)
                    : ""}
              </span>
                <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 px-2 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
                onClick={() => onRemove(attachment)}
              >
                제거
              </Button>
            </>
          }
        >
          {attachment.kind === "link" && attachment.url ? (
            // 링크는 **기본 브라우저로 연다**(U-7 기대 결과).
            <a
              href={attachment.url}
              target="_blank"
              rel="noreferrer"
              className="truncate hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              {attachment.name}
            </a>
          ) : (
            attachment.name
          )}
        </ItemRow>
      ))}
    </ItemRows>
  );
}
