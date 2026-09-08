"use client";

/**
 * **U-12 정렬 · 상태 필터**(SPEC-004).
 *
 * 「고르기는 팝오버」이고 **「적용」 버튼을 두지 않는다**([10]) — 고르는 즉시 반영된다.
 * 값은 쿼리에 남으므로 이 컴포넌트는 **아무 상태도 들지 않는다**(열림 여부만 든다).
 *
 * **선택 색은 「현재 값」 배경**이다 — 이 화면에서 Ink 는 유형 탭 하나뿐이다(§2).
 */

import { forwardRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { StatusDot, STATUS_LABEL } from "@/components/shared/StatusDot";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TaskSort, TaskStatus } from "@/features/tasks/types";
import { cn } from "@/lib/utils";

const SORT_LABEL: Record<TaskSort, string> = {
  due_asc: "기한 빠른 순",
  due_desc: "기한 늦은 순",
  created_desc: "최근 등록순",
};

const STATUSES: readonly TaskStatus[] = ["todo", "in_progress", "done", "cancelled"];

/**
 * `PopoverTrigger asChild` 는 자식에 **ref 를 꽂는다** — 그래야 팝오버가 이 버튼에 붙는다.
 * `forwardRef` 가 없으면 ref 가 버려져 **팝오버가 열리지 않는다**(실물에서 그렇게 났다).
 */
const Trigger = forwardRef<
  HTMLButtonElement,
  { label: string; active: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function Trigger({ label, active, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      {...props}
      /**
       * **h34 · r8 · border `#D9D9D9` · 흰 배경 · 13px `#757575` · padding 0 14 · gap 8**
       * (시안 67~74줄 · REDRAW-05 F-6). 툴바에서 스테퍼 3개만 30 이고 나머지는 전부 34 다.
       */
      className={cn(
        "flex h-[34px] items-center gap-2 rounded-control border bg-card px-3.5 text-meta",
        active
          ? "border-primary bg-secondary text-secondary-foreground"
          : "border-border text-fg-meta hover:bg-muted",
      )}
    >
      {label}
      {/* chevron 11×7 — 시안 73줄 */}
      <ChevronDown className="h-[7px] w-[11px]" strokeWidth={1.6} aria-hidden />
    </button>
  );
});

function Item({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex h-9 w-full items-center gap-2 rounded-control px-3 text-left text-meta",
        selected ? "bg-pick font-bold text-pick-foreground" : "text-foreground hover:bg-muted",
      )}
    >
      <span className="flex-1">{children}</span>
      {selected ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
    </button>
  );
}

export function SortPopover({
  value,
  onChange,
}: {
  value: TaskSort;
  onChange: (next: TaskSort) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Trigger label={SORT_LABEL[value]} active={false} />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-popover-menu rounded-card border-border bg-card p-1 shadow-popover"
      >
        {(Object.keys(SORT_LABEL) as TaskSort[]).map((sort) => (
          <Item
            key={sort}
            selected={sort === value}
            onSelect={() => {
              setOpen(false);
              onChange(sort);
            }}
          >
            {SORT_LABEL[sort]}
          </Item>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function StatusFilterPopover({
  value,
  onChange,
}: {
  value: TaskStatus | null;
  /** `null` 은 「전체」 — 필터를 지운다. */
  onChange: (next: TaskStatus | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Trigger label={value === null ? "상태" : STATUS_LABEL[value]} active={value !== null} />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-popover-menu rounded-card border-border bg-card p-1 shadow-popover"
      >
        <Item
          selected={value === null}
          onSelect={() => {
            setOpen(false);
            onChange(null);
          }}
        >
          전체
        </Item>
        {STATUSES.map((status) => (
          <Item
            key={status}
            selected={status === value}
            onSelect={() => {
              setOpen(false);
              onChange(status);
            }}
          >
            <span className="flex items-center gap-2">
              <StatusDot status={status} />
              {STATUS_LABEL[status]}
            </span>
          </Item>
        ))}
      </PopoverContent>
    </Popover>
  );
}
