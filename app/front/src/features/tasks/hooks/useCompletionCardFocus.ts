"use client";

/**
 * **게이트 유도 진입 훅**(SPEC-003 U-6 · WORK-004 Phase 6).
 *
 * > *게이트 유도 진입*(SPEC-004 U-6 에서 거부 토스트의 「결과 입력」을 눌러 들어온 경우):
 * > 상세가 열리며 이 카드로 **스크롤**하고 **완료 결과 입력에 포커스**가 잡힌다.
 * > 카드 테두리가 **1.5초 동안** `--tm-primary`.
 *
 * 전에는 DOM id 하나뿐이라 **「자리」이지 「훅」이 아니었다**(검수 W-9). 셋(스크롤·포커스·강조)을
 * 여기 담아 `features/tasks` 가 **내보낸다** — WORK-005 가 직접 만들면 규격이 그쪽에서 정해진다.
 *
 * ```tsx
 * const completion = useCompletionCardFocus();
 * <TaskDetailBody task={task} completion={completion} />
 * // 거부 토스트의 「결과 입력」에서:
 * completion.focus();
 * ```
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** 강조가 머무는 시간 — U-6 이 「1.5초」로 못박았다. */
const HIGHLIGHT_MS = 1500;

export interface CompletionCardFocus {
  /** 「결과자료 · 완료 결과」 카드에 건다. */
  cardRef: React.RefObject<HTMLElement | null>;
  /** 완료 결과 입력에 건다. */
  inputRef: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  /** 강조 중인가 — 카드가 테두리를 이 값으로 바꾼다. */
  highlighted: boolean;
  /** **스크롤 + 포커스 + 1.5초 강조** 셋을 함께 실행한다. */
  focus: () => void;
}

export function useCompletionCardFocus(): CompletionCardFocus {
  const cardRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const [highlighted, setHighlighted] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 언마운트 뒤에 강조가 풀리는 타이머가 남지 않게 한다.
  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  const focus = useCallback(() => {
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    inputRef.current?.focus();
    setHighlighted(true);
    if (timer.current !== null) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => setHighlighted(false), HIGHLIGHT_MS);
  }, []);

  return { cardRef, inputRef, highlighted, focus };
}
