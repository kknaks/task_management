/**
 * 「세션이 끝났다」를 화면에 알리는 자리 하나.
 *
 * `lib/api/client.ts` 는 갱신에 실패하면 **로그인 화면으로 보내야 하는데**(FE §4-2 3),
 * 정적 빌드라 라우팅은 컴포넌트 훅(`useRouter`)만 할 수 있다. 그렇다고 client 가
 * `session.ts` 를 import 하면 순환이 된다(session → client → session).
 *
 * 그래서 **핸들러 등록 지점만** 여기 따로 둔다. 등록은 `(app)/layout.tsx` 의 세션 가드가
 * 한 번 하고, client 는 이유만 통지한다.
 */

/**
 * - `absent` — 애초에 refresh 토큰이 없다. 「유지」 미체크로 로그인한 뒤 앱을 다시 켠 경우가
 *   여기다. **만료 토스트를 띄우지 않는다**(SPEC-001 U-7 — 정상 동작이다)
 * - `expired` — refresh 가 거부됐다(만료·재사용 감지). 토스트를 띄운다
 */
export type SessionEndReason = "absent" | "expired";

type SessionEndHandler = (reason: SessionEndReason) => void;

let handler: SessionEndHandler | null = null;

export function setSessionEndHandler(next: SessionEndHandler | null): void {
  handler = next;
}

export function notifySessionEnd(reason: SessionEndReason): void {
  handler?.(reason);
}
