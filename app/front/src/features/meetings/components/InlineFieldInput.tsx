"use client";

/**
 * **종료 후 편집의 인라인 입력 한 벌**(SPEC-008 U-7 · 시안 L1898~1909 · L1894).
 *
 * 줄 본문 · 안건 제목이 같은 규칙을 탄다 —
 * - **포커스 해제 = 저장**(DEC-001 §5). 값이 그대로면 요청을 만들지 않는다
 * - **빈 값으로 벗어나면 저장하지 않고 원래 값으로 되돌린다** + 캡션(「내용을 비울 수 없습니다」 / 「안건 이름을 비울 수 없습니다」)
 * - `Esc` 는 그 필드만 편집 전 값으로, 저장 안 함 · `Enter`(조합 확정 제외 — `isEnterSubmit`)는 blur
 * - 포커스 시 테두리 `#7181F8` · 저장 중 우측 작은 진행 표시(SPEC-003 U-2)
 *
 * **실패 상태는 prop 이다**(SPEC-002 U-7 구현 규약) — `saveFailed` 로 테두리만 실패색이 되고 값은 유지된다.
 * 캡션·「다시 저장」은 소유 블록의 `AutoSaveFailureNotice` 자리가 그린다. 여기서 재시도하지 않는다.
 * 공용 `InlineEditText` 를 쓰지 않는 이유 하나 — 그쪽은 빈 값도 저장 요청으로 보낸다(「빈 값 되돌림」 규칙이 없다).
 */

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { isEnterSubmit } from "@/lib/keyboard";
import { cn } from "@/lib/utils";

export function InlineFieldInput({
  value,
  onSave,
  ariaLabel,
  emptyMessage,
  saveFailed = false,
  disabled = false,
  autoFocus = false,
  className,
  inputClassName,
}: {
  value: string;
  /** 거절은 throw 로 돌아온다 — 소유자가 `saveFailed` 를 켠다. 여기서 삼키지도 재시도하지도 않는다. */
  onSave: (next: string) => Promise<void>;
  ariaLabel: string;
  /** 빈 값으로 벗어났을 때의 캡션. 다음 입력이 시작되면 사라진다. */
  emptyMessage: string;
  saveFailed?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  inputClassName?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [emptyNotice, setEmptyNotice] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  /** `Esc` 로 되돌린 직후의 blur 는 저장이 아니다 — DOM 값이 아직 옛 draft 라 그대로 두면 되돌린 것을 저장한다. */
  const escapingRef = useRef(false);

  // 서버가 정본이다 — 편집 중이 아닐 때만 따라간다.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setDraft(value);
    }
  }, [value]);

  const commit = async (raw: string) => {
    const next = raw.trim();
    if (next.length === 0) {
      // **저장하지 않고 원래 값으로**(U-7 문구) — 요청이 나가지 않는다.
      setDraft(value);
      setEmptyNotice(true);
      return;
    }
    if (next === value) {
      setDraft(value);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
    } catch {
      // 소유자가 `saveFailed` 를 켠다. 값은 그대로 남는다(U-7 「테두리 실패색 + 값 유지」).
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <div className="relative flex min-w-0 items-center">
        <input
          ref={inputRef}
          type="text"
          aria-label={ariaLabel}
          aria-invalid={saveFailed}
          value={draft}
          disabled={disabled || saving}
          autoFocus={autoFocus}
          onChange={(event) => {
            setDraft(event.target.value);
            setEmptyNotice(false);
          }}
          onBlur={(event) => {
            if (escapingRef.current) {
              escapingRef.current = false;
              return;
            }
            void commit(event.target.value);
          }}
          onKeyDown={(event) => {
            if (isEnterSubmit(event)) {
              event.preventDefault();
              event.currentTarget.blur();
              return;
            }
            if (event.key === "Escape") {
              // 그 필드만 편집 전 값으로 — 저장하지 않는다(U-7 CTA).
              escapingRef.current = true;
              setDraft(value);
              setEmptyNotice(false);
              event.currentTarget.blur();
            }
          }}
          className={cn(
            "w-full min-w-0 rounded-control border bg-card text-foreground focus-visible:outline-none",
            saveFailed ? "border-destructive" : "border-divider focus-visible:border-primary",
            "disabled:opacity-60",
            saving && "pr-7",
            inputClassName,
          )}
        />
        {saving ? (
          <Loader2 aria-label="저장 중" className="absolute right-2 h-3 w-3 animate-spin text-fg-caption" />
        ) : null}
      </div>
      {emptyNotice ? (
        <p role="status" className="text-caption text-fg-caption">
          {emptyMessage}
        </p>
      ) : null}
    </div>
  );
}
