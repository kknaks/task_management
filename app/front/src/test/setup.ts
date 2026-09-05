import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { server } from "@/test/server";
import { keychain } from "@/test/tauriMock";

/**
 * `tokenStore` 가 무는 셸 API 를 **모듈 목**으로 세운다(검수 F-2 가 지시한 방식).
 * 목 구현은 `src/test/tauriMock.ts` 가 갖는다 — 거기에 키체인 흉내 저장소가 있다.
 */
vi.mock("@tauri-apps/api/core", async () => {
  const mod = await import("@/test/tauriMock");
  return { invoke: mod.invoke };
});

/**
 * 네트워크는 **MSW 로 `client.ts` 아래에서** 가로챈다(§11). 핸들러에 없는 요청은
 * `error` 로 세운다 — 「이 요청은 나가면 안 된다」를 조용히 통과시키지 않기 위해서다.
 */
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

afterEach(() => {
  server.resetHandlers();
  cleanup();
  keychain.reset();
  keychain.removeShell();
});

afterAll(() => server.close());
