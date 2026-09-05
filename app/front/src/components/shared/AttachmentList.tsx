"use client";

/**
 * **S-23 첨부 목록** — 확장자 타일(MD) 또는 링크 글리프 + 이름 + (폴더 경로 / 도메인)(SPEC-003 U-7).
 *
 * hover 시 우측 「제거」. **문서를 여는 경로는 문서함 work 가 붙인다** — 이 work 시점에는
 * 링크만 실체가 있고, 링크는 **기본 브라우저로 연다**.
 */

import { ExternalLink, FileText } from "lucide-react";

import { EmptyState } from "@/components/shared/EmptyState";
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
    <ul className="flex flex-col">
      {attachments.map((attachment) => (
        <li
          key={attachment.id}
          className="group flex h-todo items-center gap-2 border-b border-row-divider px-1 last:border-b-0 hover:bg-row-hover"
        >
          <span
            aria-hidden
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-chip bg-background text-fg-meta"
          >
            {attachment.kind === "doc" ? <FileText aria-hidden /> : <ExternalLink aria-hidden />}
          </span>

          <span className="min-w-0 flex-1">
            {attachment.kind === "link" && attachment.url ? (
              // 링크는 **기본 브라우저로 연다**(U-7 기대 결과).
              <a
                href={attachment.url}
                target="_blank"
                rel="noreferrer"
                className="block truncate text-body text-foreground hover:underline"
              >
                {attachment.name}
              </a>
            ) : (
              <span className="block truncate text-body text-foreground">{attachment.name}</span>
            )}
            <span className="block truncate text-caption text-fg-caption">
              {attachment.kind === "doc"
                ? (attachment.folderPath ?? "")
                : attachment.url
                  ? domainOf(attachment.url)
                  : ""}
            </span>
          </span>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
            onClick={() => onRemove(attachment)}
          >
            제거
          </Button>
        </li>
      ))}
    </ul>
  );
}
