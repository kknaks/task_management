"use client";

/**
 * **줄 버튼 — 액션 줄 「업무 생성」 · 업무 줄 「업무 갱신」**(SPEC-008 U-6 · [09] L668~677 · 시안 L1484~1486 · L1508~1510).
 *
 * 줄을 적는 것만으로는 업무가 생기지 않는다 — **이 버튼을 눌러야 요청이 나간다.** 보기 · 편집 모드 같은 자리(`LineRow.actions`),
 * **회의록 탭에만**(AI 탭 · 회의 중 화면 · 드로어 U-4 에는 없다 — 호출자가 슬롯을 안 준다).
 *
 * | 줄 | 버튼 |
 * |---|---|
 * | 액션(`taskId` 없음) | 「**업무 생성**」 30 r8 테두리 12/600 → U-10 드로어(제목 프리필) |
 * | 업무 · `payload` 있음 | 「**업무 갱신**」 30 r8 배경 · 테두리 12/600 → **즉시 요청**(확인 없음). 응답까지 비활성 + 진행. 툴팁 = 반영할 내용(같은 상태 제외) |
 * | 업무 · `payload` 없음 | 「**갱신 완료**」 비활성 — 방금 갱신했거나 처음부터 변경이 없는 줄 |
 * | 업무 · `task.isDeleted` | 「**삭제된 업무**」 12 `#9EA2AE` 비활성(DEC-001 §4 참조 표시의 결). 배지 · 제목은 `LineRow` 가 그대로 |
 * | `locked`(`generating`) | 전부 비활성(U-1) |
 *
 * 갱신 성공 시 토스트 없음 — 버튼이 「갱신 완료」로 바뀌는 것이 결과다(완료 전이가 실렸으면 훅이 완료 토스트를 띄운다).
 * **판정이 없다** — 어떤 상태로 갈 수 있는지 · 결과자료가 있는지 여기서 보지 않는다.
 */

import { Loader2 } from "lucide-react";

import { payloadSummary } from "@/features/meetings/hooks/useMeetingTaskLink";
import type { MeetingLine } from "@/features/meetings/types";
import { cn } from "@/lib/utils";

export const CREATE_TASK_LABEL = "업무 생성";
export const APPLY_TASK_LABEL = "업무 갱신";
export const APPLIED_LABEL = "갱신 완료";
export const DELETED_TASK_LABEL = "삭제된 업무";

const BASE = "flex h-[30px] shrink-0 items-center gap-1.5 rounded-control px-3 text-caption font-semibold disabled:cursor-not-allowed";

export function LineTaskButton({
  line,
  locked = false,
  busy = false,
  onCreate,
  onApply,
}: {
  line: MeetingLine;
  /** `generating` — 전부 비활성(U-1). */
  locked?: boolean;
  /** 이 줄의 갱신 요청이 나가 있다 — 비활성 + 진행 표시. */
  busy?: boolean;
  onCreate: (line: MeetingLine) => void;
  onApply: (line: MeetingLine) => void;
}) {
  if (line.kind === "action" && line.taskId === null) {
    return (
      <button
        type="button"
        onClick={() => onCreate(line)}
        disabled={locked}
        className={cn(BASE, "border border-border bg-card text-foreground hover:bg-muted disabled:opacity-50")}
      >
        {CREATE_TASK_LABEL}
      </button>
    );
  }
  if (line.kind !== "task" || line.taskId === null) {
    return null;
  }
  if (line.task?.isDeleted) {
    return (
      <button type="button" disabled className={cn(BASE, "text-fg-caption")}>
        {DELETED_TASK_LABEL}
      </button>
    );
  }
  const summary = payloadSummary(line);
  if (!line.payload) {
    return (
      <button type="button" disabled className={cn(BASE, "border border-chip-border bg-muted text-fg-caption")}>
        {APPLIED_LABEL}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onApply(line)}
      disabled={locked || busy}
      aria-busy={busy || undefined}
      title={summary.length > 0 ? summary.join(" · ") : undefined}
      className={cn(BASE, "border border-chip-border bg-muted text-fg-meta hover:text-foreground disabled:opacity-50")}
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
      {APPLY_TASK_LABEL}
    </button>
  );
}
