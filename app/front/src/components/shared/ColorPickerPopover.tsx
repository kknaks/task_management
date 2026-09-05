"use client";

/**
 * **U-4 색 팝오버 — 허용 팔레트 8종**(SPEC-002).
 *
 * 「고르기는 팝오버」([10] RULES). 폭 240(오버레이 규격 200–400 범위), 24px 스와치 8개를
 * **4×2 그리드**로 놓는다. 현재 값은 1px `--tm-primary` 테두리 + 3px 글로우.
 *
 * - **선택 즉시 반영·저장. 확인 버튼이 없다**(`11-auth-profile.md` §셀렉터)
 * - **자유 색상 입력이 없다** — 「직접 입력」 항목을 두지 않는다(DEC-001 §3 · U-4 기대 결과)
 * - `Esc`·바깥 클릭으로 닫으면 **값이 바뀌지 않는다**
 *
 * 스와치 자체가 견본이다 — 유형은 배지 조합 그대로 「가」, 프로젝트는 dot. **색 이름을
 * 글자로 쓰지 않는다**(U-4 문구).
 */

import { useState } from "react";

import { ColorDot } from "@/components/shared/ColorDot";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PALETTE_TOKENS } from "@/lib/palette";
import { cn } from "@/lib/utils";
import type { ColorToken } from "@/types/api";

export type ColorPickerVariant = "badge" | "dot";

export function ColorPickerPopover({
  value,
  onSelect,
  variant = "badge",
  disabled = false,
  saveFailed = false,
  label = "색",
  className,
}: {
  value: ColorToken | string;
  /** 고른 즉시 불린다. 저장은 호출자가 한다 — 확인 단계가 없다. */
  onSelect: (token: ColorToken) => void;
  variant?: ColorPickerVariant;
  disabled?: boolean;
  /**
   * **U-7 실패 표시.** 색 트리거는 「고르면 즉시 저장」이라 **자동 저장 컨트롤**이다(U-3 CTA) —
   * `InlineEditText` 와 **같은 prop 을 공통으로** 갖는다(FE §3-5).
   *
   * 여기서 그리는 것은 **테두리 실패색뿐**이다. 캡션·「다시 저장」은 세로 공간이 없어
   * **행 아래 인라인 자리 하나**(`AutoSaveFailureNotice`)에 모은다(U-7 팝오버 규격).
   */
  saveFailed?: boolean;
  /** 접근성 라벨. 화면에는 글자를 쓰지 않는다. */
  label?: string;
  /** 트리거 높이 등 자리별 차이를 흡수한다(추가 행 36 / 목록 행 34). */
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={label}
          // `button` 롤은 `aria-invalid` 를 받지 않는다 — 상태는 data 속성으로 드러낸다.
          // 사람에게 읽히는 사유는 행 아래 `role="alert"` 인라인 자리가 말한다(U-7).
          data-save-failed={saveFailed || undefined}
          data-color-token={value}
          className={cn(
            "flex h-control w-14 shrink-0 items-center justify-center rounded-control border bg-card",
            "disabled:cursor-not-allowed disabled:opacity-50",
            !disabled && "hover:bg-muted",
            // **실패한 컨트롤 자신에 테두리 실패색 + 값 유지**(U-7 팝오버 규격)
            saveFailed ? "border-destructive" : "border-border",
            className,
          )}
        >
          {variant === "dot" ? (
            <ColorDot colorToken={value} />
          ) : (
            <span className="inline-flex h-5 w-7 items-center justify-center rounded-chip bg-palette-bg text-badge text-palette-fg">
              가
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-60 rounded-card border-border bg-card p-3 shadow-popover">
        <div role="listbox" aria-label={label} className="grid grid-cols-4 gap-2">
          {PALETTE_TOKENS.map((token) => {
            const current = token === value;
            return (
              <button
                key={token}
                type="button"
                role="option"
                aria-selected={current}
                aria-label={token}
                data-color-token={token}
                onClick={() => {
                  // 고른 즉시 반영하고 닫는다 — 확인 버튼이 없다.
                  onSelect(token);
                  setOpen(false);
                }}
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-chip border border-transparent bg-palette-bg",
                  // 현재 값 표시 — 1px primary 테두리 + 3px 글로우(U-4 상태)
                  current && "border-primary shadow-swatch-current",
                )}
              >
                {variant === "dot" ? (
                  <ColorDot colorToken={token} />
                ) : (
                  <span className="text-badge text-palette-fg">가</span>
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
