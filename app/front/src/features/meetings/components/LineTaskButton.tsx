"use client";

/**
 * **줄 버튼 — 액션 줄 「업무 생성」 · 업무 줄 「업무 갱신」**(SPEC-008 U-6 · [09] L668~677 · 시안 L1484~1486 · L1508~1510).
 *
 * 줄을 적는 것만으로는 업무가 생기지 않는다 — **이 버튼을 눌러야 요청이 나간다.** 보기 · 편집 모드 같은 자리(`LineRow.actions`),
 * **회의록 탭에만**(AI 탭 · 회의 중 화면 · 드로어 U-4 에는 없다 — 호출자가 슬롯을 안 준다).
 *
 * | 줄 | 버튼 |
 * |---|---|
 * | 액션(`taskId` 없음) | 「**업무 생성**」 30 r8 테두리 12/600 → **U-10 드로어**(`payload` 가 있으면 그 값이 채워진 채로) |
 * | 업무 · 넣기 전 | 「**업무 갱신**」 30 r8 배경 · 테두리 12/600 → **U-9 드로어**(헤더 셀렉터에 그 업무 · 없으면 빈 셀렉터) |
 * | 업무 · 넣기 뒤(`taskId` 있고 `payload` 없음) | 「**갱신 완료**」 비활성 |
 * | 업무 · `task.isDeleted` | 「삭제된 업무」 캡션 + 「업무 갱신」 그대로 — 헤더 셀렉터에서 다른 업무로 바꿀 수 있다(U-6) |
 * | `locked`(`generating`) | 전부 비활성(U-1) |
 *
 * **`payload` 가 있으면 버튼 옆에 6px dot**(「채워진 값이 있다」 — 디자인 시스템 [09] 탭 dot 재사용)과 **툴팁**(그 내용)이 붙는다.
 * **누르는 것은 언제나 드로어를 여는 것**이다 — 이 버튼에서 바로 요청이 나가지 않는다(MF-66 — 요청은 드로어 푸터가 낸다).
 * **판정이 없다** — 어떤 상태로 갈 수 있는지 · 결과자료가 있는지 여기서 보지 않는다.
 */

import { Loader2 } from "lucide-react";

import { payloadSummary } from "@/features/meetings/linePayload";
import type { MeetingLine } from "@/features/meetings/types";
import { cn } from "@/lib/utils";

export const CREATE_TASK_LABEL = "업무 생성";
export const APPLY_TASK_LABEL = "업무 갱신";
export const APPLIED_LABEL = "갱신 완료";
export const DELETED_TASK_LABEL = "삭제된 업무";

const BASE = "flex h-[30px] shrink-0 items-center gap-1.5 rounded-control px-3 text-caption font-semibold disabled:cursor-not-allowed";

/** 「채워진 값이 있다」 — 6px dot `#7181F8`(U-6). `payload` 유무 하나만 본다. */
function PayloadDot() {
  return <span data-payload-dot aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />;
}

export function LineTaskButton({
  line,
  locked = false,
  busy = false,
  onOpenAction,
  onOpenTask,
}: {
  line: MeetingLine;
  /** `generating` — 전부 비활성(U-1). */
  locked?: boolean;
  /** 이 줄의 「넣기」 요청이 나가 있다 — 비활성 + 진행 표시. */
  busy?: boolean;
  /** 액션 줄 → U-10 드로어. */
  onOpenAction: (line: MeetingLine) => void;
  /** 업무 줄 → U-9 드로어. */
  onOpenTask: (line: MeetingLine) => void;
}) {
  const summary = payloadSummary(line);
  const tooltip = summary.length > 0 ? summary.join(" · ") : undefined;

  if (line.kind === "action" && line.taskId === null) {
    return (
      <button
        type="button"
        onClick={() => onOpenAction(line)}
        disabled={locked || busy}
        aria-busy={busy || undefined}
        title={tooltip}
        className={cn(BASE, "border border-border bg-card text-foreground hover:bg-muted disabled:opacity-50")}
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
        {CREATE_TASK_LABEL}
        {line.payload ? <PayloadDot /> : null}
      </button>
    );
  }
  if (line.kind !== "task") {
    return null;
  }
  // **넣기 뒤** — `taskId` 가 있고 `payload` 가 비었다. 삭제된 업무는 여기 오지 않는다(아래 「업무 갱신」으로 다시 고를 수 있다)
  if (line.taskId !== null && !line.payload && !line.task?.isDeleted) {
    return (
      <button type="button" disabled className={cn(BASE, "border border-chip-border bg-muted text-fg-caption")}>
        {APPLIED_LABEL}
      </button>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {line.task?.isDeleted ? <span className="shrink-0 text-caption text-fg-caption">{DELETED_TASK_LABEL}</span> : null}
      <button
        type="button"
        onClick={() => onOpenTask(line)}
        disabled={locked || busy}
        aria-busy={busy || undefined}
        title={tooltip}
        className={cn(BASE, "border border-chip-border bg-muted text-fg-meta hover:text-foreground disabled:opacity-50")}
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
        {APPLY_TASK_LABEL}
        {line.payload ? <PayloadDot /> : null}
      </button>
    </span>
  );
}
