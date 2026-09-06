"use client";

/**
 * **블록 안의 항목 행**(REDRAW-07 B-2).
 *
 * ## ⚠ 전에 틀렸다 — 행마다 테두리를 둘렀다
 *
 * REDRAW-06 브리프가 「항목이 **행 카드**로 쌓인다」고 적었는데 **시안을 확인하지 않고 쓴 것**이고,
 * 나도 그대로 만들었다. 시안(`업무 화면 정의서.dc.html` L1953~1975)은 **테두리 없는 행**이고
 * **구분선 하나로만** 갈린다 — 카드가 겹겹이 쌓이면 블록 자체의 테두리와 이중으로 보인다.
 *
 * | 요소 | 시안 |
 * |---|---|
 * | 행 | **h44** · 테두리 **없음** · `padding 0 16` · `gap 9` · 13px |
 * | 구분 | **`border-bottom 1px #F1F2F5`** — **마지막 행은 없다** |
 * | 목록 | **`gap` 없음** — 행이 맞붙는다 |
 * | 좌측 슬롯 | 연관업무 **상태 dot 8px** · 참고자료 **파일 타일 22px r5** |
 *
 * **점선은 결과자료 「+ 결과물 등록」 하나뿐이다**(시안 L1988). 참고자료·연관업무의 추가 행은
 * **테두리 없는 h44 행**이다 — `DashedAddButton` 을 그 자리에 쓰지 않는다.
 *
 * **비어 있을 때만 캡션**을 둔다(호출부가 가른다).
 * 제거 버튼은 **행 hover 에서만** 드러난다 — 항상 띄우면 `✕` 가 목록을 채운다.
 */

import { forwardRef } from "react";

import { cn } from "@/lib/utils";

export function ItemRow({
  leading,
  children,
  trailing,
  className,
}: {
  /** 좌측 슬롯 — 상태 dot 이나 파일 유형 타일. */
  leading?: React.ReactNode;
  children: React.ReactNode;
  /** 우측 슬롯 — 보통 hover 로 드러나는 제거 버튼. */
  trailing?: React.ReactNode;
  className?: string;
}) {
  return (
    <li
      className={cn(
        // h44 · 테두리 없음 · `padding 0 16` · gap 9 · 구분선은 **마지막 행만 없다**
        "group flex h-11 items-center gap-[9px] border-b border-row-divider px-4 text-meta last:border-b-0",
        className,
      )}
    >
      {leading}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </li>
  );
}

/** 행이 쌓이는 자리 — **`gap` 이 없다.** 행끼리 맞붙고 구분선이 갈라 준다(시안 L1953). */
export function ItemRows({ children }: { children: React.ReactNode }) {
  return <ul className="flex flex-col">{children}</ul>;
}

/**
 * **추가 행** — 참고자료·연관업무의 마지막 행(시안 L1962·L1975).
 * h44 · `padding 0 16` · `gap 9` · 아이콘 13px + 텍스트가 **전체 `#9EA2AE`** ·
 * **테두리가 없다.** 점선 박스는 결과자료 전용이라 여기 쓰지 않는다.
 *
 * ## ⚠ `forwardRef` 가 **필수**다 — 없으면 눌러도 아무 일이 없다
 *
 * 이 버튼은 `AttachmentPopover`·`RelationPopover` 의 `trigger` 로 들어가고, 그쪽은 Radix
 * `PopoverTrigger asChild` 다. **`asChild` 는 자식에게 `onClick`·`ref`·`aria-*` 를 넘긴다** —
 * 함수 컴포넌트가 `ref` 를 못 받으면 팝오버가 붙을 앵커를 잃고 **열리지 않는다.**
 * props 를 펼쳐 받는 것만으로는 부족하다(REDRAW-08 C-1 에서 실제로 그렇게 막혀 있었다).
 */
export const AddRowButton = forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<"button">>(
  function AddRowButton({ className, children, ...props }, ref) {
  return (
    <button
      type="button"
      ref={ref}
      {...props}
      className={cn(
        "flex h-11 w-full items-center gap-[9px] px-4 text-meta text-fg-caption",
        "hover:bg-row-hover hover:text-foreground",
        "disabled:cursor-not-allowed disabled:opacity-60",
        "[&_svg]:h-[13px] [&_svg]:w-[13px]",
        className,
      )}
    >
      {children}
    </button>
  );
});

/**
 * **점선 등록 버튼 — 결과자료 「+ 결과물 등록」 전용**(시안 L1988: `h44 · 1px dashed #D9D9D9 · r8`).
 *
 * 참고자료·연관업무의 추가 행에는 **쓰지 마라** — 그쪽은 `AddRowButton`(테두리 없는 행)이다.
 * `Button` 을 쓰지 않는 이유는 shadcn 기본 variant 에 이 규격이 없어서다.
 */
export const DashedAddButton = forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<"button">
>(function DashedAddButton({ className, children, ...props }, ref) {
  return (
    <button
      type="button"
      ref={ref}
      {...props}
      className={cn(
        "flex h-[38px] w-full items-center justify-center gap-[7px] rounded-control",
        "border border-dashed border-border text-meta text-fg-caption",
        "hover:bg-row-hover hover:text-foreground",
        "disabled:cursor-not-allowed disabled:opacity-60",
        "[&_svg]:h-[13px] [&_svg]:w-[13px]",
        className,
      )}
    >
      {children}
    </button>
  );
});
