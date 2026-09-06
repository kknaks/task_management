"use client";

/**
 * **안건 > 줄 트리 — 트랙 무관 한 벌**(SPEC-007 U-2 · U-4 · SPEC-008 U-3 · U-7 · WP §Internal Interface Contract).
 *
 * 회의록 탭(사람 트랙) · AI 요약 탭(AI 트랙) · **통합본 탭(WORK-008)** 이 **이 컴포넌트 하나**를 쓴다.
 * **컴포넌트 안에 `track` 비교가 없다** — 차이는 전부 prop 이다. 두 번째 트리 컴포넌트를 만들지 않는다.
 *
 * | prop | 회의록 탭(회의 중) | AI 탭 | 통합본(종료 후) |
 * |---|---|---|---|
 * | `expandable` | `false` | `true`(상세 + 근거 칩) | **함수** — `detail`·`evidence` 있는 줄만(U-5) |
 * | `onToggleDone` | 완료 체크 → `PATCH state` | 없음(표시만) | 없음 — 종료 후 안건 상태 변경은 없다 |
 * | `onChipClick` | — | 스크립트 탭 전환 + `scrollToRange` | 같은 규칙 · 드로어는 표시만(`chipCaption`) |
 * | `badgeFor` | `state` → 「논의 중」/「완료」/「대기」 | 미러 안건은 원본 `state`, 신설은 「AI 안건」 캡션 | 「다음 논의로」 |
 * | `renderLineActions` | — | — | 줄 버튼 슬롯(Phase 5) |
 * | `editable` 계열 | — | — | 편집 모드(U-7) — 셀렉터 · 입력 · 「제거」 · 안건 제목 · 「+」 칩 |
 *
 * 규격은 [09] L660~680 한 벌 — 안건 gap 20 · 줄 `margin-left 37 · border-left 2px`(활성 `#C9D1FB` · 그 외 `#EBEBEB`) ·
 * 라벨 폭 34. 줄 없는 안건은 「아직 기록 없음」(13 `#C9CBD1`).
 *
 * **편집 prop 의 기본값은 전부 없음** — 회의 중 화면은 미지정으로 부르므로 WORK-007 렌더가 바뀌지 않는다(회귀 검사 대상).
 */

import type { ReactNode } from "react";

import { AgendaHeader, type AgendaBadge } from "@/features/meetings/components/AgendaHeader";
import { AgendaTitleInline } from "@/features/meetings/components/AgendaTitleInline";
import { LineRow } from "@/features/meetings/components/LineRow";
import type { LineKind, MeetingAgenda, MeetingLine } from "@/features/meetings/types";
import { formatClock } from "@/lib/datetime";
import { cn } from "@/lib/utils";

export type { AgendaBadge } from "@/features/meetings/components/AgendaHeader";

/** 편집 모드에서 실패 표시를 묻는 필드 — 줄 본문 · 줄 종류. 안건 제목은 `agendaSaveFailed`. */
export type LineEditField = "content" | "kind";

export interface AgendaLineTreeProps {
  agendas: readonly MeetingAgenda[];
  /** 활성 안건 — 줄 기준선이 `#C9D1FB` 다. 없으면 전부 `#EBEBEB`. */
  activeAgendaId?: number | null;
  /**
   * 줄 펼침(상세 + 근거 칩). 회의록 탭 `false` · AI 탭 `true` ·
   * 통합본은 **줄마다 판정**(`detail`·`evidence` 있는 줄만 — SPEC-008 U-5).
   */
  expandable: boolean | ((line: MeetingLine) => boolean);
  /** 안건 헤더 체크 — 있으면 클릭 가능. done ↔ next 판정은 호출자가 한다. */
  onToggleDone?: (agenda: MeetingAgenda) => void;
  /** 근거 칩 클릭. 대상 블록이 있었는지 돌려준다(U-6). 없으면 칩은 표시만이다. */
  onChipClick?: (fromMs: number, toMs: number) => boolean;
  /** 칩이 표시만일 때 펼친 영역 캡션(드로어 U-4 「스크립트는 전체 페이지에서 볼 수 있습니다」). */
  chipCaption?: string;
  /** 배지·캡션 문구 — 화면이 정한다(회의 중 「대기」 / 종료 후 「다음 논의로」 / 「AI 안건」). */
  badgeFor: (agenda: MeetingAgenda) => AgendaBadge;
  /** 근거 칩 벽시계의 기준점(M-11). 없으면 칩 대신 「근거 없음」. */
  recordingStartedAt: string | null;
  /** 줄 우측 버튼 슬롯(업무 생성 · 업무 갱신 — Phase 5). */
  renderLineActions?: (line: MeetingLine, agenda: MeetingAgenda) => ReactNode;
  /** 안건이 하나도 없을 때. 문구는 화면마다 다르다(U-2 「`/` 로 첫 안건을…」 · U-4 「기록이 쌓이면…」). */
  empty: ReactNode;
  className?: string;

  // --- 편집 모드(SPEC-008 U-7) — 전부 선택. 없으면 읽기 전용 렌더 그대로다 --------------------
  /** 줄 본문 입력 · 종류 셀렉터 · 안건 제목 입력을 켠다. */
  editable?: boolean;
  /** 줄 본문 저장(포커스 해제). 거절은 throw — 소유자가 `lineSaveFailed` 로 표시한다. */
  onSaveLineContent?: (line: MeetingLine, next: string) => Promise<void>;
  /** 종류 전환(고르면 즉시 저장). */
  onChangeKind?: (line: MeetingLine, kind: LineKind) => void;
  /** 안건 이름 저장(포커스 해제). */
  onRenameAgenda?: (agenda: MeetingAgenda, title: string) => Promise<void>;
  /** 줄 우측 끝 고스트 버튼(「제거」). 편집 대상 트랙의 줄 전부에 붙는다. */
  renderLineAction?: (line: MeetingLine, agenda: MeetingAgenda) => ReactNode;
  /** 안건 줄 목록 아래 슬롯(「+ 논의」 「+ 결정」 「+ 연관 업무」 「+ 액션 아이템」 칩 4). */
  renderAgendaFooter?: (agenda: MeetingAgenda) => ReactNode;
  /** U-7 실패 표시 — 소유자가 든다(`useRowFailures`). */
  lineSaveFailed?: (line: MeetingLine, field: LineEditField) => boolean;
  agendaSaveFailed?: (agenda: MeetingAgenda) => boolean;
  /** U-7 「값 유지」 — 실패한 필드에 사용자가 넣으려던 값. 없으면 서버 값이다. */
  lineAttempted?: (line: MeetingLine, field: LineEditField) => string | undefined;
  agendaAttempted?: (agenda: MeetingAgenda) => string | undefined;
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
  chipCaption,
  badgeFor,
  recordingStartedAt,
  renderLineActions,
  empty,
  className,
  editable = false,
  onSaveLineContent,
  onChangeKind,
  onRenameAgenda,
  renderLineAction,
  renderAgendaFooter,
  lineSaveFailed,
  agendaSaveFailed,
  lineAttempted,
  agendaAttempted,
}: AgendaLineTreeProps) {
  if (agendas.length === 0) {
    return <>{empty}</>;
  }

  const canExpand = (line: MeetingLine) => (typeof expandable === "function" ? expandable(line) : expandable);

  return (
    <ol className={cn("flex flex-col gap-5", className)} data-editing={editable || undefined}>
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
              titleControl={
                editable && onRenameAgenda ? (
                  <AgendaTitleInline
                    number={agenda.orderIndex + 1}
                    title={agendaAttempted?.(agenda) ?? agenda.title}
                    onSave={(next) => onRenameAgenda(agenda, next)}
                    saveFailed={agendaSaveFailed?.(agenda) ?? false}
                  />
                ) : undefined
              }
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
                    expandable={canExpand(line)}
                    onChipClick={onChipClick}
                    chipCaption={chipCaption}
                    actions={renderLineActions?.(line, agenda)}
                    editable={editable}
                    onSaveContent={editable && onSaveLineContent ? (next) => onSaveLineContent(line, next) : undefined}
                    onChangeKind={editable && onChangeKind ? (kind) => onChangeKind(line, kind) : undefined}
                    contentSaveFailed={lineSaveFailed?.(line, "content") ?? false}
                    kindSaveFailed={lineSaveFailed?.(line, "kind") ?? false}
                    attemptedContent={lineAttempted?.(line, "content")}
                    lineAction={editable ? renderLineAction?.(line, agenda) : undefined}
                  />
                ))}
              </div>
            )}
            {editable ? renderAgendaFooter?.(agenda) : null}
          </li>
        );
      })}
    </ol>
  );
}
