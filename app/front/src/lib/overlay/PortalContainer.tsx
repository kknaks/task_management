"use client";

/**
 * **포탈이 붙을 자리**(FE §6-2) — 팝오버가 `body` 로 나갈지 **드로어 안**으로 들어갈지 한 곳에서 정한다.
 *
 * ## 왜 있나 — 드로어 안 팝오버가 휠을 못 받는다
 *
 * 드로어(`Sheet` = Radix Dialog `modal`)는 열릴 때 `react-remove-scroll` 로 **화면 스크롤을 잠근다.**
 * 그 잠금은 「잠금 노드(= 드로어 콘텐츠) 안에서 일어난 휠」만 통과시키고 **밖의 휠은 `preventDefault`** 한다
 * (`SideEffect.js` — `shards` 밖이면 `shouldStop`). 그런데 팝오버 콘텐츠는 기본적으로 **`body` 로 포탈**되므로
 * 드로어 「밖」이 되고, 목록이 `overflow-y-auto` 여도 **휠이 도달하지 않는다** —
 * 새 회의록 드로어의 시간 목록 · 프로젝트 셀렉터에서 실제로 그랬다.
 *
 * ## 고치는 자리는 하나다
 *
 * 팝오버마다 `onWheel` 을 심으면 자리가 흩어진다. 대신 **드로어가 자기 콘텐츠 노드를 여기 실어 두고**
 * `PopoverContent` 가 그 자리로 포탈한다 — 드로어 안이면 잠금 노드 **안**이라 휠이 그대로 통과한다.
 * 드로어 밖(목록 화면 · 회의 중 화면)에서는 값이 `null` 이라 **`body` 로 가던 동작 그대로**다.
 *
 * 위치 계산은 영향을 받지 않는다 — Radix Popper 는 `strategy: "fixed"` 이고 드로어 콘텐츠는
 * `position: fixed` 일 뿐 `transform` 을 남기지 않아 **고정 위치의 기준(containing block)을 만들지 않는다.**
 * 곁들여 얻는 것 — 모달 드로어가 `body` 의 형제들에 붙이는 `aria-hidden` · `pointer-events:none` 밖으로 나온다.
 */

import { createContext, useContext, type ReactNode } from "react";

/** `null` = 기본(`body`). 드로어가 열려 있는 동안만 그 콘텐츠 노드가 들어온다. */
const PortalContainerContext = createContext<HTMLElement | null>(null);

export function PortalContainerProvider({
  container,
  children,
}: {
  container: HTMLElement | null;
  children: ReactNode;
}) {
  return <PortalContainerContext.Provider value={container}>{children}</PortalContainerContext.Provider>;
}

/**
 * 지금 열려 있는 오버레이의 포탈 자리. **`PopoverContent` 하나가 이것을 읽는다** —
 * 화면·부품이 직접 부르면 자리가 다시 흩어진다.
 */
export function usePortalContainer(): HTMLElement | null {
  return useContext(PortalContainerContext);
}
