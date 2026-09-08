/**
 * `NEXT_PUBLIC_*` 를 읽는 **유일한 곳**(WORK-001 Internal Interface Contract).
 * 다른 파일에서 `process.env` 를 직접 읽지 않는다.
 *
 * 정적 빌드라 값은 **빌드 시점에 박힌다** — 앱 안에서 바꾸는 설정 화면은 v1 에 없다
 * (SPEC-000 §5 · SYS §런타임 배치).
 */

function requireEnv(name: string, value: string | undefined): string {
  if (!value || value.trim() === "") {
    // 백엔드의 「필수 env 없으면 기동 실패」와 같은 태도 — 빌드/기동을 세운다.
    throw new Error(`필수 환경변수가 없거나 비어 있습니다: ${name}`);
  }
  return value.trim();
}

/** 끝의 `/` 를 떼서 경로를 붙일 때 `//` 가 생기지 않게 한다. */
function normalizeBase(value: string): string {
  return value.replace(/\/+$/, "");
}

export const env = {
  /** 백엔드 API 베이스 주소. 연결 확인 화면이 이 값을 그대로 보여준다(SPEC-000 U-1). */
  apiBase: normalizeBase(
    requireEnv("NEXT_PUBLIC_API_BASE", process.env.NEXT_PUBLIC_API_BASE),
  ),

  /**
   * 설정 화면의 버전 캡션(SPEC-001 U-4). `next.config.ts` 가 `package.json` 에서 주입하므로
   * `.env` 에 적을 값이 아니다 — 정본이 둘로 갈리지 않는다.
   */
  appVersion: requireEnv("NEXT_PUBLIC_APP_VERSION", process.env.NEXT_PUBLIC_APP_VERSION),
} as const;
