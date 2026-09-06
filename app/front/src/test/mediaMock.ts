/**
 * **마이크·녹음 대역** — `getUserMedia` · `MediaRecorder` · 트랙 `ended`.
 *
 * 브라우저 규약을 따른다: `track.stop()` 은 **`ended` 를 내지 않는다**(우리가 놓는 트랙). 장치가 빠지는 것은 `unplug()` 가 흉내 낸다.
 * `installMedia()` 가 전역을 세우고 `restore` 로 되돌린다.
 */

import { vi } from "vitest";

export class FakeTrack extends EventTarget {
  readonly kind = "audio";
  readyState: "live" | "ended" = "live";

  stop(): void {
    this.readyState = "ended";
  }

  /** 장치 분리 — `ended` 이벤트가 난다(SPEC-007 S-7). */
  unplug(): void {
    this.readyState = "ended";
    this.dispatchEvent(new Event("ended"));
  }
}

export class FakeMediaStream {
  readonly tracks: FakeTrack[];

  constructor() {
    this.tracks = [new FakeTrack()];
  }

  getAudioTracks(): FakeTrack[] {
    return this.tracks;
  }

  getTracks(): FakeTrack[] {
    return this.tracks;
  }
}

export class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported(): boolean {
    return true;
  }

  state: "inactive" | "recording" | "paused" = "inactive";
  readonly stream: FakeMediaStream;
  readonly mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;

  constructor(stream: FakeMediaStream, options?: { mimeType?: string }) {
    this.stream = stream;
    this.mimeType = options?.mimeType ?? "";
    FakeMediaRecorder.instances.push(this);
  }

  start(): void {
    this.state = "recording";
  }
  pause(): void {
    this.state = "paused";
  }
  resume(): void {
    this.state = "recording";
  }
  stop(): void {
    this.state = "inactive";
  }

  /** 인코딩된 조각 하나가 나왔다. */
  emit(size = 1200): void {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(size)]) });
  }
}

export function installMedia(): {
  streams: FakeMediaStream[];
  getUserMedia: ReturnType<typeof vi.fn>;
  /** 다음 `getUserMedia` 한 번을 거부시킨다(권한 거부·장치 없음). */
  failNext: () => void;
  restore: () => void;
} {
  const streams: FakeMediaStream[] = [];
  let fail = false;
  const getUserMedia = vi.fn(async () => {
    if (fail) {
      fail = false;
      throw new DOMException("Permission denied", "NotAllowedError");
    }
    const stream = new FakeMediaStream();
    streams.push(stream);
    return stream as unknown as MediaStream;
  });

  const previousMediaDevices = navigator.mediaDevices;
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  FakeMediaRecorder.instances = [];

  return {
    streams,
    getUserMedia,
    failNext: () => {
      fail = true;
    },
    restore: () => {
      Object.defineProperty(navigator, "mediaDevices", { value: previousMediaDevices, configurable: true });
      vi.unstubAllGlobals();
    },
  };
}
