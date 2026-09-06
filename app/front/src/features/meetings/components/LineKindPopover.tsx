"use client";

/**
 * **`/` 종류 팝오버의 목록**(SPEC-007 U-3 · 시안 L920~952 · [09] L668~672).
 *
 * 머리 「안건 n 아래에 추가」 + 제목 캡션 → 항목 **4종**(논의 · 결정 · **업무** · 액션 — 시안 L925~936 이 3종만 그린 것은
 * 누락, DEC-003 §1 표) → 「새 안건」 + 「다음 주제로」 → 「다른 안건으로 이동」 + 활성 아닌 안건 행.
 * 활성 안건이 없으면 **「새 안건」만**(줄은 항상 안건에 속한다 — M-5). `section='move'` 면 이동 절만(칩 클릭).
 *
 * 키보드(`↑↓` · `Enter` · `Esc`)는 **입력에 포커스를 둔 채** `PromptBar` 가 처리한다 — 여기는 `highlighted` 로 그리기만 한다.
 * 목록 계산(`buildPopoverItems`)을 내보내 두 곳이 같은 순서를 본다. WORK-008 편집 모드가 같은 팝오버를 쓴다.
 */

import { LINE_KIND_LABEL } from "@/features/meetings/components/LineRow";
import type { LineKind, MeetingAgenda } from "@/features/meetings/types";
import { cn } from "@/lib/utils";

export type PopoverSection = "full" | "move";

export type PopoverItem =
  | { id: string; kind: "line-kind"; lineKind: LineKind }
  | { id: string; kind: "new-agenda" }
  | { id: string; kind: "move"; agenda: MeetingAgenda };

export const LINE_KINDS: readonly LineKind[] = ["discussion", "decision", "task", "action"];

/** 칩 한 글자 + 색([09] L668~672 · 시안 L926~935). */
const KIND_CHIP: Record<LineKind, { glyph: string; className: string }> = {
  discussion: { glyph: "논", className: "bg-agenda-badge text-fg-meta" },
  decision: { glyph: "결", className: "bg-decision-chip text-line-decision" },
  task: { glyph: "업", className: "bg-agenda-badge text-muted-foreground" },
  action: { glyph: "액", className: "bg-secondary text-secondary-foreground" },
};

export function buildPopoverItems(
  section: PopoverSection,
  activeAgenda: MeetingAgenda | null,
  otherAgendas: readonly MeetingAgenda[],
): PopoverItem[] {
  const items: PopoverItem[] = [];
  if (section === "full") {
    if (activeAgenda) {
      for (const lineKind of LINE_KINDS) {
        items.push({ id: `kind-${lineKind}`, kind: "line-kind", lineKind });
      }
    }
    items.push({ id: "new-agenda", kind: "new-agenda" });
  }
  for (const agenda of otherAgendas) {
    items.push({ id: `move-${agenda.id}`, kind: "move", agenda });
  }
  return items;
}

export function optionId(listboxId: string, item: PopoverItem): string {
  return `${listboxId}-${item.id}`;
}

const ROW = "flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-left hover:bg-muted";
const CHIP = "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md text-row-label";

export function LineKindPopover({
  listboxId,
  section,
  activeAgenda,
  items,
  highlighted,
  onPick,
  onHover,
}: {
  listboxId: string;
  section: PopoverSection;
  activeAgenda: MeetingAgenda | null;
  items: readonly PopoverItem[];
  highlighted: number;
  onPick: (item: PopoverItem) => void;
  onHover: (index: number) => void;
}) {
  const moveStart = items.findIndex((item) => item.kind === "move");
  const hasMove = moveStart >= 0;

  return (
    <div id={listboxId} role="listbox" aria-label="종류 선택" className="flex w-[300px] flex-col gap-0.5 p-1.5">
      {section === "full" ? (
        <div className="flex flex-col gap-0.5 px-2.5 pb-1.5 pt-[7px]">
          <span className="text-row-label tracking-[0.04em] text-fg-caption">
            {activeAgenda ? `안건 ${activeAgenda.orderIndex + 1} 아래에 추가` : "안건이 없습니다"}
          </span>
          <span className="truncate text-caption text-muted-foreground">
            {activeAgenda ? activeAgenda.title : "새 안건을 만들어 기록을 시작합니다"}
          </span>
        </div>
      ) : null}

      {items.map((item, index) => {
        const selected = index === highlighted;
        const common = {
          id: optionId(listboxId, item),
          role: "option" as const,
          "aria-selected": selected,
          onMouseEnter: () => onHover(index),
          onClick: () => onPick(item),
        };

        if (item.kind === "line-kind") {
          const chip = KIND_CHIP[item.lineKind];
          return (
            <button key={item.id} type="button" {...common} className={cn(ROW, selected && "bg-agenda-badge")}>
              <span aria-hidden className={cn(CHIP, chip.className)}>
                {chip.glyph}
              </span>
              <span className={cn("flex-1 text-meta text-foreground", selected && "font-semibold")}>
                {LINE_KIND_LABEL[item.lineKind]}
              </span>
            </button>
          );
        }

        if (item.kind === "new-agenda") {
          return (
            <div key={item.id} className="flex flex-col gap-0.5">
              {activeAgenda ? <div aria-hidden className="mx-1.5 my-1 h-px bg-divider" /> : null}
              <button type="button" {...common} className={cn(ROW, selected && "bg-agenda-badge")}>
                <span aria-hidden className={cn(CHIP, "bg-ai-bar text-ai-bar-badge")}>
                  안
                </span>
                <span className={cn("flex-1 text-meta text-foreground", selected && "font-semibold")}>새 안건</span>
                <span className="text-row-label font-normal text-fg-caption">다음 주제로</span>
              </button>
            </div>
          );
        }

        return (
          <div key={item.id} className="flex flex-col gap-0.5">
            {hasMove && index === moveStart ? (
              <>
                {section === "full" ? <div aria-hidden className="mx-1.5 my-1 h-px bg-divider" /> : null}
                <div className="px-2.5 pb-1.5 pt-0.5 text-row-label tracking-[0.04em] text-fg-caption">다른 안건으로 이동</div>
              </>
            ) : null}
            <button type="button" {...common} className={cn(ROW, "h-8", selected && "bg-agenda-badge")}>
              <span className="w-[34px] shrink-0 text-row-label text-fg-caption">안건 {item.agenda.orderIndex + 1}</span>
              <span className="min-w-0 flex-1 truncate text-meta text-muted-foreground">{item.agenda.title}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
