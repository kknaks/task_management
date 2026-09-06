"use client";

/**
 * **줄 행 한 벌**(SPEC-007 U-2 · U-4 · [09] L660~700 · 시안 L858~871).
 *
 * 라벨 폭 34 · 11/700, 색은 종류별 — 논의 `#9EA2AE` · 결정 `#1663B5`(본문 600 · 배경 `#F8FAFF`) ·
 * **업무 `#5F6470`**(본문 600) · 액션 `#4B52A8`(본문 600). 우측 시각 = `createdAt` `HH:MM`.
 *
 * **트랙을 모른다.** 회의록 탭(사람 줄) · AI 탭(AI 줄) · WORK-008 통합본이 같은 행이다 — 차이는 prop 뿐이다.
 * - `expandable` — 우측 끝 펼침 화살표(22×22, **hover 에서만** — [09] L700). 펼치면 상세 + 근거 칩
 * - `actions` — WORK-008 통합본 편집 모드의 줄 버튼 슬롯. 회의 중에는 비어 있다
 *
 * **회의 중 사람 줄은 읽기 전용이다** — 클릭 핸들러·삭제·편집 어포던스가 없다(U-2). hover 배경 `#FAFBFC` 만.
 * `kind='task'` 줄이 업무를 가리키면(`task` 요약 — AI 줄) 라벨 옆에 그 업무의 **유형 배지**(공용 `TypeBadge` · `task.workType`)를 단다(U-4 · [09] L671).
 * 회의 중 사람 업무 줄은 `task=null` 이라 라벨만이다(DEC-003 §1 표). 「업무 갱신」 버튼은 WORK-008 이 같은 자리(`actions`)에 붙인다.
 */

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { TypeBadge } from "@/components/shared/TypeBadge";
import { EvidenceChip } from "@/features/meetings/components/EvidenceChip";
import type { LineKind, MeetingLine } from "@/features/meetings/types";
import { formatClock } from "@/lib/datetime";
import { cn } from "@/lib/utils";

/** 표시 매핑(G-4) — 저장값은 영문 소문자. 모르는 값이 와도 숨기지 않고 그대로 적는다. */
export const LINE_KIND_LABEL: Record<LineKind, string> = {
  discussion: "논의",
  decision: "결정",
  task: "업무",
  action: "액션",
};

const LABEL_CLASS: Record<LineKind, string> = {
  discussion: "text-fg-caption",
  decision: "text-line-decision",
  task: "text-muted-foreground",
  action: "text-secondary-foreground",
};

function isLineKind(kind: string): kind is LineKind {
  return kind in LINE_KIND_LABEL;
}

export function LineRow({
  line,
  recordingStartedAt,
  expandable,
  onChipClick,
  actions,
}: {
  line: MeetingLine;
  recordingStartedAt: string | null;
  /** AI 탭 — 펼침 화살표 + 상세 + 근거 칩. 회의록 탭은 `false`. */
  expandable: boolean;
  onChipClick?: (fromMs: number, toMs: number) => boolean;
  /** WORK-008 통합본 편집 모드의 줄 버튼 슬롯. */
  actions?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const kind: LineKind = isLineKind(line.kind) ? line.kind : "discussion";
  const emphasized = kind !== "discussion";

  return (
    <div className="flex flex-col">
      <div
        data-line-kind={kind}
        className={cn(
          "group flex gap-3 rounded-control px-2 py-1.5",
          kind === "decision" ? "bg-row-selected" : "hover:bg-row-hover",
        )}
      >
        <span className={cn("w-[34px] shrink-0 pt-0.5 text-row-label", LABEL_CLASS[kind])}>
          {isLineKind(line.kind) ? LINE_KIND_LABEL[line.kind] : line.kind}
        </span>
        {kind === "task" && line.task ? (
          <TypeBadge name={line.task.workType.name} colorToken={line.task.workType.colorToken} />
        ) : null}
        <span className={cn("min-w-0 flex-1 text-body text-foreground", emphasized && "font-semibold")}>
          {line.content}
        </span>
        {actions}
        <span className="shrink-0 pt-[3px] text-caption tabular-nums text-fg-faint">
          {formatClock(line.createdAt)}
        </span>
        {expandable ? (
          <button
            type="button"
            aria-label={expanded ? "접기" : "펼치기"}
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
            className={cn(
              "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md text-muted-foreground transition-opacity hover:bg-agenda-badge focus-visible:opacity-100 group-hover:opacity-100",
              expanded ? "bg-agenda-badge opacity-100" : "opacity-0",
            )}
          >
            {expanded ? <ChevronUp className="h-3 w-3" aria-hidden /> : <ChevronDown className="h-3 w-3" aria-hidden />}
          </button>
        ) : null}
      </div>

      {expandable && expanded ? (
        <div className="ml-14 mr-2.5 mt-0.5 flex flex-col gap-2.5 border-l-2 border-ai-bar-border pl-3.5 pb-2">
          {line.detail ? (
            <p className="text-control-label leading-relaxed text-muted-foreground">{line.detail}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-caption text-fg-caption">근거</span>
            {line.evidence.length === 0 || !recordingStartedAt ? (
              <span className="text-caption text-fg-caption">근거 없음</span>
            ) : (
              <>
                {line.evidence.map((evidence, index) => (
                  <EvidenceChip
                    key={`${evidence.fromMs}-${evidence.toMs}-${index}`}
                    evidence={evidence}
                    recordingStartedAt={recordingStartedAt}
                    onClick={onChipClick}
                  />
                ))}
                {onChipClick ? (
                  <span className="text-caption text-fg-caption">칩을 누르면 해당 구간 스크립트로 이동합니다</span>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
