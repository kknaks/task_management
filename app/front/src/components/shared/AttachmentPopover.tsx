"use client";

/**
 * **U-7 첨부 팝오버 360** — 「자료함 문서」 / 「URL 링크」 두 갈래(SPEC-003).
 *
 * 「고르기는 팝오버」이고 **드로어 안에서 다른 드로어를 열지 않는다**(FE §6-2).
 *
 * - 두 갈래 모두 **팝오버가 열린 채 유지**되어 여러 건을 연달아 붙일 수 있다
 * - **자료함 문서 갈래는 이 work 시점에 스텁**이다 — 문서함이 아직 없어 결과가 비어 있고
 *   안내 캡션만 보인다(WP Phase 4 · §Open Issues). **선택 경로를 만들지 않는다** —
 *   `kind=doc` 은 서버가 거부한다(T-9)
 * - 링크 갈래는 URL + 표시 이름(비우면 URL 을 그대로 이름으로 쓴다)
 * - **역할(참고/결과)은 팝오버가 모른다.** 그 축은 업무 첨부 API 만의 것이라(SPEC-003 §4) 회의는 없다 —
 *   공용은 두 영역의 **공통 부분만** 갖고(FE §2 규칙 3), 업무 호출부가 `onAddLink` 클로저에서
 *   자기 `role` 을 닫아 넣는다(WORK-006 검수 W-2)
 */

import { useState, type ReactNode } from "react";

import { isEnterSubmit } from "@/lib/keyboard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Segment = "doc" | "link";

export function AttachmentPopover({
  trigger,
  onAddLink,
}: {
  trigger: ReactNode;
  /** URL 링크 한 건을 붙인다. **팝오버는 닫히지 않는다**(연달아 붙이기 위해). */
  /**
   * `false` 를 돌려주면 **입력을 그대로 둔다** — 저장이 실패했다는 뜻이다.
   * 그 밖의 값(`void` 포함)은 성공으로 보고 입력을 비운다.
   */
  onAddLink: (input: { url: string; label: string | null }) => Promise<boolean | void>;
}) {
  const [open, setOpen] = useState(false);
  const [segment, setSegment] = useState<Segment>("link");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [adding, setAdding] = useState(false);

  const canAdd = url.trim().length > 0 && !adding;

  const submit = async () => {
    if (!canAdd) {
      return;
    }
    setAdding(true);
    try {
      const added = await onAddLink({
        url: url.trim(),
        // 비우면 URL 을 그대로 이름으로 쓴다 — 서버가 그렇게 처리하도록 `null` 을 보낸다.
        label: label.trim().length > 0 ? label.trim() : null,
      });
      // **저장에 실패했으면 입력을 비우지 않는다** — 비우면 저장된 것처럼 보인다(U-7 「값 유지」).
      // 실패 캡션·「다시 저장」은 부르는 블록이 그린다.
      if (added !== false) {
        setUrl("");
        setLabel("");
      }
    } finally {
      setAdding(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-popover-attach rounded-card border-border bg-card p-3 shadow-popover"
      >
        {/* 세그먼트 2 — 「자료함 문서」 / 「URL 링크」 */}
        <div role="tablist" className="mb-3 flex rounded-control bg-background p-0.5">
          {(
            [
              { key: "doc", label: "자료함 문서" },
              { key: "link", label: "URL 링크" },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={segment === item.key}
              onClick={() => setSegment(item.key)}
              className={cn(
                "h-8 flex-1 rounded-control text-meta",
                segment === item.key
                  ? "bg-card font-bold text-foreground shadow-card"
                  : "text-muted-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {segment === "doc" ? (
          // **스텁** — 문서함이 아직 없다. 붙일 수 있는 것이 없고 그 사실을 말한다.
          <div className="flex flex-col items-center gap-1 py-6 text-center">
            <p className="text-meta text-fg-caption">자료함이 아직 없습니다</p>
            <p className="text-caption text-fg-caption">
              자료함에 올린 md 문서만 첨부할 수 있습니다
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Input
              aria-label="URL"
              placeholder="https://"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (isEnterSubmit(event)) void submit();
              }}
              className="h-9"
            />
            <Input
              aria-label="표시 이름"
              placeholder="표시 이름 (비우면 주소를 그대로 씁니다)"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              onKeyDown={(event) => {
                if (isEnterSubmit(event)) void submit();
              }}
              className="h-9"
            />
            <Button
              type="button"
              className="h-9 self-end px-3 text-meta"
              disabled={!canAdd}
              onClick={() => void submit()}
            >
              추가
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
