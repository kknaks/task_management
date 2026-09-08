"use client";

/**
 * **프로젝트 필터 칩 행 52**(SPEC-006 U-2 · 회의록.dc.html L77~82).
 *
 * 「전체 n」 + 「미정 n」(무소속) + 프로젝트별 「<이름> n」. h28 r6 12px. **단일 선택**, 기본 「전체」.
 * 선택 칩 `#F1F2FE` + 1px `#7181F8` + `#4B52A8`/600, 나머지 1px `#E1E3E8` + `#5F6470`, hover `#F5F6F8`.
 * 넘치면 **가로 스크롤**(스크롤바 숨김).
 *
 * 숫자는 `projectCounts` — **그 달의 건수이고 필터 자신을 반영하지 않는다**(칩이 흔들리지 않게).
 * 삭제된 프로젝트의 회의도 그 이름·색으로 남는다(DEC-001 §4). **생성 진입점은 여기 없다** — U-3 셀렉터 안이다.
 */

import type { MeetingProjectCount, MeetingProjectFilter } from "@/features/meetings/types";
import { cn } from "@/lib/utils";

const CHIP =
  "inline-flex h-7 shrink-0 items-center rounded-md border px-2.5 text-caption transition-colors";

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        CHIP,
        selected
          ? "border-primary bg-secondary font-semibold text-secondary-foreground"
          : "border-chip-border text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function MeetingProjectChips({
  counts,
  value,
  onChange,
}: {
  counts: readonly MeetingProjectCount[];
  value: MeetingProjectFilter;
  onChange: (next: MeetingProjectFilter) => void;
}) {
  const total = counts.reduce((sum, row) => sum + row.count, 0);
  const unassigned = counts.find((row) => row.projectId === null)?.count ?? 0;
  const projects = counts.filter(
    (row): row is MeetingProjectCount & { projectId: number } => row.projectId !== null,
  );

  return (
    <div
      role="group"
      aria-label="프로젝트 필터"
      className="flex h-[52px] shrink-0 items-center gap-1.5 overflow-x-auto border-b border-row-divider px-[18px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <Chip selected={value === null} onClick={() => onChange(null)}>
        전체 {total}
      </Chip>
      <Chip selected={value === "none"} onClick={() => onChange("none")}>
        미정 {unassigned}
      </Chip>
      {projects.map((row) => (
        <Chip
          key={row.projectId}
          selected={value === row.projectId}
          onClick={() => onChange(row.projectId)}
        >
          {row.name} {row.count}
        </Chip>
      ))}
    </div>
  );
}
