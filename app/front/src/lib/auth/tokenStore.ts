/**
 * ★ **refresh 토큰을 다루는 유일한 파일**(frontend/README.md §4-1 · §C-5).
 *
 * 이 파일 밖에서 `localStorage`·`sessionStorage`·Tauri 키체인 API 를 부르면 **리뷰 반려**다
 * (§11 금지 목록 2). ESLint `no-restricted-globals` 가 이 파일만 예외로 둔다.
 *
 * | 값 | 보관 |
 * |---|---|
 * | access 토큰 | **저장소에 넣지 않는다.** 메모리에만 둔다(DEC-001 §4) |
 * | refresh 토큰 · `persist=false` | 메모리 변수 — 앱을 닫으면 사라진다 |
 * | refresh 토큰 · `persist=true` | **OS 키체인**(Tauri 셸). 첫날부터 실물을 쓴다(FE-C2) |
 *
 * **WORK-001 은 자리만 만든다.** 로그인이 없어 아직 아무도 부르지 않는다 —
 * 키체인 연결은 **WORK-002** 가 이 파일 안에서 끝낸다(src-tauri 의 `keyring` 의존성은
 * Phase 4 에서 미리 걸어 두었다).
 */

let accessToken: string | null = null;
let refreshTokenInMemory: string | null = null;

export const tokenStore = {
  /** 메모리 access 토큰. 새로고침하면 사라지고 그때 refresh 로 다시 받는다. */
  getAccess(): string | null {
    return accessToken;
  },

  setAccess(token: string | null): void {
    accessToken = token;
  },

  /** refresh 토큰을 읽는다. `persist=true` 로 저장된 값은 WORK-002 가 키체인에서 읽어 온다. */
  async get(): Promise<string | null> {
    return refreshTokenInMemory;
  },

  /**
   * refresh 토큰을 보관한다.
   *
   * `persist` 는 로그인 폼의 **「로그인 상태 유지」 체크값**이다(§4-1).
   * `true` 는 OS 키체인에 써야 하는데 그 구현이 **WORK-002** 다 —
   * 메모리로 조용히 대체하면 「유지」를 체크한 사용자가 앱을 껐다 켰을 때 말없이
   * 로그아웃된다. 실패를 가리지 않고 세운다(DEC-003 §7 원칙).
   */
  async set(token: string, persist: boolean): Promise<void> {
    if (persist) {
      throw new Error(
        "persist=true 는 OS 키체인 보관이 필요합니다 — WORK-002 에서 tokenStore 안에 구현합니다.",
      );
    }
    refreshTokenInMemory = token;
  },

  /** 로그아웃·갱신 실패 때 전부 지운다. */
  async clear(): Promise<void> {
    accessToken = null;
    refreshTokenInMemory = null;
  },
};
