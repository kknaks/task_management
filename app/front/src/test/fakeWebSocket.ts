/**
 * **대역 WebSocket** — `lib/api/ws.ts` 가 `new WebSocket(` 으로 만드는 것을 테스트가 가로챈다(`vi.stubGlobal("WebSocket", FakeWebSocket)`).
 *
 * 생성된 인스턴스를 세는 것이 곧 **재연결 스파이**다 — 「`error{upstream}` 뒤 새 연결 0건 · `resume()` 때만 +1」(WP Phase 5 검증).
 * 서버 쪽 동작(`serverOpen` · `serverSend` · `serverClose`)은 테스트가 직접 부른다. 이벤트는 동기로 쏜다 — 호출자가 `act` 로 감싼다.
 */

type Listener<E> = ((event: E) => void) | null;

export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static instances: FakeWebSocket[] = [];

  static reset(): void {
    FakeWebSocket.instances = [];
  }

  static get last(): FakeWebSocket {
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) {
      throw new Error("아직 열린 WebSocket 이 없다");
    }
    return ws;
  }

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readonly url: string;
  readyState = 0;
  binaryType: "blob" | "arraybuffer" = "blob";
  /** 클라이언트가 보낸 프레임 전부(텍스트·바이너리). */
  readonly sent: Array<string | Blob | ArrayBufferLike | ArrayBufferView> = [];
  /** 클라이언트가 `close()` 를 불렀나 — 코드·사유. */
  clientClosed: { code: number; reason: string } | null = null;

  onopen: Listener<Event> = null;
  onmessage: Listener<MessageEvent> = null;
  onclose: Listener<CloseEvent> = null;
  onerror: Listener<Event> = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string | Blob | ArrayBufferLike | ArrayBufferView): void {
    if (this.readyState !== FakeWebSocket.OPEN) {
      throw new Error("열리지 않은 소켓에 보냈다");
    }
    this.sent.push(data);
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === FakeWebSocket.CLOSED) {
      return;
    }
    this.clientClosed = { code, reason };
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason } as CloseEvent);
  }

  /** 텍스트 프레임만 JSON 으로 풀어 돌려준다(`auth` · `pause` · `resume`). */
  get sentFrames(): Array<Record<string, unknown>> {
    return this.sent
      .filter((frame): frame is string => typeof frame === "string")
      .map((frame) => JSON.parse(frame) as Record<string, unknown>);
  }

  /** 바이너리(오디오) 프레임 수. */
  get sentBinaryCount(): number {
    return this.sent.filter((frame) => typeof frame !== "string").length;
  }

  // --- 서버 쪽 ----------------------------------------------------------

  serverOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  serverSend(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
  }

  serverClose(code: number, reason = ""): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason } as CloseEvent);
  }
}
