"use client";

/**
 * **사람 트랙 안건 목록**(SPEC-006 U-4 「안건 있음」 · U-8 `scheduled` 본문 · [09] 트리 헤더 규격 · 회의록.dc.html L184~188).
 *
 * 행마다 「안건 n」 11/700 `#9EA2AE` + 제목 15/700. **줄은 없다** — 시작 전에는 안건만(BASE-003 #2).
 * 제목 클릭 → **인라인 편집**(`InlineEditText` — 포커스 해제 시 저장 · `Esc` 되돌림), hover 우측 「제거」.
 * 순서는 등록순이고 **드래그 정렬은 없다**.
 *
 * ## 부모를 모른다
 *
 * 시작 전 화면(편집) · 미리보기 패널(읽기 전용) · SPEC-008 U-4 드로어가 **같은 컴포넌트**를 쓴다.
 * 회의 상태·라우트를 import 하지 않고 **prop 으로만** 갈린다 — `readOnly` 면 콜백이 없다.
 *
 * ## 실패 상태는 prop 이다(SPEC-002 U-7 구현 규약 · WORK-003 그대로)
 *
 * `hasFailed(id)` 로 그 행의 테두리만 실패색이 되고, 캡션·「다시 저장」은 **블록 아래 인라인 자리
 * 하나**(`notice`)가 그린다. 소유자는 `useAgendaAutoSave` 를 부른 화면이다 — 여기 `useState` 로
 * 실패를 들지 않는다(Phase 6 정적 검사).
 *
 * ## `state` 배지 문구(DEC-003 §1 표 2026-09-06)
 *
 * 시작 전 안건은 `state=null` 이라 배지가 없다. 값이 있으면(종료 후 · 미리보기) 그린다 —
 * **`next` 는 「다음 논의로」**(종료 후·목록의 어휘). 회의 중 화면의 「대기」는 WORK-007 이 자기
 * 화면에서 정한다 — 이 목록은 목록·미리보기·시작 전·종료 후의 것이다.
 */

import { X } from "lucide-react";

import { InlineEditText } from "@/components/shared/InlineEditText";
import type { AgendaState, MeetingAgenda } from "@/features/meetings/types";
import { cn } from "@/lib/utils";

/** 종료 후·목록 어휘. 회의 중 「대기」는 WORK-007 화면의 것이다. */
export const AGENDA_STATE_LABEL: Record<AgendaState, string> = {
  active: "논의 중",
  done: "완료",
  next: "다음 논의로",
};

export function MeetingAgendaList({
  agendas,
  readOnly = false,
  onRename,
  onRemove,
  hasFailed,
  notice,
  empty,
  className,
}: {
  agendas: readonly MeetingAgenda[];
  /** 미리보기 패널·SPEC-008 드로어 — 편집·제거가 없다. */
  readOnly?: boolean;
  /** 인라인 편집 저장. 실패 판정은 소유자가 한다 — 여기서 삼키지 않는다. */
  onRename?: (agendaId: number, title: string) => Promise<void>;
  /** 「제거」 — 확인 모달 없음(다시 적으면 된다 — U-4). */
  onRemove?: (agendaId: number) => void;
  /** U-7 실패 표시 — 그 행 테두리만. */
  hasFailed?: (agendaId: number) => boolean;
  /** 캡션·「다시 저장」의 **블록당 하나뿐인 자리**. */
  notice?: React.ReactNode;
  /** 안건이 없을 때 그릴 것 — 화면마다 문구·크기가 다르다(U-4 큰 빈 상태 / U-8 한 줄). */
  empty: React.ReactNode;
  className?: string;
}) {
  if (agendas.length === 0) {
    return <>{empty}</>;
  }

  return (
    <section className={cn("flex flex-col", className)}>
      <ol className="flex flex-col gap-1.5">
        {agendas.map((agenda, index) => {
          const failed = hasFailed?.(agenda.id) ?? false;
          return (
            <li
              key={agenda.id}
              data-save-failed={failed || undefined}
              className={cn(
                "group flex min-h-10 items-center gap-[11px] rounded-control px-2",
                failed && "ring-1 ring-destructive",
              )}
            >
              <span className="w-10 shrink-0 text-row-label text-fg-caption">
                안건 {index + 1}
              </span>
              {readOnly || !onRename ? (
                <span className="min-w-0 flex-1 truncate text-section text-foreground">
                  {agenda.title}
                </span>
              ) : (
                <InlineEditText
                  ariaLabel={`안건 ${index + 1} 제목`}
                  value={agenda.title}
                  saveFailed={failed}
                  onSave={(next) => onRename(agenda.id, next)}
                  className="min-w-0 flex-1 [&_input]:h-9 [&_input]:text-section [&_input]:font-bold"
                />
              )}
              {agenda.state ? (
                <span className="inline-flex h-5 shrink-0 items-center rounded-chip bg-agenda-badge px-[7px] text-badge text-fg-meta">
                  {AGENDA_STATE_LABEL[agenda.state]}
                </span>
              ) : null}
              {!readOnly && onRemove ? (
                <button
                  type="button"
                  aria-label={`안건 ${index + 1} 제거`}
                  onClick={() => onRemove(agenda.id)}
                  className="flex h-7 shrink-0 items-center gap-1 rounded-control px-2 text-caption text-fg-caption opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                  제거
                </button>
              ) : null}
            </li>
          );
        })}
      </ol>
      {notice}
    </section>
  );
}

/**
 * **U-4 「안건 없음」 빈 상태**(회의록.dc.html L601~608) — 아이콘 타일 56 `#F4F5F7` + 17/700 + 14 캡션.
 * 시안의 「안건 초안을 만들어 줍니다」 문구와 추천 칩 3개는 **그리지 않는다**(SPEC-006 §7 — AI 안건 생성).
 */
export function AgendaEmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[22px] px-8 py-10 text-center">
      <span
        aria-hidden
        className="flex h-14 w-14 items-center justify-center rounded-panel bg-chip-bg text-dot-idle"
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 6h14M5 12h9M5 18h5" />
        </svg>
      </span>
      <div className="flex flex-col items-center gap-2">
        <p className="text-subhead text-foreground">아직 안건이 없습니다</p>
        <p className="text-control-label text-fg-meta">
          아래에 안건을 적어 두면 회의 중 화면이 안건별로 열립니다.
          <br />
          회의 중에도 추가할 수 있습니다.
        </p>
      </div>
    </div>
  );
}
