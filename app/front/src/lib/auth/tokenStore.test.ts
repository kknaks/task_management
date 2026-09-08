/**
 * **필수 테스트 ⑤ — 토큰 저장소 격리**(`frontend/README.md` §11 5).
 *
 * > `persist=false` 로 로그인하면 저장소에 **아무것도 남지 않는다.**
 *
 * 정적 검사 쪽(「`tokenStore` 밖에서 저장소 API 를 부르는 코드가 없다」)은 ESLint
 * `no-restricted-globals`/`-properties` + 파일 예외가 이미 막고 있다. 여기서 세우는 것은
 * **동작** 쪽이다 — 실제로 키체인에 무엇이 남는가.
 *
 * `@tauri-apps/api/core` 는 모듈 목이고(`src/test/setup.ts`), 목 안의 저장소를 직접 들여다본다.
 */

import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { KeychainError, login, logout, restoreSession } from "@/lib/auth/session";
import { tokenStore } from "@/lib/auth/tokenStore";
import { API_BASE, server } from "@/test/server";
import { keychain } from "@/test/tauriMock";

const CREDENTIALS = { loginId: "kknaks", password: "dev1234!" };

function stubLogin() {
  server.use(
    http.post(`${API_BASE}/api/auth/login`, () =>
      HttpResponse.json({ accessToken: "A1", expiresIn: 3600, refreshToken: "R1" }),
    ),
  );
}

beforeEach(async () => {
  await tokenStore.clear();
  keychain.reset();
});

describe("⑤ 토큰 저장소 격리", () => {
  it("persist=false 로 로그인하면 키체인에 아무것도 남지 않는다", async () => {
    keychain.installShell();
    stubLogin();

    await login(CREDENTIALS, false);

    // **저장소가 비어 있다** — 앱을 끄면 사라져 로그아웃된다(DEC-001 §4).
    expect(keychain.peek()).toBeNull();
    expect(keychain.callLog()).not.toContain("keychain_set_refresh_token");
    // 그래도 이 실행 동안은 메모리에서 세션이 산다.
    await expect(tokenStore.get()).resolves.toBe("R1");
    expect(tokenStore.isPersistent()).toBe(false);
  });

  it("persist=true 로 로그인하면 refresh 가 키체인에 들어간다 — access 는 넣지 않는다", async () => {
    keychain.installShell();
    stubLogin();

    await login(CREDENTIALS, true);

    expect(keychain.peek()).toBe("R1");
    // **access 토큰은 저장소에 넣지 않는다**(DEC-001 §4). 메모리에만 있다.
    expect(keychain.peek()).not.toBe("A1");
    expect(tokenStore.getAccess()).toBe("A1");
    expect(tokenStore.isPersistent()).toBe(true);
  });

  it("persist=false 는 키체인에 남아 있던 옛 값을 지운다 — 「유지」를 끈 것이 곧 삭제다", async () => {
    keychain.installShell();
    stubLogin();

    await login(CREDENTIALS, true);
    expect(keychain.peek()).toBe("R1");

    await tokenStore.clear();
    await login(CREDENTIALS, false);

    expect(keychain.peek()).toBeNull();
  });

  it("셸이 없는데 persist=true 면 던진다 — 브라우저 저장소로 조용히 떨어뜨리지 않는다", async () => {
    // 셸을 설치하지 않는다(브라우저에서 연 상태).
    stubLogin();

    await expect(login(CREDENTIALS, true)).rejects.toBeInstanceOf(KeychainError);

    // **반쯤 로그인된 상태를 남기지 않는다** — 메모리 토큰까지 걷어낸다.
    expect(tokenStore.getAccess()).toBeNull();
    await expect(tokenStore.get()).resolves.toBeNull();
  });

  it("로그아웃하면 키체인이 비고, 다시 켜도 복원할 것이 없다", async () => {
    keychain.installShell();
    stubLogin();
    server.use(
      http.post(`${API_BASE}/api/auth/logout`, () => new HttpResponse(null, { status: 204 })),
    );

    await login(CREDENTIALS, true);
    expect(keychain.peek()).toBe("R1");

    const result = await logout();

    expect(result.serverAcknowledged).toBe(true);
    expect(result.storeCleared).toBe(true);
    expect(keychain.peek()).toBeNull();
    // 앱을 다시 켠 것과 같은 상태 — 복원할 refresh 가 없다.
    await expect(restoreSession()).resolves.toBe(false);
  });

  it("앱을 다시 켜면 키체인에 남은 refresh 를 복원한다 — access 는 다시 받는다", async () => {
    keychain.installShell();

    // 앱 재시작 직후 상태: 메모리는 비었고 키체인에만 지난 실행의 refresh 가 남아 있다.
    await tokenStore.clear();
    keychain.seed("R1");

    await expect(restoreSession()).resolves.toBe(true);
    await expect(tokenStore.get()).resolves.toBe("R1");
    // 키체인에 값이 있었다 = 「유지」로 로그인한 세션이다. 회전 시 되쓸 자리가 이 값으로 갈린다.
    expect(tokenStore.isPersistent()).toBe(true);
    // **access 는 저장소에 없다** — 갱신으로 다시 받는다(DEC-001 §4).
    expect(tokenStore.getAccess()).toBeNull();
  });

  it("키체인이 비어 있으면 복원할 것이 없고 요청도 나가지 않는다", async () => {
    keychain.installShell();
    await tokenStore.clear();

    await expect(restoreSession()).resolves.toBe(false);
  });
});
