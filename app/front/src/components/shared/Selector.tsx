"use client";

/**
 * **S-06 셀렉터 — 유형·프로젝트 공통 팝오버**(SPEC-003 U-1 · WORK-004 Internal Interface Contract).
 *
 * 「고르기는 팝오버」([10] RULES). 트리거에 붙여 열고, 고르면 **즉시 반영**한다(확인 버튼 없음).
 *
 * **프로젝트 갈래 하단에 구분선 + 「+ 새 프로젝트」 인라인 행**을 둔다 — 이름 + 색 트리거이고
 * 팔레트·검증은 **WORK-003 의 `ColorPickerPopover` 를 그대로** 쓴다. 만든 프로젝트는
 * **즉시 선택**되고 `['projects']` 가 무효화된다.
 *
 * ## 실패 표시는 prop 이다
 *
 * 셀렉터는 「고르면 즉시 저장」이라 **자동 저장 컨트롤**이다. `saveFailed` 를 prop 으로 받아
 * **테두리만** 바꾸고, 캡션·「다시 저장」은 **그 행 아래 인라인 자리 하나**가 그린다
 * (SPEC-002 U-7 팝오버 규격, 2026-09-06). 내부 state 로 들면 WORK-003 검수 F-1 이 재발한다.
 */

import { useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

import { ColorDot } from "@/components/shared/ColorDot";
import { ColorPickerPopover } from "@/components/shared/ColorPickerPopover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DEFAULT_COLOR_TOKEN, type ColorToken } from "@/lib/palette";
import { cn } from "@/lib/utils";

export interface SelectorOption {
  id: number;
  name: string;
  colorToken: ColorToken | string;
}

export function Selector({
  value,
  options,
  onSelect,
  placeholder,
  label,
  saveFailed = false,
  disabled = false,
  /** 「선택 없음」을 고를 수 있나 — 프로젝트는 0..1 이라 허용, 유형은 필수라 금지(T-2·T-3). */
  clearable = false,
  /** 프로젝트 갈래에만 붙는 인라인 생성 행. 없으면 그 자리가 없다. */
  onCreate,
  creating = false,
  createLabel = "+ 새 프로젝트",
  trailing,
}: {
  value: SelectorOption | null;
  options: readonly SelectorOption[];
  onSelect: (option: SelectorOption | null) => void;
  placeholder: string;
  label: string;
  saveFailed?: boolean;
  disabled?: boolean;
  clearable?: boolean;
  onCreate?: (input: { name: string; colorToken: ColorToken }) => Promise<SelectorOption | null>;
  creating?: boolean;
  createLabel?: string;
  /** 트리거 안 오른쪽에 덧붙일 것(저장 중 표시 등). */
  trailing?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState<ColorToken>(DEFAULT_COLOR_TOKEN);

  const submitCreate = async () => {
    if (!onCreate || draftName.trim().length === 0 || creating) {
      return;
    }
    const created = await onCreate({ name: draftName.trim(), colorToken: draftColor });
    if (created) {
      // **즉시 선택**된다(Internal Interface Contract).
      onSelect(created);
      setDraftName("");
      setDraftColor(DEFAULT_COLOR_TOKEN);
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={label}
          // `button` 롤은 `aria-invalid` 를 받지 않는다 — 상태는 data 속성으로 드러낸다.
          data-save-failed={saveFailed || undefined}
          className={cn(
            "flex h-9 min-w-[136px] items-center gap-2 rounded-control border bg-card px-3 text-body",
            "disabled:cursor-not-allowed disabled:opacity-50",
            !disabled && "hover:bg-muted",
            // **실패한 컨트롤 자신에 테두리 실패색**(U-7 팝오버 규격)
            saveFailed ? "border-destructive" : "border-border",
          )}
        >
          {value ? (
            <>
              <ColorDot colorToken={value.colorToken} />
              <span className="min-w-0 flex-1 truncate text-left text-foreground">{value.name}</span>
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate text-left text-fg-caption">{placeholder}</span>
          )}
          {trailing}
          <ChevronDown className="shrink-0 text-fg-caption" aria-hidden />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72 rounded-card border-border bg-card p-1 shadow-popover">
        <ul role="listbox" aria-label={label} className="max-h-64 overflow-y-auto">
          {clearable ? (
            <li>
              <button
                type="button"
                role="option"
                aria-selected={value === null}
                onClick={() => {
                  onSelect(null);
                  setOpen(false);
                }}
                className="flex h-9 w-full items-center gap-2 rounded-control px-2 text-body text-muted-foreground hover:bg-muted"
              >
                <span className="min-w-0 flex-1 truncate text-left">선택 없음</span>
                {value === null ? <Check className="shrink-0 text-primary" aria-hidden /> : null}
              </button>
            </li>
          ) : null}

          {options.map((option) => {
            const selected = value?.id === option.id;
            return (
              <li key={option.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onSelect(option);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex h-9 w-full items-center gap-2 rounded-control px-2 text-body hover:bg-muted",
                    selected ? "bg-secondary text-secondary-foreground" : "text-foreground",
                  )}
                >
                  <ColorDot colorToken={option.colorToken} />
                  <span className="min-w-0 flex-1 truncate text-left">{option.name}</span>
                  {selected ? <Check className="shrink-0 text-primary" aria-hidden /> : null}
                </button>
              </li>
            );
          })}
        </ul>

        {onCreate ? (
          <>
            <div className="my-1 h-px bg-divider" />
            {/* 「+ 새 프로젝트」 인라인 행 — 이름 + 색 트리거(WORK-003 의 팔레트 그대로) */}
            <div className="flex items-center gap-2 p-1">
              <ColorPickerPopover
                value={draftColor}
                onSelect={setDraftColor}
                variant="dot"
                label="새 프로젝트 색"
                className="h-9"
              />
              <Input
                aria-label={createLabel}
                placeholder={createLabel}
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submitCreate();
                }}
                className="h-9 min-w-0 flex-1"
              />
              <Button
                type="button"
                className="h-9 shrink-0 px-3 text-meta"
                disabled={draftName.trim().length === 0 || creating}
                onClick={() => void submitCreate()}
              >
                추가
              </Button>
            </div>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
