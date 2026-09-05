/**
 * fetch 래퍼 — **모든 호출이 이 파일을 지난다**(frontend/README.md §2 규칙 5).
 *
 * 이 파일 하나가 요청 파이프라인 전부를 한다(§4-2).
 *
 * 1. `Authorization: Bearer <access>` 부착. access 가 없으면 먼저 refresh 를 시도한다
 * 2. `401` → **갱신 1회** → 새 토큰 저장 → **원 요청 1회 재시도**
 * 3. 재시도도 401 이거나 갱신 자체가 실패하면 → `clear()` → 로그인 화면.
 *    **무한 갱신 루프를 만들지 않는다**(SYS §흐름 ① 규약 ①)
 * 4. 동시에 여러 요청이 401 을 받아도 **갱신은 한 번만** 나간다(진행 중 Promise 공유)
 * 5. 실패 응답은 `ApiError{status, code, detail}` 로 던진다 — 조용한 기본값으로 대체하지
 *    않는다(§3-5 · DEC-003 §7)
 */

import { env } from "@/lib/env";
import { ApiError, CLIENT_ERROR_CODE, isApiError, API_ERROR_CODE } from "@/lib/api/errors";
import { tokenStore } from "@/lib/auth/tokenStore";
import { notifySessionEnd, type SessionEndReason } from "@/lib/auth/sessionEvents";
import type { TokenBundle } from "@/types/api";

export interface ApiRequestInit extends Omit<RequestInit, "body"> {
  /** 고정 본문. 요청 도중 값이 바뀌지 않는 경우에 쓴다. */
  body?: unknown;
  /**
   * **요청 직전에** 본문을 만드는 콜백. **시도마다 다시 불린다**(첫 요청 · 갱신 후 재시도).
   *
   * 파이프라인이 **도중에 바꾸는 값**을 본문에 실어야 할 때 쓴다. 지금 유일한 사용처는
   * 로그아웃의 `refreshToken` 이다 — 401 을 만나면 갱신이 refresh 를 **회전**시키므로,
   * 미리 캡처한 옛 토큰을 보내면 서버가 이미 무효인 토큰을 받아 **아무것도 하지 않고 204** 를
   * 주고 새 세션이 살아남는다(검수 F-3 · SPEC-001 §4 API Contract · §5 로그아웃).
   *
   * `body` 와 함께 주면 이쪽이 이긴다.
   */
  bodyFactory?: () => unknown | Promise<unknown>;
  /**
   * 인증 게이트 **밖**의 표면인가(헬스·로그인·갱신 — SPEC-001 §4).
   * 기본은 `false` 다 — 새 화면이 토큰 부착을 잊는 쪽으로 기울지 않게 한다.
   */
  publicSurface?: boolean;
}

function buildUrl(path: string): string {
  return path.startsWith("http") ? path : `${env.apiBase}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * 요청이 서버에 **닿기는 했는지** 확인한다.
 *
 * `fetch` 는 CORS 차단과 「서버가 없다」를 똑같은 `TypeError` 로 던져 구분할 수 없다.
 * SPEC-000 §4 Case Matrix 가 그 둘을 **다른 문구**로 요구하므로(「서버가 응답하지 않습니다」 /
 * 「요청이 서버에서 거부되었습니다(CORS)」) 실패했을 때만 `mode:"no-cors"` 로 한 번 더 두드린다.
 * opaque 응답은 상태코드와 무관하게 resolve 하므로 **「닿았다 = CORS 문제」** 로 읽을 수 있다.
 *
 * 이건 **재시도가 아니라 진단**이다 — 성공 경로에서는 나가지 않고, 실패 경로에서도
 * 원 요청 자체를 다시 보내지 않는다(`retry:false` 계약을 건드리지 않는다).
 */
async function isServerReachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { method: "GET", mode: "no-cors", cache: "no-store" });
    return true;
  } catch {
    return false;
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  const fallbackDetail = `HTTP ${response.status}`;
  try {
    const payload: unknown = await response.json();
    if (payload && typeof payload === "object") {
      const body = payload as { detail?: unknown; code?: unknown };
      const detail = typeof body.detail === "string" ? body.detail : fallbackDetail;
      const code = typeof body.code === "string" ? body.code : `http_${response.status}`;
      return new ApiError(response.status, code, detail);
    }
  } catch {
    // 본문이 JSON 이 아니면 상태코드만 남는다 — 가리지 않고 그대로 올린다.
  }
  return new ApiError(response.status, `http_${response.status}`, fallbackDetail);
}

/** 토큰 부착·갱신을 뺀 **한 번의 왕복**. 재시도는 위층(`apiFetch`)이 정확히 1회만 시킨다. */
async function requestOnce<T>(
  path: string,
  init: Omit<ApiRequestInit, "publicSurface">,
  accessToken: string | null,
): Promise<T> {
  const url = buildUrl(path);
  const { body, headers, ...rest } = init;

  let response: Response;
  try {
    response = await fetch(url, {
      ...rest,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    const reachable = await isServerReachable(url);
    throw reachable
      ? new ApiError(0, CLIENT_ERROR_CODE.CORS_BLOCKED, "요청이 서버에서 거부되었습니다(CORS)")
      : new ApiError(
          0,
          CLIENT_ERROR_CODE.NETWORK_UNREACHABLE,
          `서버가 응답하지 않습니다 · ${env.apiBase}`,
        );
  }

  if (!response.ok) {
    throw await toApiError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/**
 * 갱신 결과 셋.
 *
 * `absent` 와 `rejected` 를 **가르는 이유**는 토스트 때문이다 — 「유지」 미체크로 로그인한 뒤
 * 앱을 다시 켠 경우는 refresh 가 애초에 없고, 그건 정상 동작이라 만료 토스트를 띄우지
 * 않는다(SPEC-001 U-7).
 */
type RefreshOutcome =
  | { kind: "ok"; accessToken: string }
  | { kind: "absent" }
  | { kind: "rejected" };

/** **진행 중인 갱신 Promise 를 공유한다** — 동시 401 이 와도 refresh 는 한 번만 나간다(§4-2 4). */
let refreshInFlight: Promise<RefreshOutcome> | null = null;

async function performRefresh(): Promise<RefreshOutcome> {
  const refreshToken = await tokenStore.get();
  if (!refreshToken) {
    // 로그아웃 직후도 여기다. **요청을 보내지 않는다** — 무효화된 refresh 를 다시 보내면
    // 재사용 감지가 걸려 그 계정의 세션이 전부 끊긴다(A-7).
    return { kind: "absent" };
  }

  try {
    const bundle = await requestOnce<TokenBundle>(
      "/api/auth/refresh",
      { method: "POST", body: { refreshToken } },
      null,
    );
    tokenStore.setAccess(bundle.accessToken);
    // **회전** — 받은 refresh 로 즉시 교체한다. 보관 위치는 그대로 유지한다(§5 토큰 취급).
    await tokenStore.set(bundle.refreshToken, tokenStore.isPersistent());
    return { kind: "ok", accessToken: bundle.accessToken };
  } catch {
    // 갱신 실패는 여기서 끝이다. **다시 시도하지 않는다**(무한 갱신 루프 금지).
    return { kind: "rejected" };
  }
}

async function refreshOnce(): Promise<RefreshOutcome> {
  if (refreshInFlight) {
    return refreshInFlight;
  }
  const run = performRefresh();
  refreshInFlight = run;
  try {
    return await run;
  } finally {
    refreshInFlight = null;
  }
}

/** 토큰을 전부 버리고 화면을 로그인으로 보낸다. 이유에 따라 토스트가 갈린다. */
async function endSession(reason: SessionEndReason): Promise<void> {
  try {
    await tokenStore.clear();
  } catch {
    // 키체인 삭제가 실패해도 **메모리는 이미 비었고** 화면은 로그인으로 가야 한다.
    // 여기서 멈추면 만료된 세션 화면에 갇힌다 — 이동을 막지 않는다.
  }
  notifySessionEnd(reason);
}

function sessionExpiredError(): ApiError {
  return new ApiError(
    401,
    API_ERROR_CODE.INVALID_REFRESH_TOKEN,
    "로그인이 만료되었습니다. 다시 로그인해 주세요.",
  );
}

export async function apiFetch<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const { publicSurface = false, bodyFactory, ...rest } = init;

  /**
   * 이번 **시도**의 본문. `bodyFactory` 가 있으면 시도마다 다시 만든다 — 갱신이 refresh 를
   * 회전시킨 뒤의 재시도에서 **새 토큰**이 실리게 하는 것이 이 함수의 존재 이유다(F-3).
   */
  const attemptInit = async (): Promise<Omit<ApiRequestInit, "publicSurface" | "bodyFactory">> =>
    bodyFactory ? { ...rest, body: await bodyFactory() } : rest;

  // 로그인·갱신·헬스는 게이트 밖이다 — 토큰을 붙이지 않고 갱신도 걸지 않는다.
  if (publicSurface) {
    return requestOnce<T>(path, await attemptInit(), null);
  }

  let accessToken = tokenStore.getAccess();

  // access 가 없으면 **먼저 갱신을 시도한다**(§4-2 1). 앱을 다시 켠 직후가 이 경로다.
  if (!accessToken) {
    const outcome = await refreshOnce();
    if (outcome.kind !== "ok") {
      await endSession(outcome.kind === "absent" ? "absent" : "expired");
      throw sessionExpiredError();
    }
    accessToken = outcome.accessToken;
  }

  try {
    // 본문은 **토큰을 확보한 뒤에** 만든다 — 위 갱신이 회전시킨 값이 반영돼야 한다.
    return await requestOnce<T>(path, await attemptInit(), accessToken);
  } catch (error) {
    if (!isApiError(error) || error.status !== 401) {
      throw error;
    }

    // 401 — **갱신 1회.** 사유는 보지 않는다(헤더없음·만료·위조가 전부 같은 코드로 온다).
    const outcome = await refreshOnce();
    if (outcome.kind !== "ok") {
      await endSession(outcome.kind === "absent" ? "absent" : "expired");
      throw sessionExpiredError();
    }

    try {
      // **원 요청 1회 재시도.** 본문을 **다시 만든다** — 방금 회전한 refresh 가 여기서 실린다.
      // 여기서 끝이고 더 돌지 않는다.
      return await requestOnce<T>(path, await attemptInit(), outcome.accessToken);
    } catch (retryError) {
      if (isApiError(retryError) && retryError.status === 401) {
        await endSession("expired");
        throw sessionExpiredError();
      }
      throw retryError;
    }
  }
}
