"use client";

/**
 * **업무 상세 헤더 — 드로어와 확장 페이지가 같은 조각을 쓴다**(REDRAW-03 §2-1·§3-1).
 *
 * 시안 `업무 화면 정의서.dc.html` 1888~1912(드로어) · 1536~1571(확장).
 *
 * ## 전에 무엇이 틀렸나
 *
 * 「업무 상세」 텍스트 + 셀렉터 박스 2개 + 「상태 변경」 버튼 + 전체폭 일정 입력 2칸이었다.
 * 시안은 **유형 배지 · 프로젝트 칩 · 상태 칩 · 일정 칩** 넷이고, **칩 자신이 팝오버를 연다.**
 * 셀렉터 박스는 **생성 드로어 규격**이지 상세 규격이 아니다.
 *
 * ## 두 표면의 차이는 크기뿐이다
 *
 * | | 드로어 | 확장 |
 * |---|---|---|
 * | 배지·칩 | h22 · `padding 0 8` | h24 · `padding 0 9` |
 * | 제목 | 26 / 700 / -0.03em | **32** / 700 / -0.03em |
 * | 컨트롤 | h34 · 아이콘 30×30 | h36 · 아이콘 36×36 |
 * | 배치 | 배지 줄 / 제목 / 컨트롤 줄 (세로) | 좌(배지+제목) ↔ 우(컨트롤) `justify-between` |
 *
 * ## 색 규칙이 유형과 프로젝트에서 다르다
 *
 * **유형은 배경까지 유형 색**(`data-color-token` 팔레트), **프로젝트는 회색 배경 + 색 dot** 이다.
 * 프로젝트 색을 배경에 칠하지 않는다(시안 1891줄).
 */

import { useState } from "react";
import { Check, MoreVertical, Pencil, Trash2 } from "lucide-react";

import { CalendarGrid, Shortcut } from "@/components/shared/Calendar";
import { InlineEditText } from "@/components/shared/InlineEditText";
import { Selector } from "@/components/shared/Selector";
import { StatusDot, STATUS_LABEL } from "@/components/shared/StatusDot";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusPopover } from "@/features/tasks/components/StatusPopover";
import { useProjectsQuery, useWorkTypesQuery } from "@/features/settings/hooks/useWorkSettings";
import {
  currentDate,
  formatSchedule,
  monthOf,
  weekOf,
  type DateKey,
  type Period,
} from "@/lib/datetime";
import { cn } from "@/lib/utils";
import type { TaskDetail, TaskStatus } from "@/features/tasks/types";

export type HeaderSize = "drawer" | "page";

/** 상태별 **텍스트 색** — 칩 안에서 dot 과 글자가 같은 상태색이다(시안 1904줄). */
const STATUS_TEXT: Record<TaskStatus, string> = {
  todo: "text-status-todo",
  in_progress: "text-status-progress",
  done: "text-status-done",
  cancelled: "text-status-cancelled",
};

const SIZE = {
  drawer: {
    badge: "h-[22px] px-2",
    control: "h-[34px]",
    icon: "h-[30px] w-[30px]",
    iconBorder: "border-divider",
    title: "text-detail-title",
  },
  page: {
    badge: "h-6 px-[9px]",
    control: "h-9",
    icon: "h-9 w-9",
    iconBorder: "border-border",
    title: "text-[32px] font-bold tracking-title leading-[1.25]",
  },
} as const;

/* ── 유형 배지 · 프로젝트 칩 ──────────────────────────────────────────── */

/** 유형 — **배경까지 유형 색**. 누르면 유형 목록이 열린다(H-3). */
export function TypeBadgeControl({
  task,
  size,
  onSelect,
  saveFailed,
  readOnly = false,
}: {
  task: TaskDetail;
  size: HeaderSize;
  onSelect: (id: number) => void;
  saveFailed?: boolean;
  readOnly?: boolean;
}) {
  const { data: workTypes = [] } = useWorkTypesQuery();
  const spec = SIZE[size];
  const badge = (
    <span
      data-color-token={task.workType.colorToken}
      className={cn(
        "inline-flex shrink-0 items-center rounded-chip bg-palette-bg text-caption font-semibold text-palette-fg",
        spec.badge,
        saveFailed && "ring-1 ring-destructive",
      )}
    >
      {task.workType.name}
    </span>
  );

  if (readOnly) {
    return badge;
  }
  return (
    <Selector
      label="유형"
      placeholder="유형"
      value={{
        id: task.workType.id,
        name: task.workType.name,
        colorToken: task.workType.colorToken,
      }}
      options={workTypes.map((item) => ({
        id: item.id,
        name: item.name,
        colorToken: item.colorToken,
      }))}
      onSelect={(option) => option && onSelect(option.id)}
      renderTrigger={() => (
        <button type="button" aria-label="유형 바꾸기" className="shrink-0">
          {badge}
        </button>
      )}
    />
  );
}

/**
 * 프로젝트 — **회색 배경 + 색 dot**. 없으면 **점선 「+ 프로젝트」**다.
 *
 * ⚠ 「프로젝트 없음」 케이스는 **시안에 없다**(프로젝트가 있는 업무만 그려져 있다).
 * 점선 칩은 코디+사용자가 정한 것이다 — 「프로젝트 없음」이라는 **글자를 쓰지 않는다**(H-3b).
 */
export function ProjectChipControl({
  task,
  size,
  onSelect,
  saveFailed,
  readOnly = false,
}: {
  task: TaskDetail;
  size: HeaderSize;
  onSelect: (id: number | null) => void;
  saveFailed?: boolean;
  readOnly?: boolean;
}) {
  const { data: projects = [] } = useProjectsQuery();
  const spec = SIZE[size];

  const chip = task.project ? (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-chip bg-chip-bg text-caption text-fg-muted",
        spec.badge,
        saveFailed && "ring-1 ring-destructive",
      )}
    >
      <span
        aria-hidden
        data-color-token={task.project.colorToken}
        className="h-[7px] w-[7px] shrink-0 rounded-[2px] bg-palette-fg"
      />
      {task.project.name}
    </span>
  ) : (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-chip border border-dashed border-border text-caption text-fg-caption",
        spec.badge,
      )}
    >
      + 프로젝트
    </span>
  );

  if (readOnly) {
    // 읽기 모드에서 프로젝트가 없으면 **아무것도 그리지 않는다** — 점선은 「누르면 고른다」는 뜻이다
    return task.project ? chip : null;
  }
  return (
    <Selector
      label="프로젝트"
      placeholder="프로젝트"
      clearable
      value={
        task.project
          ? { id: task.project.id, name: task.project.name, colorToken: task.project.colorToken }
          : null
      }
      options={projects.map((item) => ({
        id: item.id,
        name: item.name,
        colorToken: item.colorToken,
      }))}
      onSelect={(option) => onSelect(option?.id ?? null)}
      renderTrigger={() => (
        <button type="button" aria-label="프로젝트 바꾸기" className="shrink-0">
          {chip}
        </button>
      )}
    />
  );
}

/* ── 상태 칩 · 일정 칩 · 완료 처리 ────────────────────────────────────── */

const CHIP_CLASS =
  "flex shrink-0 items-center gap-2 rounded-control border border-border bg-card px-3 text-meta hover:bg-muted";

/** 상태 — **칩 자신이 목록을 연다**(H-4). 「상태 변경」 버튼을 따로 두지 않는다. */
export function StatusChipControl({
  task,
  size,
  onSelect,
}: {
  task: TaskDetail;
  size: HeaderSize;
  onSelect: (next: TaskStatus) => void;
}) {
  return (
    <StatusPopover
      current={task.status}
      onSelect={onSelect}
      trigger={
        <button
          type="button"
          aria-label="상태 바꾸기"
          className={cn(CHIP_CLASS, SIZE[size].control, size === "page" && "px-3.5")}
        >
          <StatusDot status={task.status} overdue={task.isOverdue} />
          <span className={cn("font-semibold", STATUS_TEXT[task.status])}>
            {STATUS_LABEL[task.status]}
          </span>
          <Chevron />
        </button>
      }
    />
  );
}

function Chevron() {
  return (
    <svg
      width="11"
      height="7"
      viewBox="0 0 12 8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0 text-fg-meta"
    >
      <path d="M1 1.5 6 6.5l5-5" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden
      className="shrink-0 text-fg-meta"
    >
      <rect x="2.5" y="3.5" width="11" height="10" rx="2" />
      <path d="M2.5 6.5h11M5.5 2.5v2M10.5 2.5v2" />
    </svg>
  );
}

/**
 * **일정 칩 하나**(H-5) — `[📅 08.27 – 08.29]`. 전체폭 입력 2칸은 **생성 드로어 규격**이다.
 *
 * 누르면 §4 의 달력이 열린다 — **한 달만 보여주고 범위를 고른다.** 달을 넘겨도 선택은 유지된다
 * (`CalendarGrid` 가 커서를 자체 상태로 들고, 선택은 이 컴포넌트가 든다).
 */
export function ScheduleChipControl({
  value,
  size,
  onChange,
  readOnly = false,
}: {
  /** 표시할 일정 — 드로어는 서버 값, 확장 수정 모드는 **초안 값**을 준다. */
  value: { startDate: string | null; dueDate: string | null };
  size: HeaderSize;
  onChange: (next: { startDate: string | null; dueDate: string | null }) => void;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  /** 첫 클릭만 한 상태 — `null` 이면 다음 클릭이 시작일이다. */
  const [anchor, setAnchor] = useState<DateKey | null>(null);
  const today = currentDate();

  const label = formatSchedule(value.startDate, value.dueDate);
  const chip = (
    <span
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-control border border-border bg-card px-3 text-meta text-fg-muted",
        SIZE[size].control,
        size === "page" && "px-3.5",
        !readOnly && "hover:bg-muted",
      )}
    >
      <CalendarIcon />
      {label}
    </span>
  );

  if (readOnly) {
    return chip;
  }

  const apply = (period: Period | null) => {
    setOpen(false);
    setAnchor(null);
    onChange(period ? { startDate: period.from, dueDate: period.to } : { startDate: null, dueDate: null });
  };

  /** 선택 표시 — 시작·끝은 진한 채움, 사이는 옅은 배경(§4). */
  const selection: Period | null =
    value.startDate && value.dueDate
      ? { from: value.startDate, to: value.dueDate }
      : value.dueDate
        ? { from: value.dueDate, to: value.dueDate }
        : value.startDate
          ? { from: value.startDate, to: value.startDate }
          : null;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setAnchor(null);
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" aria-label="일정 바꾸기">
          {chip}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-80 rounded-card border-border bg-card p-3 shadow-popover"
      >
        <div className="flex flex-col gap-2">
          <CalendarGrid
            anchorMonth={value.startDate ?? value.dueDate ?? today}
            isSelected={(day) =>
              anchor !== null
                ? day === anchor
                : selection !== null && day >= selection.from && day <= selection.to
            }
            isEdge={(day) =>
              anchor !== null
                ? day === anchor
                : selection !== null && (day === selection.from || day === selection.to)
            }
            onSelect={(day) => {
              if (anchor === null) {
                setAnchor(day);
                return;
              }
              apply(anchor <= day ? { from: anchor, to: day } : { from: day, to: anchor });
            }}
          />
          <div className="flex items-center gap-1.5 border-t border-divider pt-2">
            <Shortcut label="오늘" onSelect={() => apply({ from: today, to: today })} />
            <Shortcut label="이번 주" onSelect={() => apply(weekOf(today))} />
            <Shortcut label="이번 달" onSelect={() => apply(monthOf(today))} />
            {/* **일정을 비우는 유일한 길**이다 — 일정은 선택 입력이다(§4) */}
            <Shortcut label="지우기" onSelect={() => apply(null)} />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** 「완료 처리」 — 우측 끝 · 체크 + primary(H-6). */
export function CompleteButton({
  task,
  size,
  disabled,
  onComplete,
}: {
  task: TaskDetail;
  size: HeaderSize;
  disabled?: boolean;
  onComplete: () => void;
}) {
  return (
    <button
      type="button"
      disabled={task.status === "done" || disabled}
      onClick={onComplete}
      className={cn(
        "flex shrink-0 items-center gap-[7px] rounded-control bg-primary px-4 text-meta font-semibold text-primary-foreground",
        "hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50",
        SIZE[size].control,
      )}
    >
      <Check className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
      완료 처리
    </button>
  );
}

/**
 * `⋮` 메뉴 — **표면마다 항목이 다르다**(§1).
 *
 * - **드로어: 「삭제」만.** 이미 열려 있고 상태는 옆 칩이 바꾼다. 전에 있던 「열기 / 상태 4종」은
 *   **리스트·칸반 컨텍스트 메뉴 규격**(SPEC-004 U-5)을 잘못 갖다 쓴 것이다(H-7)
 * - **확장 읽기: 「수정」 + 「삭제」**
 */
export function MoreMenu({
  size,
  onEdit,
  onDelete,
}: {
  size: HeaderSize;
  /** 있으면 「수정」이 뜬다 — 확장 페이지 읽기 모드에서만 넘긴다. */
  onEdit?: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const spec = SIZE[size];
  const item =
    "flex h-9 w-full items-center gap-2 rounded-control px-2 text-left text-meta [&_svg]:h-3.5 [&_svg]:w-3.5";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="더 보기"
          className={cn(
            "flex shrink-0 items-center justify-center rounded-control border bg-card text-fg-meta hover:bg-muted",
            spec.icon,
            spec.iconBorder,
          )}
        >
          <MoreVertical className="h-[15px] w-[15px]" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-popover-menu rounded-card border-border bg-card p-1 shadow-popover"
      >
        {onEdit ? (
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            className={cn(item, "text-foreground hover:bg-muted")}
          >
            <Pencil aria-hidden />
            수정
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onDelete();
          }}
          className={cn(item, "text-destructive hover:bg-muted")}
        >
          <Trash2 aria-hidden />
          삭제
        </button>
      </PopoverContent>
    </Popover>
  );
}

/** 헤더의 30×30 / 36×36 아이콘 버튼 — `⤢`·`✕` 가 같은 껍데기를 쓴다. */
export function HeaderIconButton({
  size,
  label,
  onClick,
  children,
}: {
  size: HeaderSize;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const spec = SIZE[size];
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-control border bg-card text-fg-meta hover:bg-muted",
        spec.icon,
        spec.iconBorder,
      )}
    >
      {children}
    </button>
  );
}

/** 제목 — 드로어 26/700, 확장 32/700. 읽기 모드면 텍스트, 아니면 인라인 편집이다. */
export function TitleControl({
  task,
  size,
  readOnly = false,
  saveFailed,
  onSave,
}: {
  task: TaskDetail;
  size: HeaderSize;
  readOnly?: boolean;
  saveFailed?: boolean;
  onSave?: (next: string) => Promise<void>;
}) {
  const spec = SIZE[size];
  if (readOnly || !onSave) {
    return <h1 className={cn("min-w-0 truncate text-foreground", spec.title)}>{task.title}</h1>;
  }
  return (
    <InlineEditText
      ariaLabel="업무 제목"
      value={task.title}
      placeholder="업무 제목"
      className={cn(
        "[&_input]:h-auto [&_input]:py-1",
        size === "page" ? "[&_input]:text-[32px] [&_input]:font-bold" : "[&_input]:text-detail-title",
      )}
      saveFailed={saveFailed}
      onSave={onSave}
    />
  );
}

export { SIZE as HEADER_SIZE };
