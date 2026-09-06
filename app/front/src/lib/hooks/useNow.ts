"use client";

/**
 * **「지금」을 주기적으로 갱신하는 시계** — 상태 바 경과 시간(1초) · 프롬프트 바 현재 시각(1분).
 *
 * 값은 `Date.now()` 숫자다. 포맷은 `lib/datetime` 이 한다 — 컴포넌트가 `new Date()` 를
 * 만들지 않는다(FE §3-6). 여기 `setInterval` 은 **표시용 시계**이지 재연결 타이머가 아니다 —
 * `useMeetingStream`·`lib/api/ws.ts` 에는 타이머가 없다(SPEC-007 §5 「자동 재연결 없음」).
 */

import { useEffect, useState } from "react";

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}
