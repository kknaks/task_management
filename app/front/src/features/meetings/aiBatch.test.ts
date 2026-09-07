/**
 * `ai.batch` — **AI 트랙 통째 교체**(SPEC-007 U-4 · MF-53 · WP Phase 4 검증).
 *
 * 프레임이 그 회차의 AI 트랙 전량이라 병합·고아 판정이 없다 — 첫 배치의 안건·줄 id 는 남지 않는다.
 */

import { describe, expect, it } from "vitest";

import { mergeAiBatch } from "@/features/meetings/aiBatch";
import { meetingDetail } from "@/features/meetings/testUtils";
import type { MeetingAgenda, MeetingLine } from "@/features/meetings/types";

const line = (id: number, agendaId: number, content: string): MeetingLine => ({
  id,
  track: "ai",
  agendaId,
  kind: "decision",
  content,
  detail: null,
  evidence: [],
  orderIndex: id,
  taskId: null,
  payload: null,
  task: null,
  createdAt: "2026-08-27T00:41:00Z",
});
const agenda = (id: number, sourceAgendaId: number | null, lines: MeetingLine[] = []): MeetingAgenda => ({
  id,
  track: "ai",
  title: `AI ${id}`,
  orderIndex: id,
  state: null,
  sourceAgendaId,
  lines,
});

const HUMAN: MeetingAgenda[] = [
  { id: 301, track: "human", title: "개정 대상 섹션 확정", orderIndex: 0, state: "active", sourceAgendaId: null, lines: [] },
];

describe("mergeAiBatch — 통째 교체", () => {
  it("AI 트랙이 프레임 트리로 갈리고 **첫 배치의 안건·줄 id 가 남지 않는다** · `latestBatchSeq` 가 올라간다", () => {
    const detail = meetingDetail({
      status: "recording",
      latestBatchSeq: 1,
      agendas: { human: HUMAN, ai: [agenda(40, 301, [line(620, 40, "첫 배치")])], merged: [] },
    });

    const next = mergeAiBatch(detail, {
      seq: 2,
      agendas: [agenda(50, 301, [line(700, 50, "둘째 배치가 다시 정리한 줄")]), agenda(51, null, [line(701, 51, "새 안건 줄")])],
    });

    expect(next.latestBatchSeq).toBe(2);
    expect(next.agendas.ai.map((a) => a.id)).toEqual([50, 51]);
    const lineIds = next.agendas.ai.flatMap((a) => a.lines.map((l) => l.id));
    expect(lineIds).toEqual([700, 701]);
    expect(lineIds).not.toContain(620);
    expect(next.agendas.ai[0].lines.map((l) => l.content)).toEqual(["둘째 배치가 다시 정리한 줄"]);
    // 사람 트랙은 건드리지 않는다(M-6) · 원본도 그대로다
    expect(next.agendas.human).toBe(detail.agendas.human);
    expect(detail.agendas.ai[0].lines).toHaveLength(1);
  });

  it("빈 트리가 오면 AI 트랙이 비고, 낮은 `seq` 는 회차를 내리지 않는다", () => {
    const detail = meetingDetail({ latestBatchSeq: 3, agendas: { human: HUMAN, ai: [agenda(40, 301, [line(620, 40, "a")])], merged: [] } });
    const next = mergeAiBatch(detail, { seq: 2, agendas: [] });
    expect(next.latestBatchSeq).toBe(3);
    expect(next.agendas.ai).toEqual([]);
  });

  it("프레임의 줄 배열을 복사한다 — 캐시가 프레임 객체를 붙들지 않는다", () => {
    const detail = meetingDetail({ agendas: { human: HUMAN, ai: [], merged: [] } });
    const frameAgenda = agenda(50, null, [line(700, 50, "x")]);
    const next = mergeAiBatch(detail, { seq: 1, agendas: [frameAgenda] });
    expect(next.agendas.ai[0].lines).not.toBe(frameAgenda.lines);
    expect(next.agendas.ai[0].lines).toEqual(frameAgenda.lines);
  });
});
