"use client";

/**
 * **S-06 셀렉터 — 유형·프로젝트 공통 팝오버**(SPEC-003 U-1 · WORK-004 Internal Interface Contract).
 *
 * 「고르기는 팝오버」([10] RULES). 트리거에 붙여 열고, 고르면 **즉시 반영**한다(확인 버튼 없음).
 *
 * ## 하단 「+ 새 프로젝트로 추가」 인라인 행 — **규격의 정본은 SPEC-006 U-3**(WORK-006 Phase 5 대조)
 *
 * > 목록 끝 구분선 아래 **36px 행** 「+ 새 프로젝트로 추가」. 누르면 그 행이
 * > **[색 트리거 28] [이름 입력(유동)] [추가]** 로 바뀐다. `Enter`/「추가」 → `POST /api/projects` →
 * > 성공하면 목록에 들어가고 **즉시 선택**되며 팝오버가 닫힌다. 실패(`duplicate_name`·`validation_error`)는
 * > **행 아래 인라인 문구, 입력값 유지.** `Esc` 는 행을 원래 항목으로 되돌린다.
 *
 * WORK-004 판은 입력 행이 **늘 펼쳐져** 있었고, 실패 문구 자리와 `Esc` 복귀가 없었다 —
 * 그 셋을 여기서 맞췄다. **전 영역 공통**이라 업무 생성 드로어도 같이 바뀐다.
 * 팔레트·검증은 **WORK-003 의 `ColorPickerPopover` 를 그대로** 쓴다.
 *
 * ## 실패 표시는 prop 이다
 *
 * 셀렉터는 「고르면 즉시 저장」이라 **자동 저장 컨트롤**이다. `saveFailed` 를 prop 으로 받아
 * **테두리만** 바꾸고, 캡션·「다시 저장」은 **그 행 아래 인라인 자리 하나**가 그린다
 * (SPEC-002 U-7 팝오버 규격, 2026-09-06). 내부 state 로 들면 WORK-003 검수 F-1 이 재발한다.
 * (인라인 생성 행의 실패 문구는 **자동 저장이 아니라 생성 요청의 거절 사유**라 이 규칙 밖이다 —
 * 그 행이 자기 아래에 적는다.)
 */

import { useState, type ReactNode } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";

import { isEnterSubmit } from "@/lib/keyboard";
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

/** 인라인 생성이 거절됐는데 호출자가 사유를 안 줬을 때의 문구. 보통은 `createErrorMessage` 가 짚는다. */
const CREATE_FALLBACK_MESSAGE = "만들지 못했습니다. 다시 시도해 주세요";

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
  createLabel = "새 프로젝트로 추가",
  createErrorMessage,
  trailing,
  renderTrigger,
}: {
  value: SelectorOption | null;
  options: readonly SelectorOption[];
  onSelect: (option: SelectorOption | null) => void;
  placeholder: string;
  label: string;
  saveFailed?: boolean;
  disabled?: boolean;
  clearable?: boolean;
  /**
   * 인라인 행의 저장. **거절은 throw 로** 돌아온다(`mutateAsync` 그대로) — 그러면 행 아래에
   * `createErrorMessage(error)` 를 적고 입력을 **그대로 둔다**(U-3). `null` 을 돌려주는 옛 계약도
   * 실패로 본다(사유 없이).
   */
  onCreate?: (input: { name: string; colorToken: ColorToken }) => Promise<SelectorOption | null>;
  creating?: boolean;
  /** 접힌 행의 문구. 「+」 글리프는 여기서 붙인다. */
  createLabel?: string;
  /** 거절 사유를 사람 말로 — `duplicate_name` 「같은 이름의 프로젝트가 이미 있습니다」 등(SPEC-002 §4). */
  createErrorMessage?: (error: unknown) => string | null;
  /** 트리거 안 오른쪽에 덧붙일 것(저장 중 표시 등). */
  trailing?: ReactNode;
  /**
   * 트리거를 **통째로 갈아끼운다**(REDRAW-03 H-3).
   *
   * 상세 헤더는 셀렉터 박스가 아니라 **유형 배지 / 프로젝트 칩**이 목록을 연다(시안 1890줄).
   * 목록은 그대로 두고 **여는 것만** 바뀌므로 팝오버를 두 벌 만들지 않는다.
   */
  renderTrigger?: (state: { open: boolean; value: SelectorOption | null }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  /** 인라인 행이 **펼쳐졌나** — 접힌 상태가 기본이고 누르면 입력 행으로 바뀐다(U-3). */
  const [composing, setComposing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState<ColorToken>(DEFAULT_COLOR_TOKEN);
  const [createError, setCreateError] = useState<string | null>(null);

  /** `Esc`·닫힘 — 행을 원래 항목으로 되돌린다. 입력·사유도 함께 버린다. */
  const collapse = () => {
    setComposing(false);
    setDraftName("");
    setDraftColor(DEFAULT_COLOR_TOKEN);
    setCreateError(null);
  };

  const submitCreate = async () => {
    if (!onCreate || draftName.trim().length === 0 || creating) {
      return;
    }
    setCreateError(null);
    try {
      const created = await onCreate({ name: draftName.trim(), colorToken: draftColor });
      if (!created) {
        setCreateError(CREATE_FALLBACK_MESSAGE);
        return;
      }
      // **즉시 선택**되고 팝오버가 닫힌다(U-3).
      onSelect(created);
      collapse();
      setOpen(false);
    } catch (error) {
      // **입력값을 지우지 않는다** — 사유를 행 아래에 적고 사용자가 고쳐 다시 보낸다(U-3).
      setCreateError(createErrorMessage?.(error) ?? CREATE_FALLBACK_MESSAGE);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          collapse();
        }
      }}
    >
      <PopoverTrigger asChild>
        {renderTrigger ? (
          renderTrigger({ open, value })
        ) : (
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
        )}
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-72 rounded-card border-border bg-card p-1 shadow-popover"
        /**
         * `Esc` — 인라인 행이 펼쳐져 있으면 **행만** 원래 항목으로 되돌리고 팝오버는 그대로 둔다(U-3).
         * Radix 는 document capture 단계에서 `Esc` 를 잡으므로 입력의 `onKeyDown` 으로는 늦다 — 여기서 막는다.
         */
        onEscapeKeyDown={(event) => {
          if (composing) {
            event.preventDefault();
            collapse();
          }
        }}
      >
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
            {composing ? (
              /* 펼친 행 — [색 트리거 28][이름 입력(유동)][추가]. 36px 행 안에 든다(U-3) */
              <div className="flex flex-col gap-1 p-1">
                <div className="flex h-9 items-center gap-2">
                  <ColorPickerPopover
                    value={draftColor}
                    onSelect={setDraftColor}
                    variant="dot"
                    label="새 프로젝트 색"
                    className="h-7 w-7"
                  />
                  <Input
                    autoFocus
                    aria-label="새 프로젝트 이름"
                    aria-invalid={createError !== null}
                    placeholder="프로젝트 이름"
                    value={draftName}
                    onChange={(event) => {
                      setDraftName(event.target.value);
                      setCreateError(null);
                    }}
                    onKeyDown={(event) => {
                      if (isEnterSubmit(event)) {
                        void submitCreate();
                      }
                    }}
                    className={cn("h-7 min-w-0 flex-1 px-2 text-meta", createError && "border-destructive")}
                  />
                  <Button
                    type="button"
                    className="h-7 shrink-0 px-2.5 text-caption"
                    disabled={draftName.trim().length === 0 || creating}
                    onClick={() => void submitCreate()}
                  >
                    추가
                  </Button>
                </div>
                {/* 실패 사유는 **행 아래 인라인** — 입력값은 그대로 남아 있다 */}
                {createError ? (
                  <p role="alert" className="px-1 text-caption text-destructive">
                    {createError}
                  </p>
                ) : null}
              </div>
            ) : (
              /* 접힌 행 — 36px 「+ 새 프로젝트로 추가」. 누르면 위 입력 행으로 바뀐다 */
              <button
                type="button"
                onClick={() => setComposing(true)}
                className="flex h-9 w-full items-center gap-2 rounded-control px-2 text-body text-fg-caption hover:bg-muted hover:text-foreground [&_svg]:h-3.5 [&_svg]:w-3.5"
              >
                <Plus aria-hidden />
                <span className="min-w-0 flex-1 truncate text-left">{createLabel}</span>
              </button>
            )}
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
