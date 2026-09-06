/**
 * **WS 인증 파이프라인**(FE §4-2 의 WS 판 · SPEC-007 §4 close code `4401`).
 *
 * - 연결되면 **첫 텍스트 프레임이 `auth` + access 토큰**이다
 * - `4401` → refresh **1회** → **재연결 1회**(두 번째 `WebSocket`) · 새 토큰으로 `auth`
 * - 두 번째도 `4401` → 세션 종료(로그인) · **세 번째 연결 없음**
 * - 그 밖의 close → 그대로 알린다 · 재연결 없음 · 호출자가 닫으면 `4401` 이어도 다시 열지 않는다
 * - `new WebSocket(` 은 `lib/api/ws.ts` 밖에 0건(정적 검사 — `static.test.ts`)
 */

import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openAuthenticatedSocket, type SocketCloseEvent } from "@/lib/api/ws";
import { tokenStore } from "@/lib/auth/tokenStore";
import { setSessionEndHandler } from "@/lib/auth/sessionEvents";
import { FakeWebSocket } from "@/test/fakeWebSocket";
import { API_BASE, server } from "@/test/server";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  FakeWebSocket.reset();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  tokenStore.setAccess("A1");
});

afterEach(async () => {
  vi.unstubAllGlobals();
  setSessionEndHandler(null);
  await tokenStore.clear();
});

describe("첫 프레임 · 주소", () => {
  it("`ws://<apiBase>/api/meetings/21/stream` 을 열고 **첫 텍스트 프레임이 `auth` + access 토큰**이다", async () => {
    const onMessage = vi.fn();
    openAuthenticatedSocket({
      path: "/api/meetings/21/stream",
      authFrame: (accessToken) => ({ type: "auth", accessToken, audio: { format: "auto", sampleRate: 48000, channels: 1 } }),
      onMessage,
      onClose: vi.fn(),
    });
    await flush();

    expect(FakeWebSocket.instances).toHaveLength(1);
    const ws = FakeWebSocket.last;
    expect(ws.url).toBe("ws://localhost:8000/api/meetings/21/stream");
    expect(ws.sent).toHaveLength(0);

    ws.serverOpen();
    expect(ws.sentFrames).toEqual([{ type: "auth", accessToken: "A1", audio: { format: "auto", sampleRate: 48000, channels: 1 } }]);

    ws.serverSend({ type: "ready", recordingStartedAt: "2026-08-27T00:31:00Z", latestBatchSeq: 0, speakerCount: 0 });
    expect(onMessage).toHaveBeenCalledWith({ type: "ready", recordingStartedAt: "2026-08-27T00:31:00Z", latestBatchSeq: 0, speakerCount: 0 });
  });
});

describe("4401 — refresh 1회 → 재연결 1회 → 또 4401 이면 로그인", () => {
  it("만료 토큰으로 `4401` 이 오면 갱신 뒤 **두 번째 소켓**을 열고 새 토큰으로 `auth` 를 보낸다", async () => {
    await tokenStore.set("R1", false);
    let refreshes = 0;
    server.use(
      http.post(`${API_BASE}/api/auth/refresh`, () => {
        refreshes += 1;
        return HttpResponse.json({ accessToken: "A2", expiresIn: 900, refreshToken: "R2" });
      }),
    );
    const onClose = vi.fn();
    openAuthenticatedSocket({
      path: "/api/meetings/21/stream",
      authFrame: (accessToken) => ({ type: "auth", accessToken }),
      onMessage: vi.fn(),
      onClose,
    });
    await flush();
    const first = FakeWebSocket.last;
    first.serverOpen();
    first.serverClose(4401, "unauthorized");
    await flush();
    await flush();

    expect(refreshes).toBe(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(onClose).not.toHaveBeenCalled();
    const second = FakeWebSocket.last;
    second.serverOpen();
    expect(second.sentFrames).toEqual([{ type: "auth", accessToken: "A2" }]);
  });

  it("두 번째도 `4401` 이면 **세션 종료 + 세 번째 연결 없음**", async () => {
    await tokenStore.set("R1", false);
    server.use(
      http.post(`${API_BASE}/api/auth/refresh`, () =>
        HttpResponse.json({ accessToken: "A2", expiresIn: 900, refreshToken: "R2" }),
      ),
    );
    const ended = vi.fn();
    setSessionEndHandler(ended);
    const closes: SocketCloseEvent[] = [];
    openAuthenticatedSocket({
      path: "/api/meetings/21/stream",
      authFrame: (accessToken) => ({ type: "auth", accessToken }),
      onMessage: vi.fn(),
      onClose: (event) => closes.push(event),
    });
    await flush();
    FakeWebSocket.last.serverOpen();
    FakeWebSocket.last.serverClose(4401, "unauthorized");
    await flush();
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(2);

    // 갱신 자체를 거부시킨다 — 두 번째 4401 뒤에는 갱신도 연결도 없다.
    server.use(
      http.post(`${API_BASE}/api/auth/refresh`, () =>
        HttpResponse.json({ detail: "만료", code: "invalid_refresh_token" }, { status: 401 }),
      ),
    );
    FakeWebSocket.last.serverOpen();
    FakeWebSocket.last.serverClose(4401, "unauthorized");
    await flush();
    await flush();

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(closes).toEqual([{ code: 4401, reason: "unauthorized", authFailed: true }]);
    expect(ended).toHaveBeenCalledWith("expired");
  });
});

describe("그 밖의 close — 재연결 없음", () => {
  it("`1011` 로 닫히면 그대로 알리고 **새 소켓을 만들지 않는다**", async () => {
    const onClose = vi.fn();
    openAuthenticatedSocket({ path: "/api/meetings/21/stream", authFrame: (t) => ({ t }), onMessage: vi.fn(), onClose });
    await flush();
    FakeWebSocket.last.serverOpen();
    FakeWebSocket.last.serverClose(1011, "meeting_stream_disconnected");
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(onClose).toHaveBeenCalledWith({ code: 1011, reason: "meeting_stream_disconnected", authFailed: false });
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("호출자가 `close()` 하면 `4401` 이어도 다시 열지 않고, 열리기 전 `send` 는 버린다", async () => {
    const onClose = vi.fn();
    const handle = openAuthenticatedSocket({ path: "/api/meetings/21/stream", authFrame: (t) => ({ t }), onMessage: vi.fn(), onClose });
    await flush();
    handle.send("dropped");
    expect(FakeWebSocket.last.sent).toHaveLength(0);
    expect(handle.isOpen).toBe(false);

    handle.close(1000, "leave");
    expect(FakeWebSocket.last.clientClosed).toEqual({ code: 1000, reason: "leave" });
    expect(onClose).toHaveBeenCalledWith({ code: 1000, reason: "leave", authFailed: false });
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
