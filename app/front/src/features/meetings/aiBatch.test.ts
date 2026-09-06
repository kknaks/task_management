/**
 * `ai.batch` 병합 — **증분 추가만**(M-7) · `latestBatchSeq = max` · 안건 없는 줄은 `orphaned`.
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
  pendingChange: null,
  sourceHumanLineId: null,
  sourceAiLineId: null,
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

describe("mergeAiBatch", () => {
  it("새 안건·줄만 붙고 `latestBatchSeq` 가 올라간다 · 기존 줄은 그대로다", () => {
    const detail = meetingDetail({
      status: "recording",
      latestBatchSeq: 1,
      agendas: { human: [], ai: [agenda(40, 301, [line(620, 40, "첫 배치")])], merged: [] },
    });
    const { detail: next, orphaned } = mergeAiBatch(detail, {
      seq: 2,
      agendas: [agenda(41, null)],
      lines: [line(621, 40, "둘째 배치"), line(622, 41, "새 안건 줄")],
    });

    expect(orphaned).toBe(0);
    expect(next.latestBatchSeq).toBe(2);
    expect(next.agendas.ai.map((a) => a.id)).toEqual([40, 41]);
    expect(next.agendas.ai[0].lines.map((l) => l.content)).toEqual(["첫 배치", "둘째 배치"]);
    expect(next.agendas.ai[1].lines.map((l) => l.content)).toEqual(["새 안건 줄"]);
    // 원본은 건드리지 않는다.
    expect(detail.agendas.ai[0].lines).toHaveLength(1);
  });

  it("같은 id 가 다시 오면 건너뛰고, 낮은 `seq` 는 회차를 내리지 않는다", () => {
    const detail = meetingDetail({ latestBatchSeq: 3, agendas: { human: [], ai: [agenda(40, 301, [line(620, 40, "a")])], merged: [] } });
    const { detail: next } = mergeAiBatch(detail, { seq: 2, agendas: [agenda(40, 301)], lines: [line(620, 40, "a (dup)")] });
    expect(next.latestBatchSeq).toBe(3);
    expect(next.agendas.ai).toHaveLength(1);
    expect(next.agendas.ai[0].lines).toEqual([line(620, 40, "a")]);
  });

  it("안건이 캐시에도 프레임에도 없는 줄은 `orphaned` 로 센다 — 호출자가 상세를 다시 읽는다", () => {
    const detail = meetingDetail({ agendas: { human: [], ai: [], merged: [] } });
    const { orphaned, detail: next } = mergeAiBatch(detail, { seq: 1, agendas: [], lines: [line(1, 99, "x")] });
    expect(orphaned).toBe(1);
    expect(next.agendas.ai).toEqual([]);
  });
});
