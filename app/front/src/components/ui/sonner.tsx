"use client"

/**
 * shadcn CLI 생성물(`npx shadcn add sonner`)에서 **둘을 뺐다.**
 *
 * 1. `next-themes` 의 `useTheme()` — v1 에 다크 모드가 없다(`globals.css` 가 `color-scheme: light`
 *    하나로 고정). 생성물 그대로 두면 OS 다크 모드에서 토스트만 검게 뒤집힌다.
 * 2. 토스트 배경 — 디자인은 **토스트를 Ink 서피스로 본다**(디자인 시스템 [10] RULES:
 *    「토스트는 배경이 아니라 띄운 서페이스라 예외」). 그래서 배경만 `bg-ink` 로 맞췄다.
 *
 * ## 표면 규격 — 디자인 시스템 [07] Toast(479~484줄 · REDRAW-06 G-1)
 *
 * `400 × 56` · **r10** · bg `#1E1E1E` · shadow **`0 16px 40px rgba(0,0,0,0.28)`** ·
 * 하단 중앙 **60px 위** · **4초** · `padding 0 18` · `gap 12` ·
 * 아이콘 **22px 원 `#7181F8`** + 흰 체크 12px(stroke 2.2) · 텍스트 **14px** 흰색 ·
 * 실행취소 **13/600 `#A6CDFF`**(배경 없는 **텍스트 링크**다 — 채운 버튼이 아니다).
 *
 * **문구·동작·조건은 여기서 정하지 않는다** — 그 화면을 만드는 work 의 몫이다.
 * 여기는 표면 하나뿐이고, 아이콘도 성공/실패 두 벌만 제공한다.
 *
 * `r10` 은 [05] SURFACE 의 card(8)·panel(16) 어느 쪽도 아니라 **토스트 전용 값**이다 —
 * 토큰으로 올리지 않고 이 자리에서만 쓴다.
 */

import { Toaster as Sonner } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

/**
 * 22px 원 + 흰 글리프. 성공은 `--tm-primary`, 실패는 `--tm-status-overdue` 다.
 *
 * ⚠ **실패 아이콘 규격은 시안에 없다** — [07] Toast 는 성공 하나만 그렸다.
 * 성공 아이콘의 **원 색만 바꾸고 글리프를 `!` 로 돌린** 것이고, 디자인 확인이 필요하다.
 */
function ToastIcon({ tone }: { tone: "success" | "error" }) {
  return (
    <span
      aria-hidden
      className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-primary-foreground ${
        tone === "success" ? "bg-primary" : "bg-status-overdue"
      }`}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {tone === "success" ? (
          <path d="M3.6 8.4 6.4 11.2l6-6.4" />
        ) : (
          <path d="M8 4.2v4.6M8 11.4v.2" />
        )}
      </svg>
    </span>
  )
}

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      /* [07] Toast — 하단 중앙 60px 위, 4초(SPEC-001 U-2 가 참조하는 규격) */
      position="bottom-center"
      offset={60}
      duration={4000}
      /**
       * 토스트 폭 **400** 을 컨테이너에도 알린다 — sonner 기본이 356 이라 그대로 두면
       * 400짜리 토스트가 컨테이너를 오른쪽으로 넘쳐 **가운데가 22px 어긋난다**(실측).
       */
      style={{ "--width": "400px" } as React.CSSProperties}
      /* 성공·실패 아이콘은 **표면이 갖는다** — 화면마다 넘기면 규격이 갈린다 */
      icons={{
        success: <ToastIcon tone="success" />,
        error: <ToastIcon tone="error" />,
      }}
      toastOptions={{
        classNames: {
          toast: [
            "group toast",
            // 400 × 56 · r10 · Ink 서피스 · 팝오버보다 진한 그림자
            "group-[.toaster]:w-[400px] group-[.toaster]:min-h-[56px] group-[.toaster]:rounded-[10px]",
            "group-[.toaster]:bg-ink group-[.toaster]:border-ink group-[.toaster]:shadow-toast",
            // padding 0 18 · gap 12 · 텍스트 14 흰색
            "group-[.toaster]:px-[18px] group-[.toaster]:py-0 group-[.toaster]:gap-3",
            "group-[.toaster]:text-[14px] group-[.toaster]:text-primary-foreground",
          ].join(" "),
          description: "group-[.toast]:text-fg-caption",
          /**
           * **실행취소는 텍스트 링크다**(시안 483줄) — 보라로 채운 버튼이 아니다.
           *
           * `!` 가 필요하다 — sonner 가 `[data-sonner-toast] [data-button]` 로 배경·크기를
           * 박아 두는데 그 선택자가 유틸 클래스보다 **명시도가 높아** 그냥 주면 진다.
           * (실측으로 확인: 12px/500/`#171717` 배경이 그대로 나왔다.)
           */
          actionButton: [
            "group-[.toast]:!bg-transparent group-[.toast]:hover:!bg-transparent",
            "group-[.toast]:!h-auto group-[.toast]:!px-0",
            "group-[.toast]:!text-[13px] group-[.toast]:!font-semibold",
            "group-[.toast]:!text-toast-action",
          ].join(" "),
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
