"use client";

/**
 * **안건 > 줄 트리 — 트랙 무관 한 벌**(SPEC-007 U-2 · U-4 · WP §Internal Interface Contract).
 *
 * 회의록 탭(사람 트랙) · AI 요약 탭(AI 트랙) · **WORK-008 통합본 탭**이 **이 컴포넌트 하나**를 쓴다.
 * **컴포넌트 안에 `track` 비교가 없다** — 차이는 전부 prop 이다.
 *
 * | prop | 회의록 탭 | AI 탭 | WORK-008 통합본 |
 * |---|---|---|---|
 * | `expandable` | `false` | `true`(상세 + 근거 칩) | `true` |
 * | `onToggleDone` | 완료 체크 → `PATCH state` | 없음(표시만) | 편집 모드에서 |
 * | `onChipClick` | — | 스크립트 탭 전환 + `scrollToRange` | 같은 규칙 |
 * | `badgeFor` | `state` → 「논의 중」/「완료」/「대기」 | 미러 안건은 원본 `state`, 신설은 「AI 안건」 캡션 | 「다음 논의로」 |
 * | `renderLineActions` | — | — | 줄 버튼 슬롯 |
 *
 * 규격은 [09] L660~680 한 벌 — 안건 gap 20 · 줄 `margin-left 37 · border-left 2px`(활성 `#C9D1FB` · 그 외 `#EBEBEB`) ·
 * 라벨 폭 34. 줄 없는 안건은 「아직 기록 없음」(13 `#C9CBD1`).
 */

import type { ReactNode } from "react";

import { AgendaHeader, type AgendaBadge } from "@/features/meetings/components/AgendaHeader";
import { LineRow } from "@/features/meetings/components/LineRow";
import type { MeetingAgenda, MeetingLine } from "@/features/meetings/types";
import { formatClock } from "@/lib/datetime";
import { cn } from "@/lib/utils";

export type { AgendaBadge } from "@/features/meetings/components/AgendaHeader";

export interface AgendaLineTreeProps {
  agendas: readonly MeetingAgenda[];
  /** 활성 안건 — 줄 기준선이 `#C9D1FB` 다. 없으면 전부 `#EBEBEB`. */
  activeAgendaId?: number | null;
  /** 줄 펼침(상세 + 근거 칩). 회의록 탭 `false` · AI 탭 `true`. */
  expandable: boolean;
  /** 안건 헤더 체크 — 있으면 클릭 가능. done ↔ next 판정은 호출자가 한다. */
  onToggleDone?: (agenda: MeetingAgenda) => void;
  /** 근거 칩 클릭. 대상 블록이 있었는지 돌려준다(U-6). */
  onChipClick?: (fromMs: number, toMs: number) => boolean;
  /** 배지·캡션 문구 — 화면이 정한다(회의 중 「대기」 / 종료 후 「다음 논의로」 / 「AI 안건」). */
  badgeFor: (agenda: MeetingAgenda) => AgendaBadge;
  /** 근거 칩 벽시계의 기준점(M-11). 없으면 칩 대신 「근거 없음」. */
  recordingStartedAt: string | null;
  /** WORK-008 통합본 — 줄 우측 버튼 슬롯. */
  renderLineActions?: (line: MeetingLine, agenda: MeetingAgenda) => ReactNode;
  /** 안건이 하나도 없을 때. 문구는 화면마다 다르다(U-2 「`/` 로 첫 안건을…」 · U-4 「기록이 쌓이면…」). */
  empty: ReactNode;
  className?: string;
}

function byOrder<T extends { orderIndex: number; id: number }>(a: T, b: T): number {
  return a.orderIndex - b.orderIndex || a.id - b.id;
}

/** 안건 우측 시각 = 그 안건 줄의 `min(createdAt)`(Data Contract) — 줄이 없으면 숨김. */
function firstLineClock(lines: readonly MeetingLine[]): string | null {
  if (lines.length === 0) {
    return null;
  }
  const earliest = lines.reduce((min, line) => (line.createdAt < min ? line.createdAt : min), lines[0].createdAt);
  return formatClock(earliest);
}

export function AgendaLineTree({
  agendas,
  activeAgendaId = null,
  expandable,
  onToggleDone,
  onChipClick,
  badgeFor,
  recordingStartedAt,
  renderLineActions,
  empty,
  className,
}: AgendaLineTreeProps) {
  if (agendas.length === 0) {
    return <>{empty}</>;
  }

  return (
    <ol className={cn("flex flex-col gap-5", className)}>
      {[...agendas].sort(byOrder).map((agenda) => {
        const lines = [...agenda.lines].sort(byOrder);
        const active = agenda.id === activeAgendaId;
        return (
          <li key={agenda.id} data-agenda-id={agenda.id} className="flex flex-col gap-1.5">
            <AgendaHeader
              number={agenda.orderIndex + 1}
              title={agenda.title}
              badge={badgeFor(agenda)}
              time={firstLineClock(lines)}
              onToggleDone={onToggleDone ? () => onToggleDone(agenda) : undefined}
            />
            {lines.length === 0 ? (
              <div className="ml-[37px] border-l-2 border-row-divider pl-[22px] pt-1">
                <span className="text-meta text-fg-faint">아직 기록 없음</span>
              </div>
            ) : (
              <div
                className={cn(
                  "ml-[37px] flex flex-col gap-0.5 border-l-2 pl-3.5",
                  active ? "border-ai-bar-border" : "border-divider",
                )}
              >
                {lines.map((line) => (
                  <LineRow
                    key={line.id}
                    line={line}
                    recordingStartedAt={recordingStartedAt}
                    expandable={expandable}
                    onChipClick={onChipClick}
                    actions={renderLineActions?.(line, agenda)}
                  />
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
