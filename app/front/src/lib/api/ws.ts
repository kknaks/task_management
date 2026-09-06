/**
 * **WS 를 여는 유일한 파일**(frontend/README.md §4-2 「WS 는 헤더를 못 붙인다 — 그 규약도 `lib/api` 안에 둔다」 · §8).
 *
 * `new WebSocket(` 은 이 파일 밖에 **0건**이다(WORK-007 정적 검사). 컴포넌트·훅은 `openAuthenticatedSocket` 을 부른다.
 *
 * ## 하는 것 — REST 파이프라인(`client.ts`)의 WS 판
 *
 * 1. `env.apiBase` 를 `ws(s)://` 로 바꿔 연다
 * 2. 연결되면 **첫 텍스트 프레임으로 access 토큰**을 보낸다(`authFrame(accessToken)` — 형태는 호출자가 정한다. SPEC-007 §4 `auth`)
 * 3. 서버가 `4401` 로 닫으면 **refresh 1회 → 재연결 1회**. 또 `4401` 이면 세션을 끝낸다(로그인으로) — 루프가 없다
 * 4. 그 밖의 close 는 호출자에게 그대로 알린다. **재연결하지 않는다**(DEC-003 §7 · BE-12) — 다시 여는 것은 사용자가 「재개」를 누를 때 호출자가 새로 부른다
 *
 * ## 하지 않는 것
 *
 * - 타이머 재접속 · 지수 백오프 · 핑 — 없다. 끊김은 끊김으로 드러낸다(SYS-8)
 * - 프레임 의미 해석 — 텍스트는 JSON 으로 풀어 넘길 뿐이다. `ready`·`transcript.*` 는 `useMeetingStream` 의 몫
 */

import { acquireAccessToken, expireSession, renewAccessToken } from "@/lib/api/client";
import { env } from "@/lib/env";

/** SPEC-007 §4 close code. 뜻은 호출자가 해석한다(`reason` 문자열에 코드가 실린다). */
export const WS_CLOSE = {
  /** 회의 종료로 서버가 닫음(SPEC-008) · 클라이언트가 스스로 닫음 */
  NORMAL: 1000,
  /** 첫 프레임 없음 · 토큰 무효·만료 — 이 파일이 갱신 1회로 삼킨다 */
  UNAUTHORIZED: 4401,
  /** 회의 없음 · 남의 것 */
  NOT_FOUND: 4404,
  /** `invalid_meeting_status` · `meeting_stream_active` — reason 문자열로 갈린다 */
  CONFLICT: 4409,
} as const;

export interface SocketCloseEvent {
  code: number;
  reason: string;
  /** `4401` 이 갱신 뒤에도 반복됐거나 갱신 자체가 실패했다 — 세션은 이미 끝났다(로그인으로 간다). */
  authFailed: boolean;
}

export interface AuthenticatedSocket {
  /** 열려 있을 때만 보낸다 — 열리기 전·닫힌 뒤의 프레임은 **버린다**(서버도 `ready` 전 오디오를 버린다). */
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
  /** 호출자가 닫는다. 이 뒤로는 `4401` 재시도도 하지 않는다. */
  close(code?: number, reason?: string): void;
  readonly isOpen: boolean;
}

export interface OpenSocketOptions<TFrame> {
  /** `/api/meetings/{id}/stream` 처럼 `/` 로 시작하는 경로. */
  path: string;
  /** 연결 직후 보낼 **첫 텍스트 프레임**. access 토큰을 실어 돌려준다. */
  authFrame: (accessToken: string) => unknown;
  /** 텍스트 프레임을 JSON 으로 푼 것. 바이너리는 오지 않는다(서버 → 클라이언트는 텍스트뿐). */
  onMessage: (frame: TFrame) => void;
  /** 연결이 열리고 인증 프레임을 보낸 직후. */
  onAuthSent?: () => void;
  /** 소켓이 닫혔다(어떤 이유든 한 번). `4401` 재시도가 남아 있으면 부르지 않는다. */
  onClose: (event: SocketCloseEvent) => void;
}

function socketUrl(path: string): string {
  return `${env.apiBase.replace(/^http/, "ws")}${path.startsWith("/") ? path : `/${path}`}`;
}

export function openAuthenticatedSocket<TFrame = unknown>(options: OpenSocketOptions<TFrame>): AuthenticatedSocket {
  let socket: WebSocket | null = null;
  let closedByCaller = false;
  let finished = false;

  const finish = (event: SocketCloseEvent) => {
    if (finished) {
      return;
    }
    finished = true;
    options.onClose(event);
  };

  const attach = (accessToken: string, retried: boolean) => {
    if (closedByCaller) {
      return;
    }
    const ws = new WebSocket(socketUrl(options.path));
    ws.binaryType = "arraybuffer";
    socket = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify(options.authFrame(accessToken)));
      options.onAuthSent?.();
    };

    ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") {
        return;
      }
      options.onMessage(JSON.parse(event.data) as TFrame);
    };

    ws.onclose = (event: CloseEvent) => {
      if (socket === ws) {
        socket = null;
      }
      if (closedByCaller) {
        finish({ code: event.code, reason: event.reason, authFailed: false });
        return;
      }
      if (event.code === WS_CLOSE.UNAUTHORIZED && !retried) {
        // **갱신 1회 → 재연결 1회.** REST 의 401 규칙과 같다(§4-2). 여기서 끝이고 더 돌지 않는다.
        void renewAccessToken().then((token) => {
          if (token === null || closedByCaller) {
            finish({ code: event.code, reason: event.reason, authFailed: token === null });
            return;
          }
          attach(token, true);
        });
        return;
      }
      if (event.code === WS_CLOSE.UNAUTHORIZED) {
        // 갱신 뒤에도 `4401` — 세션을 끝내고 로그인으로. 세 번째 연결은 없다.
        void expireSession().finally(() => finish({ code: event.code, reason: event.reason, authFailed: true }));
        return;
      }
      finish({ code: event.code, reason: event.reason, authFailed: false });
    };
  };

  void acquireAccessToken().then((token) => {
    if (token === null) {
      finish({ code: WS_CLOSE.UNAUTHORIZED, reason: "unauthorized", authFailed: true });
      return;
    }
    attach(token, false);
  });

  return {
    send(data) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(data);
      }
    },
    close(code = WS_CLOSE.NORMAL, reason = "") {
      closedByCaller = true;
      if (socket) {
        socket.close(code, reason);
      } else {
        // 아직 토큰을 받는 중이거나 이미 닫혔다 — 열리지 않게만 막고 끝낸다.
        finish({ code, reason, authFailed: false });
      }
    },
    get isOpen() {
      return socket !== null && socket.readyState === WebSocket.OPEN;
    },
  };
}
