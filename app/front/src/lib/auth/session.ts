/**
 * 로그인 · 부트스트랩 · 로그아웃 — **세션 상태를 바꾸는 동작만** 여기 있다
 * (frontend/README.md §2 디렉토리 구조 `lib/auth/session.ts`).
 *
 * 저장소를 직접 만지지 않는다 — `tokenStore` 를 부른다. 요청도 직접 만들지 않는다 —
 * `apiFetch` 를 지난다.
 */

import { apiFetch } from "@/lib/api/client";
import { tokenStore } from "@/lib/auth/tokenStore";
import type { LoginRequest, SessionResponse, TokenBundle } from "@/types/api";

/**
 * 화면이 「자격 증명 실패」와 **키체인 실패**를 갈라 안내할 수 있게 여기서 다시 내보낸다.
 * 그래야 컴포넌트가 `tokenStore` 를 직접 import 하지 않는다(§4-1 경계 유지).
 */
export { KeychainError } from "@/lib/auth/tokenStore";

/**
 * 아이디·비밀번호로 세션을 연다.
 *
 * `persist` 는 **요청에 싣지 않는다** — 서버는 저장 위치를 모른다(SPEC-001 §4).
 * refresh 수명은 언제나 7일이고, 어디에 두느냐만 클라이언트가 정한다.
 */
export async function login(credentials: LoginRequest, persist: boolean): Promise<void> {
  const bundle = await apiFetch<TokenBundle>("/api/auth/login", {
    method: "POST",
    body: credentials,
    publicSurface: true,
  });

  tokenStore.setAccess(bundle.accessToken);

  try {
    // 「유지」 체크인데 키체인에 못 쓰면 여기서 던진다(거부·셸 없음) —
    // 조용히 메모리로 떨어뜨리지 않는다(DEC-001 §4, 2026-09-05 개정).
    await tokenStore.set(bundle.refreshToken, persist);
  } catch (error) {
    // **반쯤 로그인된 상태로 남기지 않는다.** 메모리에 올린 토큰까지 걷어내고 사유를 올린다.
    await tokenStore.clear().catch(() => undefined);
    throw error;
  }
}

/**
 * 「유지」로 로그인한 세션인가 — 로그아웃 확인 모달의 **경고 슬롯이 이 값으로 갈린다**(U-5).
 * 화면이 `tokenStore` 를 직접 부르지 않도록 여기서 한 번 감싼다.
 */
export function isSessionPersistent(): boolean {
  return tokenStore.isPersistent();
}

/** 현재 세션의 계정 요약. 게이트 안이라 Bearer 가 붙는다. */
export function fetchSession(): Promise<SessionResponse> {
  return apiFetch<SessionResponse>("/api/auth/session", { cache: "no-store" });
}

/**
 * 앱을 켠 직후 **보관된 refresh 가 있는지** 확인한다.
 *
 * 키체인을 읽어 메모리로 올리고, 값이 있으면 「유지」로 로그인한 세션임을 함께 복원한다.
 * 값이 없으면 세션 가드는 **요청을 하나도 보내지 않고** 로그인 화면으로 간다.
 */
export async function restoreSession(): Promise<boolean> {
  await tokenStore.load();
  return (await tokenStore.get()) !== null;
}

/**
 * 로그아웃.
 *
 * **서버 요청이 실패해도 클라이언트 토큰은 반드시 지운다** — 로그아웃이 반쯤 된 상태로
 * 남지 않는다(SPEC-001 §5 로그아웃). 실패는 삼키지 않고 호출자에게 알린다(토스트용).
 *
 * 지운 뒤에는 **갱신을 재시도하지 않는다.** 무효화된 refresh 를 다시 보내면 재사용 감지가
 * 걸려 그 계정의 유효 세션이 전부 끊긴다(A-7).
 */
export async function logout(): Promise<{
  serverAcknowledged: boolean;
  /** 키체인에서 실제로 지웠나. 실패해도 **메모리는 비었고** 로그인 화면으로 간다. */
  storeCleared: boolean;
}> {
  const hasRefreshToken = (await tokenStore.get()) !== null;

  let serverAcknowledged = false;
  if (hasRefreshToken) {
    try {
      await apiFetch<void>("/api/auth/logout", {
        method: "POST",
        /**
         * **미리 캡처하지 않는다.** 이 요청이 access 만료를 만나면 파이프라인이 갱신을 태워
         * refresh 를 **회전**시키는데(`R1 → R2`), 캡처해 둔 `R1` 을 보내면 서버는 이미
         * `revoked_at` 이 찍힌 토큰을 받아 **아무것도 하지 않고 204** 를 준다 — 화면은
         * 「로그아웃 완료」인데 `R2` 세션이 7일간 살아남는다(검수 F-3 · SPEC-001 §5).
         *
         * 그래서 **시도마다 다시 읽는다.** 재시도 본문에는 회전된 `R2` 가 실린다.
         */
        bodyFactory: async () => ({ refreshToken: await tokenStore.get() }),
      });
      serverAcknowledged = true;
    } catch {
      // 사유를 가리지 않되 흐름은 멈추지 않는다 — 아래 clear() 는 반드시 지난다.
      serverAcknowledged = false;
    }
  }

  // 키체인 삭제가 실패해도 **메모리는 이미 비었고** 화면은 로그인으로 가야 한다.
  let storeCleared = true;
  try {
    await tokenStore.clear();
  } catch {
    storeCleared = false;
  }

  return { serverAcknowledged, storeCleared };
}
