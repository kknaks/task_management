/**
 * **회의 중 안건 배지 어휘**(DEC-003 §1 표 · SPEC-007 §7-A) — `next` 는 「**대기**」.
 *
 * `MeetingLiveView`(WORK-007)가 정의하던 것을 파일로 올렸다(WORK-008) — 종료 후 본문(`MeetingDetailBody`)의 드로어 `recording`
 * 스냅숏(SPEC-008 U-4)이 같은 어휘를 쓰는데, 회의 중 화면 파일을 import 하면 화면 → 드로어 레지스트리 → 상세 드로어 → 본문 순환이 생긴다.
 * 종료 후 어휘(「다음 논의로」)는 `closeState.ts` 의 `ENDED_AGENDA_BADGE` 다 — 같은 `state` 값이지만 뜻이 둘이라 문구를 통일하지 않는다.
 */

import type { AgendaBadge } from "@/features/meetings/components/AgendaHeader";
import type { AgendaState } from "@/features/meetings/types";

export const LIVE_AGENDA_BADGE: Record<AgendaState, Exclude<AgendaBadge, null>> = {
  active: { tone: "active", label: "논의 중" },
  done: { tone: "done", label: "완료" },
  next: { tone: "next", label: "대기" },
};
