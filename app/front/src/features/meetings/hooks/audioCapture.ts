/**
 * **마이크 캡처·인코딩 — 한 곳**(FE §8 「캡처·인코딩은 훅 안의 함수 하나로 격리해 구현 시점에 고른다」 · SPEC-007 §5 · §C-8).
 *
 * - **내 마이크만**: 웹 `getUserMedia({ audio: true })`. 시스템 오디오 캡처를 만들지 않는다(DEC-003 §STT)
 * - **포맷**: `MediaRecorder` 컨테이너(webm/opus · Safari WKWebView 는 mp4/aac)를 그대로 보내고 `auth.audio.format='auto'` 로
 *   선언한다 — 서버는 그 값을 STT config 에 옮길 뿐이고(`integrations/soniox.py` 「`auto` 면 sample_rate 를 보내지 않는다」),
 *   프론트는 STT 상대를 모른다. 컨테이너 헤더가 형식을 말하므로 `sampleRate`·`channels` 는 선언값이다
 * - **청크**: 250ms 타임슬라이스. opus 250ms 는 수 KB 라 프레임 64KB 상한 안이다(§4 오디오)
 * - **일시정지**: `MediaRecorder.pause()` — 같은 컨테이너 스트림을 유지한다. 새 WS(새 STT 세션)에는 새 recorder 를 만든다
 *
 * ⚠ **실물 확인 필요** — macOS Tauri(WKWebView)의 `getUserMedia` 권한 프롬프트와 `MediaRecorder` 지원 mime 은 앱 창에서
 * 본다(WP Phase 6 · §C-7). 이 파일은 브라우저 API 만 쓴다.
 */

/** `auth.audio` 선언(SPEC-007 §4). `format='auto'` — 컨테이너 헤더가 형식을 말한다. */
export const AUDIO_DECLARATION = { format: "auto", sampleRate: 48000, channels: 1 } as const;

/** 프레임당 250ms 이하(§4 오디오). */
export const CHUNK_MS = 250;

/** 지원되는 첫 mime 을 고른다. 하나도 없으면 `undefined` — 브라우저 기본값으로 연다. */
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

export interface Capture {
  pause: () => void;
  resume: () => void;
  stop: () => void;
  readonly stream: MediaStream;
}

/** 마이크 권한 + 트랙. 거부·장치 없음은 예외로 올라온다 — 호출자가 `paused/mic` 로 떨어뜨린다. */
export function requestMicrophone(): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new Error("이 환경에서는 마이크를 쓸 수 없습니다"));
  }
  return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return undefined;
  }
  return MIME_CANDIDATES.find((mime) => MediaRecorder.isTypeSupported(mime));
}

/**
 * 캡처를 시작한다. `onChunk` 는 `CHUNK_MS` 마다 인코딩된 조각(Blob)을 받는다 — 그대로 WS 바이너리 프레임으로 보낸다.
 * `MediaRecorder` 가 없는 환경이면 예외 — **설계 밖 실패**라 호출자가 잡지 않는다(마이크 실패로 접지 않는다 · DEC-003 §7).
 */
export function startCapture(stream: MediaStream, onChunk: (chunk: Blob) => void): Capture {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("이 환경에서는 녹음을 쓸 수 없습니다");
  }
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  recorder.ondataavailable = (event: BlobEvent) => {
    if (event.data && event.data.size > 0) {
      onChunk(event.data);
    }
  };
  recorder.start(CHUNK_MS);

  return {
    stream,
    pause() {
      if (recorder.state === "recording") {
        recorder.pause();
      }
    },
    resume() {
      if (recorder.state === "paused") {
        recorder.resume();
      }
    },
    stop() {
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
    },
  };
}

/** 트랙을 놓는다 — 마이크 표시등이 꺼진다. */
export function releaseMicrophone(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

/** 살아 있는 오디오 트랙이 있는가 — 장치가 빠지면 `ended` 가 된다. */
export function hasLiveAudioTrack(stream: MediaStream | null): stream is MediaStream {
  return stream !== null && stream.getAudioTracks().some((track) => track.readyState === "live");
}
