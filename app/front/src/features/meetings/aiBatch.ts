/**
 * **WS `ai.batch` 를 상세 캐시에 반영하는 순수 함수**(SPEC-007 U-4 · §4 `ai.batch` 행 · FE §8 「AI 증분」 · MF-53).
 *
 * - 프레임은 **AI 트랙 전체**다 — 그 회차가 갈아끼운 안건 > 줄 트리 전량(줄은 `AgendaItem.lines[]` 안에 중첩).
 *   그래서 병합이 아니라 **통째 교체**다: `detail.agendas.ai = frame.agendas`. 붙이면 중복이 된다
 * - **고아 판정이 없다**(WORK-011) — 줄이 항상 자기 안건 안에 실려 오므로 재조회할 갈래가 없다
 * - AI 안건·줄의 **id 는 배치마다 새로 생긴다**(M-7) — 화면이 id 를 붙들지 않는다(펼쳐 둔 줄은 접힌다)
 * - `latestBatchSeq` 는 `max(기존, seq)` — 「배치 n회 반영」의 원천. 늦게 도착한 낮은 회차가 회차를 내리지 않는다
 * - 사람 트랙(`agendas.human`)·`merged` 는 건드리지 않는다(M-6 — AI 는 `ai` 트랙에만 쓴다)
 */

import type { MeetingAgenda, MeetingDetail } from "@/features/meetings/types";

export function mergeAiBatch(detail: MeetingDetail, frame: { seq: number; agendas: MeetingAgenda[] }): MeetingDetail {
  return {
    ...detail,
    latestBatchSeq: Math.max(detail.latestBatchSeq, frame.seq),
    agendas: {
      ...detail.agendas,
      ai: frame.agendas.map((agenda) => ({ ...agenda, lines: [...(agenda.lines ?? [])] })),
    },
  };
}
