"use client";

/**
 * **줄 행 한 벌**(SPEC-007 U-2 · U-4 · SPEC-008 U-3 · U-5 · U-7 · [09] L660~700 · 시안 L858~871 · L1898~1909).
 *
 * 라벨 폭 34 · 11/700, 색은 종류별 — 논의 `#9EA2AE` · 결정 `#1663B5`(본문 600 · 배경 `#F8FAFF`) ·
 * **업무 `#5F6470`**(본문 600) · 액션 `#4B52A8`(본문 600).
 *
 * **줄에 시각을 붙이지 않는다**(WORK-011 · MF-9 · FE §8) — 시각은 **안건 헤더**(첫 줄 시각 — `AgendaLineTree`)와
 * 근거 칩 구간에만 있다. 안내 바의 「배치 n회 반영 · HH:MM」·「자동 저장 · HH:MM」·프롬프트 바 현재 시각은 이 규칙 밖이다.
 *
 * **트랙을 모른다.** 회의록 탭(사람 줄) · AI 탭(AI 줄) · WORK-008 통합본이 같은 행이다 — 차이는 prop 뿐이다.
 * - `expandable` — 우측 끝 펼침 화살표(22×22, **hover 에서만** — [09] L700). 펼치면 상세 + 근거 칩.
 *   통합본은 호출자(트리)가 `detail`·`evidence` 있는 줄에만 `true` 를 준다(SPEC-008 U-5)
 * - `actions` — 줄 버튼 슬롯(업무 생성 · 업무 갱신 — **Phase 5**). 회의 중에는 비어 있다
 * - **편집 모드(U-7)** — `editable` 이면 **본문만** 입력 상자가 되고 `lineAction`(「제거」)이 우측 끝에 붙는다.
 *   **라벨은 그대로 라벨이다 — 종류 셀렉터가 없다**(WORK-013 · MF-60 — 종류가 틀린 줄은 지우고 새로 적는다).
 *   전부 **prop** 이라 회의 중 화면(`editable` 미지정)의 렌더는 WORK-007 그대로다
 * - 실패 표시(`contentSaveFailed`)도 prop 이다 — 여기 `useState` 로 들지 않는다(정적 검사 ⑧)
 *
 * **회의 중 사람 줄은 읽기 전용이다** — 클릭 핸들러·삭제·편집 어포던스가 없다(U-2). hover 배경 `#FAFBFC` 만.
 * `kind='task'` 줄이 업무를 가리키면(`task` 요약 — AI 줄) 라벨 옆에 그 업무의 **유형 배지**(공용 `TypeBadge` · `task.workType`)를 단다(U-4 · [09] L671).
 * 회의 중 사람 업무 줄은 `task=null` 이라 라벨만이다(DEC-003 §1 표). 「업무 갱신」 버튼은 Phase 5 가 같은 자리(`actions`)에 붙인다.
 */

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { TypeBadge } from "@/components/shared/TypeBadge";
import { EvidenceChip } from "@/features/meetings/components/EvidenceChip";
import { InlineFieldInput } from "@/features/meetings/components/InlineFieldInput";
import type { TreeDensity } from "@/features/meetings/components/AgendaLineTree";
import { isLineKind, LINE_KIND_LABEL, LINE_LABEL_CLASS } from "@/features/meetings/lineKinds";
import type { LineKind, MeetingLine } from "@/features/meetings/types";
import { cn } from "@/lib/utils";

/** 표시 매핑(G-4)의 정본은 `lineKinds.ts` — 기존 호출자(`PromptBar` · `LineKindPopover`)를 위해 다시 내보낸다. */
export { LINE_KIND_LABEL, LINE_LABEL_CLASS } from "@/features/meetings/lineKinds";

export const LINE_CONTENT_EMPTY_MESSAGE = "내용을 비울 수 없습니다";

export function LineRow({
  line,
  recordingStartedAt,
  expandable,
  density = "default",
  onChipClick,
  actions,
  editable = false,
  onSaveContent,
  contentSaveFailed = false,
  attemptedContent,
  lineAction,
  chipCaption,
}: {
  line: MeetingLine;
  recordingStartedAt: string | null;
  /** 펼침 화살표 + 상세 + 근거 칩. 회의 중 회의록 탭은 `false`. */
  expandable: boolean;
  /** 미리보기 패널은 `compact` — **글자 · 여백 · 라벨 폭만** 줄인다(FE §2 규칙 7). */
  density?: TreeDensity;
  onChipClick?: (fromMs: number, toMs: number) => boolean;
  /** 줄 버튼 슬롯(Phase 5). */
  actions?: ReactNode;
  /** 편집 모드(SPEC-008 U-7) — 종류 셀렉터 + 본문 입력. */
  editable?: boolean;
  onSaveContent?: (next: string) => Promise<void>;
  contentSaveFailed?: boolean;
  /** 실패한 본문에 사용자가 넣으려던 값(U-7 「값 유지」). 없으면 `line.content`. */
  attemptedContent?: string;
  /** 우측 끝 고스트 버튼 슬롯(「제거」). */
  lineAction?: ReactNode;
  /** 칩이 **표시만**일 때(드로어 U-4) 펼친 영역에 붙는 캡션. `onChipClick` 이 있으면 무시된다. */
  chipCaption?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const kind: LineKind = isLineKind(line.kind) ? line.kind : "discussion";
  const emphasized = kind !== "discussion";
  const editing = editable && onSaveContent !== undefined;
  const compact = density === "compact";

  return (
    <div className="flex flex-col">
      <div
        data-line-kind={kind}
        data-line-id={line.id}
        className={cn(
          "group flex rounded-control",
          compact ? "gap-2 px-1.5 py-1" : "gap-3 px-2 py-1.5",
          kind === "decision" && !editing ? "bg-row-selected" : "hover:bg-row-hover",
          editing && "items-center",
        )}
      >
        {/* **라벨은 편집 모드에서도 라벨이다** — 종류를 바꾸는 표면이 없다(MF-60) */}
        <span className={cn("shrink-0 pt-0.5", compact ? "w-[26px] text-badge" : "w-[34px] text-row-label", LINE_LABEL_CLASS[kind])}>
          {isLineKind(line.kind) ? LINE_KIND_LABEL[line.kind] : line.kind}
        </span>
        {kind === "task" && line.task ? (
          <TypeBadge name={line.task.workType.name} colorToken={line.task.workType.colorToken} />
        ) : null}
        {editing ? (
          <InlineFieldInput
            ariaLabel="줄 내용"
            value={attemptedContent ?? line.content}
            onSave={onSaveContent}
            emptyMessage={LINE_CONTENT_EMPTY_MESSAGE}
            saveFailed={contentSaveFailed}
            className="min-w-0 flex-1"
            inputClassName={cn("h-9 px-3 text-body", emphasized && "font-semibold")}
          />
        ) : (
          <span className={cn("min-w-0 flex-1 text-foreground", compact ? "text-meta" : "text-body", emphasized && "font-semibold")}>
            {line.content}
          </span>
        )}
        {actions}
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
        {lineAction}
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
                ) : chipCaption ? (
                  <span className="text-caption text-fg-caption">{chipCaption}</span>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
