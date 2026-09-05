"use client";

/**
 * **U-7 실패 상태의 소유자**(SPEC-002 U-7 구현 규약 · 검수 F-1).
 *
 * > 실패 상태를 **컴포넌트 내부 state 로 두지 마라.** 소유자는 **행/패널**이다
 * > (`rowFailures[id][field]`). 내부 state 로 두면 두 번째 자동 저장 컨트롤이 생기는 순간
 * > 규격이 샌다 — 실제로 그렇게 샜다.
 *
 * 그 소유를 여기 한 훅에 모은다. 두 패널이 같은 규칙을 쓰고, 다음 영역도 이걸 그대로 쓴다.
 *
 * 규칙 셋은 **컨트롤 종류와 무관하게 같다**(U-7).
 * - **화면에 남는다** — 다른 필드를 만지거나 스크롤해도 지워지지 않는다. 타이머가 없다
 * - **해제 조건은 둘뿐** — ① 「다시 저장」 성공 ② 그 필드를 재편집해 저장 성공
 * - **자동 재시도 없음** — 이 훅은 재요청을 스스로 만들지 않는다
 */

import { useCallback, useState } from "react";

export interface FieldFailure {
  /** 그 필드를 **다시 저장하는 방법**. 「다시 저장」이 이걸 한 번 부른다. */
  retry: () => Promise<void>;
  /**
   * 사용자가 **넣으려던 값**. U-7 「테두리 실패색 + **값 유지**」의 값 쪽이다.
   *
   * 입력 상자는 자기 draft 를 들고 있어 저절로 유지되지만, **팝오버 컨트롤은 서버 값을
   * 보여주므로** 실패 뒤 옛 색으로 되돌아 보인다 — 그러면 무엇을 고르려 했는지 사라진다.
   */
  attempted?: string;
}

/** 한 행에서 실패한 필드들. */
export type RowFailures = Record<number, Record<string, FieldFailure>>;

export function useRowFailures() {
  const [failures, setFailures] = useState<RowFailures>({});

  /** 저장이 거절됐다 — 그 필드에 표시를 켜고 재요청 방법·넣으려던 값을 함께 든다. */
  const markFailed = useCallback((id: number, field: string, failure: FieldFailure) => {
    setFailures((prev) => ({ ...prev, [id]: { ...prev[id], [field]: failure } }));
  }, []);

  /** 저장이 성공했다 — **해제 조건 ①·②가 지나는 유일한 문**이다. */
  const clearFailed = useCallback((id: number, field: string) => {
    setFailures((prev) => {
      const row = prev[id];
      if (!row || !(field in row)) {
        return prev;
      }
      const rest = Object.fromEntries(Object.entries(row).filter(([key]) => key !== field));
      if (Object.keys(rest).length === 0) {
        return Object.fromEntries(Object.entries(prev).filter(([key]) => key !== String(id)));
      }
      return { ...prev, [id]: rest };
    });
  }, []);

  /** 행이 사라졌다(삭제). 남은 표시를 함께 걷는다 — 없는 행의 표시가 떠 있지 않게. */
  const clearRow = useCallback((id: number) => {
    setFailures((prev) => {
      if (!(id in prev)) {
        return prev;
      }
      return Object.fromEntries(Object.entries(prev).filter(([key]) => key !== String(id)));
    });
  }, []);

  const hasFailed = useCallback(
    (id: number, field: string) => Boolean(failures[id]?.[field]),
    [failures],
  );

  /** 실패한 필드가 **넣으려던 값**. 없으면 서버 값을 그대로 쓰라는 뜻이다. */
  const attemptedValue = useCallback(
    (id: number, field: string) => failures[id]?.[field]?.attempted,
    [failures],
  );

  return { failures, markFailed, clearFailed, clearRow, hasFailed, attemptedValue };
}
