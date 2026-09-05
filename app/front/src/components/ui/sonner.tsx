"use client"

/**
 * shadcn CLI 생성물(`npx shadcn add sonner`)에서 **둘을 뺐다.**
 *
 * 1. `next-themes` 의 `useTheme()` — v1 에 다크 모드가 없다(`globals.css` 가 `color-scheme: light`
 *    하나로 고정). 생성물 그대로 두면 OS 다크 모드에서 토스트만 검게 뒤집힌다.
 * 2. 토스트 배경 — 디자인은 **토스트를 Ink 서피스로 본다**(`09-design-tokens.md` §색:
 *    「토스트는 오버레이 서피스라 예외」). 그래서 배경만 `bg-ink` 로 맞췄다.
 *
 * 문구·실행취소 같은 **S-24 토스트 규격은 그 화면을 만드는 work** 의 몫이다 —
 * 여기서는 레이아웃에 얹을 표면 하나만 세운다.
 */

import { Toaster as Sonner } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      /* `09-design-tokens.md` §토스트 — 하단 중앙 60px 위, 4초(SPEC-001 U-2 가 참조하는 규격) */
      position="bottom-center"
      offset={60}
      duration={4000}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-ink group-[.toaster]:text-primary-foreground group-[.toaster]:border-ink group-[.toaster]:shadow-popover",
          description: "group-[.toast]:text-fg-caption",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
