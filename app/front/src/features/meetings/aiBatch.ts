/**
 * **WS `ai.batch` 를 상세 캐시에 병합하는 순수 함수**(SPEC-007 U-4 · WP 캐시 키 행 「AI 증분은 WS 프레임으로 캐시에 직접 병합 — 재조회 없음」).
 *
 * - 그 회차에 **새로 생긴** AI 안건·줄만 온다. 안건은 id 로 중복을 거르고, 줄은 자기 안건(`agendaId`)의 `lines` 끝에 붙인다
 * - **기존 AI 줄은 바꾸지 않는다**(M-7 — 증분 추가만). 같은 id 가 다시 와도 건너뛴다
 * - `latestBatchSeq` 는 `max(기존, seq)` — 「배치 n회 반영」의 원천
 * - 줄의 안건이 캐시에도 프레임에도 없으면 `orphaned` 로 돌려준다 — 호출자가 상세를 다시 읽는다(가리지 않는다)
 */

import type { MeetingAgenda, MeetingDetail, MeetingLine } from "@/features/meetings/types";

export function mergeAiBatch(
  detail: MeetingDetail,
  frame: { seq: number; agendas: MeetingAgenda[]; lines: MeetingLine[] },
): { detail: MeetingDetail; orphaned: number } {
  const known = new Map<number, MeetingAgenda>(detail.agendas.ai.map((agenda) => [agenda.id, agenda]));
  for (const agenda of frame.agendas) {
    if (!known.has(agenda.id)) {
      known.set(agenda.id, { ...agenda, lines: [...(agenda.lines ?? [])] });
    }
  }

  let orphaned = 0;
  for (const line of frame.lines) {
    const agenda = known.get(line.agendaId);
    if (!agenda) {
      orphaned += 1;
      continue;
    }
    if (agenda.lines.some((existing) => existing.id === line.id)) {
      continue;
    }
    known.set(line.agendaId, { ...agenda, lines: [...agenda.lines, line] });
  }

  return {
    detail: {
      ...detail,
      latestBatchSeq: Math.max(detail.latestBatchSeq, frame.seq),
      agendas: { ...detail.agendas, ai: [...known.values()] },
    },
    orphaned,
  };
}
