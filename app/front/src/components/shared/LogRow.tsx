"use client";

/**
 * **S-21 로그 한 줄** — 「내용 + 시간」(`09-design-tokens.md` §그 외 규칙).
 *
 * **최신 1건만 dot 이 primary, 나머지는 border 색**이다(SPEC-003 U-10).
 * **사용자가 로그를 쓰거나 지울 수 없다**(DEC-002 §6) — 이 컴포넌트에 CTA 가 없다.
 */

import { formatTimestamp } from "@/lib/datetime";
import { cn } from "@/lib/utils";

export function LogRow({
  text,
  createdAt,
  latest = false,
  now,
}: {
  text: string;
  createdAt: string;
  latest?: boolean;
  /** 「오늘」 판정 기준. 같은 목록의 모든 줄이 같은 값을 쓴다(`lib/datetime.ts`). */
  now?: Date;
}) {
  return (
    <li className="flex items-center gap-2 py-1.5">
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          latest ? "bg-primary" : "bg-border",
        )}
      />
      <span className="min-w-0 flex-1 truncate text-meta text-fg-muted">{text}</span>
      <time dateTime={createdAt} className="shrink-0 text-caption text-fg-caption">
        {formatTimestamp(createdAt, now)}
      </time>
    </li>
  );
}
