"use client";

/**
 * **아직 열리지 않은 기능의 표시 — 전 영역 공통 규격**(SPEC-001 U-2 · FE §9 · DEC-001 §v2).
 *
 * v2 기능의 UI 는 v1 에서 **그대로 그린다. 숨기지 않는다.** 이 컴포넌트는 children 을 바꾸지
 * 않고 한 겹을 얹어 **이벤트만 가로챈다** — 화면마다 `disabled` 를 흩뿌리지 않아야 v2 에서
 * 게이트만 걷어낼 수 있다.
 *
 * **표시 방식은 하나이고 문구만 두 가지**다(§C-9 — 컴포넌트를 둘로 나누지 않는다).
 *
 * | `reason` | 문구 | 대상 |
 * |---|---|---|
 * | `v2` | 「v2에서 제공됩니다」 | 소셜 로그인 · 계정 삭제 · 「다른 기기 모두 로그아웃」 … |
 * | `soon` | 「곧 제공됩니다」 | 정책서가 아직 없는 영역 — 사이드바 홈 · 채팅 |
 *
 * 조작해도 **네트워크 요청이 나가지 않고 화면도 움직이지 않는다.** 연달아 눌러도 토스트는
 * **하나**만 유지된다(중복 스택 금지) — 같은 `id` 로 덮어쓴다.
 */

import { toast } from "sonner";

import { cn } from "@/lib/utils";

export type V2GateReason = "v2" | "soon";

const MESSAGE: Record<V2GateReason, string> = {
  v2: "v2에서 제공됩니다",
  soon: "곧 제공됩니다",
};

/** 토스트 하나만 남기기 위한 고정 id. 문구별로 하나씩이라 연타해도 스택이 쌓이지 않는다. */
const TOAST_ID: Record<V2GateReason, string> = {
  v2: "v2-gate-v2",
  soon: "v2-gate-soon",
};

interface V2GateProps {
  reason: V2GateReason;
  children: React.ReactNode;
  className?: string;
}

export function V2Gate({ reason, children, className }: V2GateProps) {
  const block = (event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
    toast(MESSAGE[reason], { id: TOAST_ID[reason] });
  };

  return (
    <span
      // 포커스는 받지만 조작은 막힌다(U-2). 레이아웃은 바뀌지 않는다 — 자리·크기 그대로다.
      aria-disabled="true"
      data-v2-gate={reason}
      className={cn("inline-block cursor-not-allowed opacity-45", className)}
      onClickCapture={block}
      onPointerDownCapture={block}
      onSubmitCapture={block}
      /**
       * **드롭도 조작이다**(SPEC-006 U-3·U-7 — 로컬 파일 업로드는 v2). `dragover` 를 막아야
       * 브라우저가 `drop` 을 이 요소에 주고, 그 `drop` 을 여기서 삼켜 **파일이 열리거나 요청이
       * 나가는 일이 없다.** 드롭 영역마다 핸들러를 흩뿌리지 않는다 — 게이트 하나가 한다(FE §9).
       */
      onDragOverCapture={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDropCapture={block}
      onKeyDownCapture={(event) => {
        if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
          block(event);
        }
      }}
    >
      {children}
    </span>
  );
}
