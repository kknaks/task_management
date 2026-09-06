/**
 * shadcn CLI 생성물(`npx shadcn add sheet`). **생성물에 손댄 곳은 둘뿐이고 둘 다 규칙의 허용
 * 예외다**(frontend/README.md §2 규칙 2, 2026-09-06 예외 둘째 신설).
 *
 * 1. **스크림 className** — 「토큰 변수 이름을 맞추는 조정」(첫째 예외). 생성물은 `bg-black/80`
 *    인데 드로어 스크림은 `rgba(30,30,30,0.32)` 고정이고(`09-design-tokens.md` §오버레이 3종)
 *    그 값은 `--tm-scrim-drawer` 하나가 정본이다. **드로어는 뒤 화면이 보인다**(F-3) —
 *    그 불투명도를 화면이 덮어쓰지 못하게 여기서 고정한다.
 * 2. **`overlayClassName` 통로 prop** — 「생성물이 **내부에서만 렌더하는 요소**에 래퍼가 닿을 수
 *    있게 하는 통로 prop 하나」(둘째 예외). 오버레이가 `SheetContent` 안에서만 렌더돼
 *    래퍼가 손댈 길이 없다. **값을 정하는 자리는 여전히 `DrawerFrame` 하나**이고 여기는 통로다.
 *
 * **생성물의 기본 닫기 버튼(`SheetPrimitive.Close`)은 지우지 않았다** — 지우면 재생성 때
 * 되살아나 조용히 두 개가 된다. 규격상 숨겨야 하는 자리는 **래퍼가 className 으로 숨긴다**
 * (`ConfirmModal.tsx` 와 같은 방식).
 *
 * 폭·헤더·푸터 규격은 **`components/shared/DrawerFrame.tsx` 한 곳**이 정한다(FE §6-2).
 * 이 파일 밖에서 `Sheet` 를 import 하면 리뷰 반려다(§11 금지 목록 3).
 */
import * as React from "react"
import * as SheetPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const Sheet = SheetPrimitive.Root

const SheetTrigger = SheetPrimitive.Trigger

const SheetClose = SheetPrimitive.Close

const SheetPortal = SheetPrimitive.Portal

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-scrim-drawer  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
    ref={ref}
  />
))
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName

const sheetVariants = cva(
  "fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=open]:animate-in data-[state=closed]:animate-out",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  }
)

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  /**
   * 생성물에 없던 **한 개의 추가 prop**. 좁은 화면에서 드로어가 전체 화면이 되면
   * 스크림을 걷어야 하는데(SPEC-003 U-11), 생성물은 오버레이에 손댈 길을 주지 않는다.
   * **폭·스크림 값을 정하는 자리는 여전히 `DrawerFrame` 하나**이고 여기는 통로일 뿐이다.
   */
  overlayClassName?: string
}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side = "right", className, overlayClassName, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay className={overlayClassName} />
    <SheetPrimitive.Content
      ref={ref}
      className={cn(sheetVariants({ side }), className)}
      {...props}
    >
      {children}
      <SheetPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </SheetPrimitive.Close>
    </SheetPrimitive.Content>
  </SheetPortal>
))
SheetContent.displayName = SheetPrimitive.Content.displayName

const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-2 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
SheetHeader.displayName = "SheetHeader"

const SheetFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
SheetFooter.displayName = "SheetFooter"

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold text-foreground", className)}
    {...props}
  />
))
SheetTitle.displayName = SheetPrimitive.Title.displayName

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
SheetDescription.displayName = SheetPrimitive.Description.displayName

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
