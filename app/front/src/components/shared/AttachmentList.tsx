"use client";

/**
 * **S-23 첨부 목록** — 확장자 타일(MD) 또는 링크 글리프 + 이름 + (폴더 경로 / 도메인)(SPEC-003 U-7).
 *
 * hover 시 우측 「제거」. **문서를 여는 경로는 문서함 work 가 붙인다** — 이 work 시점에는
 * 링크만 실체가 있고, 링크는 **기본 브라우저로 연다**.
 *
 * ## 업무 · 회의가 같은 행을 쓴다(WORK-006 §4 「두 번째 구현 금지」)
 *
 * 항목 형태는 **구조적 최소 집합**(`AttachmentListItem`)만 요구한다 — 업무 첨부(`role` 있음)와
 * 회의 첨부(`sizeBytes`·`updatedAt`·`isDeleted` 있음)가 둘 다 들어온다. 화면별 메타 문구는
 * `renderMeta` 로, 문서 행 클릭은 `onOpenDoc` 으로 받는다. 회의 U-7 의 「삭제된 문서 흐림 +
 * 캡션」은 `isDeleted` 가 있을 때만 그린다(업무 첨부에는 그 필드가 없다).
 */

import { ExternalLink, FileText } from "lucide-react";

import { EmptyState } from "@/components/shared/EmptyState";
import { ItemRow, ItemRows } from "@/components/shared/ItemRow";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** 업무·회의 첨부가 공통으로 갖는 필드. 여기 없는 것은 `renderMeta` 로 받는다. */
export interface AttachmentListItem {
  id: number;
  kind: "doc" | "link";
  name: string;
  folderPath: string | null;
  url: string | null;
  /** 문서가 소프트 딜리트됐다(회의 U-7). 없으면 `false` 로 본다. */
  isDeleted?: boolean;
}

/** `https://a.example/b` → `a.example`. 주소 표시용이라 실패하면 원문을 그대로 쓴다. */
export function domainOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function AttachmentList<T extends AttachmentListItem>({
  attachments,
  emptyMessage,
  onRemove,
  onOpenDoc,
  renderMeta,
}: {
  attachments: readonly T[];
  emptyMessage: string;
  /** 없으면 **읽기 전용**이다 — 미리보기 패널(SPEC-006 U-8)이 그렇다. */
  onRemove?: (attachment: T) => void;
  /** 문서 행 클릭. 없으면 문서 이름은 텍스트다(업무 드로어 · 문서함 전). */
  onOpenDoc?: (attachment: T) => void;
  /** 우측 메타 — 기본은 문서 「폴더 경로」 / 링크 「도메인」(SPEC-003 U-7). */
  renderMeta?: (attachment: T) => string;
}) {
  if (attachments.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  const metaOf = (attachment: T): string => {
    if (renderMeta) {
      return renderMeta(attachment);
    }
    if (attachment.kind === "doc") {
      return attachment.folderPath ?? "";
    }
    return attachment.url ? domainOf(attachment.url) : "";
  };

  return (
    /* 행 카드 — 흰 배경 · border `#D9D9D9` · r8 · h40 · 좌측 타일 22px r5(시안 631줄 · G-0b) */
    <ItemRows>
      {attachments.map((attachment) => {
        const deleted = attachment.isDeleted === true;
        return (
          <ItemRow
            key={attachment.id}
            className={cn(deleted && "text-fg-caption")}
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
                  {/* 삭제된 문서는 **조용히 감추지 않는다** — 흐리게 + 캡션(SPEC-005 L-12) */}
                  {deleted ? "삭제된 문서입니다" : metaOf(attachment)}
                </span>
                {onRemove ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 px-2 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
                    onClick={() => onRemove(attachment)}
                  >
                    제거
                  </Button>
                ) : null}
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
            ) : onOpenDoc && !deleted ? (
              // 문서 행 → 파일 드로어(회의 U-7). 삭제된 문서는 **열리지 않는다**.
              <button
                type="button"
                onClick={() => onOpenDoc(attachment)}
                className="min-w-0 max-w-full truncate text-left hover:underline"
              >
                {attachment.name}
              </button>
            ) : (
              attachment.name
            )}
          </ItemRow>
        );
      })}
    </ItemRows>
  );
}
