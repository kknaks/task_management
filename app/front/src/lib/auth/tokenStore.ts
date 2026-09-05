/**
 * ★ **refresh 토큰을 다루는 유일한 파일**(frontend/README.md §4-1 · §C-5).
 *
 * 이 파일 밖에서 `localStorage`·`sessionStorage`·Tauri 키체인 커맨드를 부르면 **리뷰 반려**다
 * (§11 금지 목록 2). ESLint `no-restricted-globals` 가 이 파일만 예외로 둔다.
 *
 * | 값 | 보관 |
 * |---|---|
 * | access 토큰 | **저장소에 넣지 않는다.** 메모리에만 둔다(DEC-001 §4) |
 * | refresh 토큰 · `persist=false` | 메모리 변수 — 앱을 닫으면 사라진다 |
 * | refresh 토큰 · `persist=true` | **OS 키체인**(Tauri 셸). 첫날부터 실물을 쓴다(FE-C2) |
 *
 * **브라우저 저장소 폴백을 두지 않는다**(DEC-001 §4, 2026-09-05 개정). 셸이 없는 환경에서
 * `persist=true` 를 요청하면 **예외를 던진다** — 조용히 다른 곳에 저장하면 「유지」를 켠
 * 사용자가 앱을 껐다 켰을 때 말없이 로그아웃된다.
 */

import { invoke } from "@tauri-apps/api/core";

/** `src-tauri/src/lib.rs` 가 여는 커맨드 셋. 이름을 다른 파일에 흘리지 않는다. */
const KEYCHAIN_GET = "keychain_get_refresh_token";
const KEYCHAIN_SET = "keychain_set_refresh_token";
const KEYCHAIN_CLEAR = "keychain_clear_refresh_token";

/**
 * 키체인 자체가 실패했다 — **자격 증명 문제가 아니다.**
 *
 * 사용자가 OS 접근 알림에서 「거부」를 누르는 것이 가장 흔한 경로다. 이걸 일반 실패와 섞으면
 * 화면이 「아이디 또는 비밀번호가…」로 잘못 안내한다. 그래서 타입으로 갈라 둔다.
 */
export class KeychainError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "KeychainError";
  }
}

/** Tauri `invoke` 는 Rust 의 `Err(String)` 을 **문자열 그대로** 던진다 — Error 가 아니다. */
function toKeychainError(action: string, cause: unknown): KeychainError {
  const detail = typeof cause === "string" ? cause : cause instanceof Error ? cause.message : "";
  return new KeychainError(detail ? `${action} · ${detail}` : action, cause);
}

/**
 * Tauri 셸 안인가.
 *
 * 셸이 IPC 를 붙이면 `window.__TAURI_INTERNALS__` 가 생긴다. 브라우저에서 `npm run dev` 로
 * 열어 볼 때는 없다 — 그때 `persist=true` 는 **던진다**(위 개정).
 */
function hasShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

let accessToken: string | null = null;
let refreshTokenInMemory: string | null = null;

/**
 * 지금 refresh 를 **어디에** 두고 있나.
 *
 * 갱신은 회전이라 새 토큰을 **원래 있던 자리**에 다시 써야 한다(§5 토큰 취급). 로그아웃
 * 확인 모달의 경고 슬롯도 이 값으로 갈린다(SPEC-001 U-5 — 「유지」로 로그인한 경우에만).
 * 앱을 다시 켠 직후에는 `load()` 가 키체인을 읽어 이 값을 복원한다.
 */
let persistMode = false;

export const tokenStore = {
  /** 메모리 access 토큰. 새로고침하면 사라지고 그때 refresh 로 다시 받는다. */
  getAccess(): string | null {
    return accessToken;
  },

  setAccess(token: string | null): void {
    accessToken = token;
  },

  /**
   * 앱 시작 시 **키체인을 한 번 읽어** 메모리로 올린다.
   *
   * 세션 가드가 부트스트랩에서 한 번 부른다. 키체인에 값이 있으면 그 세션은 「유지」로
   * 로그인한 세션이다 — `persistMode` 를 함께 복원한다.
   */
  async load(): Promise<void> {
    if (!hasShell()) {
      return;
    }
    let stored: string | null;
    try {
      stored = await invoke<string | null>(KEYCHAIN_GET);
    } catch (cause) {
      throw toKeychainError("저장된 로그인 정보를 키체인에서 읽지 못했습니다", cause);
    }
    if (stored) {
      refreshTokenInMemory = stored;
      persistMode = true;
    }
  },

  /** refresh 토큰을 읽는다. 보관 위치와 무관하게 메모리 사본이 최신이다. */
  async get(): Promise<string | null> {
    return refreshTokenInMemory;
  },

  /**
   * refresh 토큰을 보관한다.
   *
   * `persist` 는 로그인 폼의 **「로그인 상태 유지」 체크값**이다(§4-1).
   * `true` 인데 셸이 없으면 **던진다** — 브라우저 저장소로 대체하지 않는다(DEC-001 §4 개정).
   */
  async set(token: string, persist: boolean): Promise<void> {
    refreshTokenInMemory = token;
    persistMode = persist;

    if (!persist) {
      // 미체크로 갈아탄 경우 키체인에 남은 값을 지운다 — 「유지」를 끈 것이 곧 삭제다.
      if (hasShell()) {
        try {
          await invoke(KEYCHAIN_CLEAR);
        } catch (cause) {
          throw toKeychainError("저장된 로그인 정보를 키체인에서 지우지 못했습니다", cause);
        }
      }
      return;
    }

    if (!hasShell()) {
      throw new KeychainError(
        "「로그인 상태 유지」는 OS 키체인이 필요합니다 — 앱 창에서 실행해 주세요.",
      );
    }

    try {
      await invoke(KEYCHAIN_SET, { token });
    } catch (cause) {
      throw toKeychainError(
        "키체인에 저장하지 못했습니다 — 접근을 허용하거나 「로그인 상태 유지」를 끄고 다시 시도해 주세요",
        cause,
      );
    }
  },

  /** 「유지」로 로그인한 세션인가. 회전 시 되쓸 자리와 로그아웃 경고 문구가 이 값으로 갈린다. */
  isPersistent(): boolean {
    return persistMode;
  },

  /** 로그아웃·갱신 실패 때 전부 지운다. **키체인 항목도 함께 지운다.** */
  async clear(): Promise<void> {
    accessToken = null;
    refreshTokenInMemory = null;
    persistMode = false;
    if (hasShell()) {
      try {
        await invoke(KEYCHAIN_CLEAR);
      } catch (cause) {
        throw toKeychainError("저장된 로그인 정보를 키체인에서 지우지 못했습니다", cause);
      }
    }
  },
};
