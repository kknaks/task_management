"use client";

/**
 * **하단 안건 입력 바**(SPEC-006 U-4 · 회의록.dc.html L616~628).
 *
 * 56px r14 · 1px `#7181F8` + 3px 글로우 · 배경 `#fff`. **모드 칩 「새 안건 ▾」(L618~621)과
 * 전송 버튼(L623~625)은 그리지 않는다**(§7 — AI 프롬프트). 대신 [입력(유동)] + 우측 「추가」 40px.
 * 캡션 「시작 전에는 새 안건만 만들 수 있습니다」(L627 그대로 — AI 와 무관한 문장).
 *
 * `Enter` + 「추가」 병행([10] 단축키는 보조). 등록 후 **입력이 비워지고 포커스가 남는다**.
 * 부모를 모른다 — `onAdd` 가 성공(`true`)했을 때만 비운다(실패면 값 유지).
 */

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { isEnterSubmit } from "@/lib/keyboard";
import { cn } from "@/lib/utils";

export function AgendaInputBar({
  onAdd,
  adding = false,
  caption = "시작 전에는 새 안건만 만들 수 있습니다",
}: {
  /** `true` 면 등록됐다 — 입력을 비운다. `false` 면 값이 남는다(U-7 「값 유지」). */
  onAdd: (title: string) => Promise<boolean>;
  adding?: boolean;
  caption?: string | null;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const canAdd = draft.trim().length > 0 && !adding;

  const submit = async () => {
    if (!canAdd) {
      return;
    }
    const ok = await onAdd(draft.trim());
    if (ok) {
      setDraft("");
    }
    inputRef.current?.focus();
  };

  return (
    <div className="flex shrink-0 flex-col gap-2.5 border-t border-divider px-6 py-4">
      <div
        className={cn(
          "flex min-h-14 items-center gap-2.5 rounded-[14px] border bg-card px-2.5",
          "border-primary shadow-focus",
        )}
      >
        <input
          ref={inputRef}
          type="text"
          aria-label="안건"
          placeholder="안건 입력 후 Enter"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // **조합 확정 Enter 로 등록하지 않는다**(lib/keyboard) — 한글에서 두 건이 생긴다
            if (isEnterSubmit(event)) {
              event.preventDefault();
              void submit();
            }
          }}
          className="h-10 min-w-0 flex-1 bg-transparent px-2 text-body text-foreground placeholder:text-fg-placeholder focus-visible:outline-none"
        />
        <button
          type="button"
          aria-label="안건 추가"
          onClick={() => void submit()}
          disabled={!canAdd}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-control bg-primary px-4 text-meta font-semibold text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          추가
        </button>
      </div>
      {caption ? <p className="text-caption text-fg-caption">{caption}</p> : null}
    </div>
  );
}
