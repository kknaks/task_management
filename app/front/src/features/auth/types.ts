/** 로그인 영역이 쓰는 타입. 응답 타입은 `types/api.ts` 가 정본이다(FE §3-6). */

export interface LoginFormValues {
  loginId: string;
  password: string;
  /** 「로그인 상태 유지」 — **요청에 싣지 않는다.** refresh 보관 위치만 가른다(SPEC-001 §4). */
  persist: boolean;
}
