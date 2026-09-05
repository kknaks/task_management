"use client";

/**
 * **S-20 인라인 텍스트 편집 + U-7 자동 저장 실패 표시**(SPEC-002).
 *
 * 저장 시점은 **포커스 해제**다 — 「자동 저장 화면엔 저장 버튼이 없다」([10] RULES · DEC-001 §5).
 *
 * ## U-7 실패 표시 — 전 영역 공통 규격
 *
 * - *실패 필드*: 테두리 실패색 + **값 유지**. 아래 12px 캡션 「저장되지 않았습니다」 +
 *   같은 줄 우측 텍스트 버튼 「다시 저장」
 * - *유지 조건*: **화면에 남는다.** 다른 필드를 만지거나 스크롤해도 지워지지 않는다
 * - *해제 조건*: ① 「다시 저장」 성공 ② 그 필드를 다시 편집해 저장 성공 — **둘뿐**이고
 *   **시간 경과로 사라지지 않는다**
 * - **자동 재시도가 없다.** 「다시 저장」을 누를 때만 한 번 나간다(DEC-001 §7 · FE §3-2 `retry:false`)
 *
 * 토스트는 **호출자**가 띄운다 — 필드 이름을 아는 쪽이 문구를 만든다(「저장하지 못했습니다 · <필드 이름>」).
 */

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export interface InlineEditTextProps {
  value: string;
  /**
   * 저장한다. **거절하면 실패 표시가 남는다** — 이 컴포넌트는 재시도하지 않는다.
   * 값이 그대로면 부르지 않는다(포커스만 스쳐도 요청이 나가지 않게).
   */
  onSave: (next: string) => Promise<void>;
  /** 기본 유형 3종의 이름처럼 **편집 자체가 없는** 자리(A-4). 클릭해도 편집으로 바뀌지 않는다. */
  readOnly?: boolean;
  /** 인라인 안내 — 중복 이름·잠금처럼 **그 항목 옆에 붙는** 사유(§3-5). */
  errorMessage?: string | null;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
}

export function InlineEditText({
  value,
  onSave,
  readOnly = false,
  errorMessage = null,
  placeholder,
  ariaLabel,
  className,
}: InlineEditTextProps) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  /** U-7 실패 표시. **해제는 저장 성공 때만** — 여기서 타이머를 걸지 않는다. */
  const [saveFailed, setSaveFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 서버가 정본이다. 목록이 갱신되면 그 값을 따라간다 — 단 편집 중에는 빼앗지 않는다.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setDraft(value);
    }
  }, [value]);

  const commit = async (next: string) => {
    if (next === value) {
      // 값이 그대로면 요청을 만들지 않는다. 실패 표시도 건드리지 않는다.
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
      // **해제 조건 ②** — 그 필드를 다시 편집해 저장이 성공했다.
      setSaveFailed(false);
    } catch {
      // 사유는 호출자가 토스트로 띄운다. 여기는 **필드에 남는 표시**만 맡는다.
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const retry = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      // **해제 조건 ①** — 「다시 저장」이 성공했다.
      setSaveFailed(false);
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  if (readOnly) {
    // 기본 유형의 이름 — 입력을 렌더하지 않는다. **서버 판정이 정본이지만 화면도 막는다**(두 겹).
    return (
      <span className={cn("truncate text-body text-foreground", className)} title={value}>
        {value}
      </span>
    );
  }

  const invalid = saveFailed || errorMessage !== null;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <input
        ref={inputRef}
        type="text"
        aria-label={ariaLabel}
        aria-invalid={invalid}
        placeholder={placeholder}
        value={draft}
        disabled={saving}
        onChange={(event) => setDraft(event.target.value)}
        // **포커스 해제 = 저장 시점**(DEC-001 §5)
        onBlur={(event) => void commit(event.target.value.trim())}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            // 되돌리고 저장하지 않는다.
            setDraft(value);
            event.currentTarget.blur();
          }
        }}
        className={cn(
          "h-input w-full min-w-0 rounded-control border bg-transparent px-2 text-body text-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "disabled:opacity-60",
          invalid ? "border-destructive" : "border-transparent hover:border-border",
        )}
      />

      {/* 중복 이름·잠금 같은 **서버가 준 사유**는 그 항목 옆에 붙는다(§3-5) */}
      {errorMessage ? <p className="text-caption text-destructive">{errorMessage}</p> : null}

      {/* U-7 — **시간 경과로 사라지지 않는다** */}
      {saveFailed ? (
        <p className="flex items-center gap-2 text-caption text-destructive">
          <span>저장되지 않았습니다</span>
          <button
            type="button"
            onClick={() => void retry()}
            disabled={saving}
            className="underline underline-offset-2 disabled:opacity-60"
          >
            다시 저장
          </button>
        </p>
      ) : null}
    </div>
  );
}
