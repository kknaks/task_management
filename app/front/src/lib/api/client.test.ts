/**
 * **필수 테스트 ④ — 401 갱신**(`frontend/README.md` §11 4).
 *
 * > 만료 → refresh 1회 → 원 요청 재시도. **두 번째 401 이면 로그인으로 가고 루프가 없다.**
 *
 * 여기에 **검수 F-3 의 회귀 테스트**를 함께 둔다 — 「로그아웃이 회전 뒤에도 서버 세션을 끊는다」.
 * 같은 결함이 다시 들어오면 이 파일이 먼저 깨진다.
 *
 * 목으로 바꾼 것은 **셸의 키체인 하나**뿐이다. 파이프라인은 실물 그대로 MSW 아래를 지난다(§11).
 */

import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import { logout } from "@/lib/auth/session";
import { setSessionEndHandler, type SessionEndReason } from "@/lib/auth/sessionEvents";
import { tokenStore } from "@/lib/auth/tokenStore";
import { API_BASE, server } from "@/test/server";

/** 세션이 끝났다는 통지를 받는 자리. 실제로는 `(app)/layout.tsx` 가 로그인으로 보낸다. */
let sessionEnds: SessionEndReason[] = [];

beforeEach(async () => {
  sessionEnds = [];
  setSessionEndHandler((reason) => sessionEnds.push(reason));
  await tokenStore.clear();
});

afterEach(() => setSessionEndHandler(null));

describe("④ 401 갱신 — 갱신 1회 + 재시도 1회, 루프 없음", () => {
  it("access 가 만료되면 refresh 1회 뒤 원 요청을 재시도하고 성공한다", async () => {
    const refreshCalls = vi.fn();
    let sessionCalls = 0;

    server.use(
      http.post(`${API_BASE}/api/auth/refresh`, async ({ request }) => {
        refreshCalls();
        const body = (await request.json()) as { refreshToken: string };
        expect(body.refreshToken).toBe("R1");
        return HttpResponse.json({ accessToken: "A2", expiresIn: 3600, refreshToken: "R2" });
      }),
      http.get(`${API_BASE}/api/auth/session`, ({ request }) => {
        sessionCalls += 1;
        // 첫 시도는 만료된 access 라 401, 갱신 뒤 재시도는 통과한다.
        if (request.headers.get("Authorization") !== "Bearer A2") {
          return HttpResponse.json({ detail: "세션이 만료되었습니다", code: "token_expired" }, { status: 401 });
        }
        return HttpResponse.json({ account: { id: 1 } });
      }),
    );

    tokenStore.setAccess("A1-expired");
    await tokenStore.set("R1", false);

    await expect(apiFetch("/api/auth/session")).resolves.toEqual({ account: { id: 1 } });

    expect(refreshCalls).toHaveBeenCalledTimes(1); // 갱신은 1회
    expect(sessionCalls).toBe(2); //             원 요청 + 재시도 1회, 그 이상 없음
    expect(sessionEnds).toEqual([]); //           로그인으로 보내지 않는다
    // **회전** — 받은 refresh 로 즉시 교체됐다(SPEC-001 §5 토큰 취급)
    await expect(tokenStore.get()).resolves.toBe("R2");
  });

  it("재시도도 401 이면 토큰을 버리고 로그인으로 보낸다 — 갱신이 반복되지 않는다", async () => {
    const refreshCalls = vi.fn();
    let sessionCalls = 0;

    server.use(
      http.post(`${API_BASE}/api/auth/refresh`, () => {
        refreshCalls();
        return HttpResponse.json({ accessToken: "A2", expiresIn: 3600, refreshToken: "R2" });
      }),
      // 갱신을 해도 계속 401 인 서버 — 루프가 생기면 이 핸들러가 무한히 불린다.
      http.get(`${API_BASE}/api/auth/session`, () => {
        sessionCalls += 1;
        return HttpResponse.json({ detail: "세션이 만료되었습니다", code: "token_expired" }, { status: 401 });
      }),
    );

    tokenStore.setAccess("A1-expired");
    await tokenStore.set("R1", false);

    await expect(apiFetch("/api/auth/session")).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.code === "invalid_refresh_token",
    );

    expect(refreshCalls).toHaveBeenCalledTimes(1); // **1회뿐** — 무한 갱신 루프가 없다
    expect(sessionCalls).toBe(2); //                원 요청 + 재시도, 그 이상 없음
    expect(sessionEnds).toEqual(["expired"]); //    로그인 화면으로 + 만료 토스트
    await expect(tokenStore.get()).resolves.toBeNull(); // 토큰 전부 폐기
    expect(tokenStore.getAccess()).toBeNull();
  });

  it("동시에 여러 요청이 401 을 받아도 갱신은 한 번만 나간다", async () => {
    const refreshCalls = vi.fn();

    server.use(
      http.post(`${API_BASE}/api/auth/refresh`, async () => {
        refreshCalls();
        // 늦게 응답해 「진행 중 Promise 공유」가 실제로 겹치게 만든다.
        await new Promise((resolve) => setTimeout(resolve, 20));
        return HttpResponse.json({ accessToken: "A2", expiresIn: 3600, refreshToken: "R2" });
      }),
      http.get(`${API_BASE}/api/auth/session`, ({ request }) =>
        request.headers.get("Authorization") === "Bearer A2"
          ? HttpResponse.json({ account: { id: 1 } })
          : HttpResponse.json({ detail: "세션이 만료되었습니다", code: "token_expired" }, { status: 401 }),
      ),
    );

    tokenStore.setAccess("A1-expired");
    await tokenStore.set("R1", false);

    await Promise.all([
      apiFetch("/api/auth/session"),
      apiFetch("/api/auth/session"),
      apiFetch("/api/auth/session"),
    ]);

    expect(refreshCalls).toHaveBeenCalledTimes(1);
  });

  it("refresh 가 애초에 없으면 요청도 갱신도 나가지 않고 조용히 로그인으로 간다", async () => {
    // 핸들러를 하나도 붙이지 않는다 — 요청이 나가면 `onUnhandledRequest:"error"` 가 세운다.
    await expect(apiFetch("/api/auth/session")).rejects.toThrow();

    // 「유지」 미체크로 로그인한 뒤 앱 재시작이 이 경로다. **만료 토스트를 띄우지 않는다**(U-7).
    expect(sessionEnds).toEqual(["absent"]);
  });
});

describe("F-3 회귀 — 로그아웃은 회전 뒤에도 서버 세션을 끊는다", () => {
  it("access 만료로 refresh 가 회전하면, 로그아웃 본문에 회전된 새 refresh 가 실린다", async () => {
    const logoutBodies: (string | null)[] = [];

    server.use(
      http.post(`${API_BASE}/api/auth/refresh`, async ({ request }) => {
        const body = (await request.json()) as { refreshToken: string };
        // 서버는 쓴 토큰을 즉시 무효화하고 새 토큰을 준다(A-7 회전).
        expect(body.refreshToken).toBe("R1");
        return HttpResponse.json({ accessToken: "A2", expiresIn: 3600, refreshToken: "R2" });
      }),
      http.post(`${API_BASE}/api/auth/logout`, async ({ request }) => {
        const body = (await request.json()) as { refreshToken: string | null };
        logoutBodies.push(body.refreshToken);
        // 만료된 access 로는 게이트를 못 지난다 — 파이프라인이 갱신을 태우게 만드는 조건.
        if (request.headers.get("Authorization") !== "Bearer A2") {
          return HttpResponse.json({ detail: "세션이 만료되었습니다", code: "token_expired" }, { status: 401 });
        }
        return new HttpResponse(null, { status: 204 });
      }),
    );

    // SPEC-001 S-5 — 앱을 1시간 이상 켜 둔 상태. access 는 메모리에 있지만 서버에서는 만료다.
    tokenStore.setAccess("A1-expired");
    await tokenStore.set("R1", false);

    const result = await logout();

    expect(result.serverAcknowledged).toBe(true);
    // 시도 2회: 첫 요청(만료 access) + 갱신 뒤 재시도.
    expect(logoutBodies).toHaveLength(2);
    // **핵심** — 재시도 본문이 회전된 `R2` 다. `R1` 이면 서버가 무효 토큰을 받아
    // 아무것도 하지 않고 204 를 주고 `R2` 세션이 7일간 살아남는다(검수 F-3).
    expect(logoutBodies[1]).toBe("R2");
    // 클라이언트 토큰은 전부 비었다.
    await expect(tokenStore.get()).resolves.toBeNull();
    expect(tokenStore.getAccess()).toBeNull();
  });

  it("access 가 유효하면 갱신 없이 지금 refresh 를 그대로 끊는다", async () => {
    const logoutBodies: (string | null)[] = [];
    const refreshCalls = vi.fn();

    server.use(
      http.post(`${API_BASE}/api/auth/refresh`, () => {
        refreshCalls();
        return HttpResponse.json({ accessToken: "A2", expiresIn: 3600, refreshToken: "R2" });
      }),
      http.post(`${API_BASE}/api/auth/logout`, async ({ request }) => {
        logoutBodies.push(((await request.json()) as { refreshToken: string }).refreshToken);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    tokenStore.setAccess("A1");
    await tokenStore.set("R1", false);

    await logout();

    expect(refreshCalls).not.toHaveBeenCalled(); // 불필요한 회전을 만들지 않는다
    expect(logoutBodies).toEqual(["R1"]);
  });

  it("로그아웃 뒤에는 갱신을 재시도하지 않는다 — 재사용 감지를 부르지 않는다", async () => {
    server.use(
      http.post(`${API_BASE}/api/auth/logout`, () => new HttpResponse(null, { status: 204 })),
    );

    tokenStore.setAccess("A1");
    await tokenStore.set("R1", false);
    await logout();

    // 이 시점에 refresh 핸들러는 붙어 있지 않다. 갱신이 나가면 `onUnhandledRequest:"error"` 가
    // 세운다 — 무효화된 refresh 를 다시 보내면 그 계정의 세션이 전부 끊긴다(A-7).
    await expect(apiFetch("/api/auth/session")).rejects.toThrow();
    expect(sessionEnds).toEqual(["absent"]);
  });
});
