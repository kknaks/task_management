"use client";

/**
 * **S-20 인라인 텍스트 편집**(SPEC-002 U-3 · S-20).
 *
 * 저장 시점은 **포커스 해제**다 — 「자동 저장 화면엔 저장 버튼이 없다」([10] RULES · DEC-001 §5).
 *
 * ## 실패 상태는 **prop 이지 내부 state 가 아니다** (U-7 구현 규약)
 *
 * > 실패 상태를 컴포넌트 내부 state 로 두지 마라. `saveFailed` 를 **prop** 으로 받고
 * > 소유자는 **행/패널**이다(`rowFailures[id][field]`). 내부 state 로 두면 두 번째 자동 저장
 * > 컨트롤이 생기는 순간 규격이 샌다 — 실제로 그렇게 샜다(WORK-003 검수 F-1).
 *
 * 그래서 이 컴포넌트가 지는 것은 **테두리 실패색과 값 유지**뿐이고,
 * 캡션·「다시 저장」은 **행 아래 인라인 자리 하나**(`AutoSaveFailureNotice`)가 그린다.
 * 토스트도 필드 이름을 아는 **호출자**가 띄운다.
 *
 * `frontend/README.md` §3-5 「자동 저장 컴포넌트가 **실패 상태 prop 을 공통으로** 갖는다」 —
 * `ColorPickerPopover` 가 같은 `saveFailed` 를 받는다.
 */

import { useEffect, useRef, useState } from "react";

import { isEnterSubmit } from "@/lib/keyboard";
import { cn } from "@/lib/utils";

export interface InlineEditTextProps {
  value: string;
  /**
   * 저장한다. **거절해도 이 컴포넌트는 아무것도 기억하지 않는다** — 실패 표시는 소유자가
   * `saveFailed` 로 내려 준다. 재시도도 하지 않는다.
   * 값이 그대로면 부르지 않는다(포커스만 스쳐도 요청이 나가지 않게).
   */
  onSave: (next: string) => Promise<void>;
  /** 기본 유형 3종의 이름처럼 **편집 자체가 없는** 자리(A-4). 클릭해도 편집으로 바뀌지 않는다. */
  readOnly?: boolean;
  /**
   * **U-7 실패 표시.** 소유자(행/패널)가 든다. 해제 조건은 「다시 저장 성공」·「재편집 후
   * 저장 성공」 둘뿐이고 **시간 경과로 사라지지 않는다** — 그 판정도 소유자가 한다.
   */
  saveFailed?: boolean;
  /**
   * 여러 줄 입력인가 — 배경·목표·완료 결과가 그렇다(SPEC-003 U-2).
   * **편집 모드가 따로 없다**는 규칙은 같다. 한 줄이면 `input`, 여러 줄이면 `textarea` 다.
   */
  multiline?: boolean;
  /** 인라인 안내 — 중복 이름·잠금처럼 **그 항목 옆에 붙는** 사유(§3-5). */
  errorMessage?: string | null;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
  /**
   * 바깥에서 이 입력에 **포커스를 주고 싶을 때** 건다(게이트 유도 진입 — SPEC-003 U-6).
   * 내부 ref 는 그대로 두고 여기에 같은 노드를 실어 보낸다.
   */
  fieldRef?: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
}

export function InlineEditText({
  value,
  onSave,
  readOnly = false,
  multiline = false,
  saveFailed = false,
  errorMessage = null,
  placeholder,
  ariaLabel,
  className,
  fieldRef,
}: InlineEditTextProps) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  /** 내부 ref 와 바깥 ref 에 같은 노드를 싣는다. */
  const attachRef = (node: HTMLInputElement | HTMLTextAreaElement | null) => {
    (inputRef as React.MutableRefObject<HTMLInputElement | HTMLTextAreaElement | null>).current =
      node;
    if (fieldRef) {
      (fieldRef as React.MutableRefObject<HTMLInputElement | HTMLTextAreaElement | null>).current =
        node;
    }
  };

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
      // 성공·실패 판정은 소유자가 한다 — 여기서 삼키지 않고 그대로 흘려보낸다.
      await onSave(next);
    } catch {
      // 소유자가 `saveFailed` 를 켠다. 여기서 다시 시도하지 않는다.
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

  const shared = {
    "aria-label": ariaLabel,
    "aria-invalid": invalid,
    placeholder,
    value: draft,
    disabled: saving,
    // **포커스 해제 = 저장 시점**(DEC-001 §5)
    onBlur: (event: { target: { value: string } }) => void commit(event.target.value.trim()),
  };

  const fieldClass = cn(
    "w-full min-w-0 rounded-control border bg-transparent px-2 text-body text-foreground",
    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
    "disabled:opacity-60",
    // **실패한 컨트롤 자신에 테두리 실패색 + 값 유지**(U-7)
    invalid ? "border-destructive" : "border-transparent hover:border-border",
  );

  if (multiline) {
    return (
      <div className={cn("flex min-w-0 flex-col gap-1", className)}>
        <textarea
          {...shared}
          ref={attachRef}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              // 되돌리고 저장하지 않는다.
              setDraft(value);
              event.currentTarget.blur();
            }
          }}
          /**
           * **크기 손잡이를 두지 않는다**(REDRAW-05 F-1b 와 같은 규칙) — 시안에 없다.
           * 높이는 내용에 맞추지 않고 고정이다.
           */
          className={cn(fieldClass, "min-h-20 resize-none py-1.5")}
        />
        {errorMessage ? <p className="text-caption text-destructive">{errorMessage}</p> : null}
      </div>
    );
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <input
        ref={attachRef}
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
          // **조합 확정 Enter 로 저장하지 않는다**(B-1) — 조합 중에 blur 하면 절반만 저장된다
          if (isEnterSubmit(event)) {
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
          // **실패한 컨트롤 자신에 테두리 실패색 + 값 유지**(U-7)
          invalid ? "border-destructive" : "border-transparent hover:border-border",
        )}
      />

      {/* 중복 이름·잠금 같은 **서버가 준 사유**는 그 항목 옆에 붙는다(§3-5).
          자동 저장 실패의 캡션·「다시 저장」은 여기가 아니라 행 아래 인라인 자리 하나다(U-7). */}
      {errorMessage ? <p className="text-caption text-destructive">{errorMessage}</p> : null}
    </div>
  );
}
