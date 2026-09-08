/**
 * shadcn CLI 생성물(`npx shadcn add popover`). **손댄 곳은 하나**이고 `sheet.tsx` 와 같은 예외다
 * (frontend/README.md §2 규칙 2 둘째 예외 — 「생성물이 **내부에서만 렌더하는 요소**에 래퍼가 닿을 수 있게 하는 통로」).
 *
 * `PopoverPrimitive.Portal` 의 **`container`** 가 그 요소다. 기본값(`body`)이면 드로어 안에서 열린 팝오버가
 * 드로어의 스크롤 잠금(`react-remove-scroll`) **밖**이 돼 목록이 `overflow-y-auto` 여도 **휠을 못 받는다.**
 * 그래서 자리를 `usePortalContainer()` 하나가 정한다 — 드로어 안이면 드로어 콘텐츠, 밖이면 `null`(= `body`, 생성물 그대로).
 * **팝오버마다 `onWheel` 을 심지 않는다** — 고치는 자리는 여기 하나다(`lib/overlay/PortalContainer.tsx` 주석).
 */
import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import { usePortalContainer } from "@/lib/overlay/PortalContainer"
import { cn } from "@/lib/utils"

const Popover = PopoverPrimitive.Root

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverAnchor = PopoverPrimitive.Anchor

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => {
  const container = usePortalContainer()
  return (
  <PopoverPrimitive.Portal container={container ?? undefined}>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-popover-content-transform-origin]",
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
  )
})
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
