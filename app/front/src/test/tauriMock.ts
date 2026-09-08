/**
 * **OS 키체인 목.**
 *
 * `tokenStore` 는 셸의 `invoke` 를 직접 문다(그게 §4-1 이 요구하는 「저장소 API 를 부르는
 * 유일한 파일」이다). 테스트는 셸 밖이므로 `@tauri-apps/api/core` 를 **모듈 목**으로 세우고,
 * 여기서 **키체인을 흉내 내는 저장소 하나**를 들고 있는다.
 *
 * 이 목은 「키체인에 무엇이 남았나」를 단언하는 데 쓴다 — 필수 테스트 ⑤(저장소 격리).
 */

/** 키체인에 실제로 들어간 값. `null` 이면 **아무것도 남지 않았다**는 뜻이다. */
let stored: string | null = null;
/** 커맨드 호출 기록 — 「부르지 않았다」를 단언할 때 쓴다. */
const calls: string[] = [];

export const keychain = {
  /** 셸이 있는 것처럼 보이게 한다. `tokenStore.hasShell()` 이 이 플래그를 본다. */
  installShell(): void {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  },
  removeShell(): void {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  },
  reset(): void {
    stored = null;
    calls.length = 0;
    // 다음 커맨드가 다시 실패하지 않도록 초기화한다.
    failNext = null;
  },
  /** 키체인에 남은 값. 테스트가 이걸 본다. */
  peek(): string | null {
    return stored;
  },
  /** 「지난 실행이 저장해 둔 값」을 심는다 — 앱 재시작을 흉내 낼 때 쓴다. */
  seed(token: string): void {
    stored = token;
  },
  callLog(): readonly string[] {
    return calls;
  },
  /** 다음 커맨드 한 번을 실패시킨다 — 접근 거부를 흉내 낸다. */
  failOnce(command: string): void {
    failNext = command;
  },
};

let failNext: string | null = null;

/** `@tauri-apps/api/core` 의 `invoke` 자리. 커맨드 이름은 `src-tauri/src/lib.rs` 와 같다. */
export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  calls.push(command);

  if (failNext === command) {
    failNext = null;
    throw `키체인 접근이 거부되었습니다(${command})`;
  }

  switch (command) {
    case "keychain_get_refresh_token":
      return stored as T;
    case "keychain_set_refresh_token":
      stored = String(args?.token ?? "");
      return undefined as T;
    case "keychain_clear_refresh_token":
      stored = null;
      return undefined as T;
    default:
      throw new Error(`알 수 없는 커맨드: ${command}`);
  }
}
