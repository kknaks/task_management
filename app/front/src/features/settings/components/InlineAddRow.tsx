"use client";

/**
 * **U-2 / U-5 인라인 추가 행** — 유형과 프로젝트가 **같은 컴포넌트**를 쓴다(검수 W-6).
 *
 * 전에는 두 패널에 40여 줄이 통째로 복제돼 있었다. 그래서 규격 하나를 고치려면 두 곳을
 * 같이 고쳐야 했고, 다음 영역(업무 생성 인라인 추가)이 **세 번째 사본**을 만들 자리였다.
 *
 * 필드가 셋 이하라 **드로어를 열지 않는다** — 「한 줄짜리 개체는 인라인」·「필드가 4개
 * 이하면 드로어를 열지 않는다」([10] RULES).
 *
 * 규격(U-2 *열림*) — **56px 한 줄 · 배경 `--tm-row-add-bg` · 컨트롤 36px.**
 * 앞에 붙는 것만 다르다: 유형은 [종류 셀렉터 136], 프로젝트는 [색 트리거].
 * 「취소」·`Esc` 로 닫히고 `Enter` 로도 추가되지만 **버튼은 항상 있다**([10] 단축키는 보조).
 *
 * 소비자가 같은 영역 둘뿐이라 `features/settings` 에 둔다 — 업무 영역이 쓰기 시작하면
 * `components/shared/InlineAddRow.tsx` 로 올린다(FE §2 규칙 3 「shared 는 두 영역 이상」).
 */

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** U-2 「컨트롤 36px」 — 셋이 갈리지 않도록 한 곳에서 준다(검수 W-2). */
export const ADD_ROW_CONTROL_HEIGHT = "h-9";

export function InlineAddRow({
  /** 이름 앞에 오는 컨트롤 — 유형은 종류 셀렉터, 프로젝트는 색 트리거. */
  leading,
  /** 이름 뒤에 오는 컨트롤 — 유형은 색 트리거, 프로젝트는 없다. */
  trailing,
  nameLabel,
  namePlaceholder,
  name,
  onNameChange,
  onSubmit,
  onCancel,
  canSubmit,
  errorMessage,
}: {
  leading?: ReactNode;
  trailing?: ReactNode;
  nameLabel: string;
  namePlaceholder: string;
  name: string;
  onNameChange: (next: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  canSubmit: boolean;
  /** 중복 이름 등 — **행이 닫히지 않고 값이 남는다**(Case Matrix `duplicate_name`). */
  errorMessage: string | null;
}) {
  return (
    <div className="border-b border-row-divider bg-row-add px-5 py-2.5">
      <div className="flex h-9 items-center gap-3">
        {leading}

        <Input
          aria-label={nameLabel}
          autoFocus
          placeholder={namePlaceholder}
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSubmit();
            if (event.key === "Escape") onCancel();
          }}
          className={cn(
            ADD_ROW_CONTROL_HEIGHT,
            "min-w-[200px] flex-1",
            errorMessage && "border-destructive",
          )}
        />

        {trailing}

        <Button
          type="button"
          variant="ghost"
          className={cn(ADD_ROW_CONTROL_HEIGHT, "px-3 text-meta")}
          onClick={onCancel}
        >
          취소
        </Button>
        <Button
          type="button"
          className={cn(ADD_ROW_CONTROL_HEIGHT, "px-3 text-meta")}
          disabled={!canSubmit}
          onClick={onSubmit}
        >
          추가
        </Button>
      </div>

      {errorMessage ? <p className="mt-1 text-caption text-destructive">{errorMessage}</p> : null}
    </div>
  );
}
