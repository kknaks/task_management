/**
 * 캐시 키를 만드는 **유일한 곳**(frontend/README.md §3-3).
 * 컴포넌트가 배열 리터럴을 직접 쓰지 않는다.
 *
 * §3-3 의 나머지 키(`tasks`·`meetings`·`schedules`·`workTypes` …)는 **그 영역을 만드는
 * work 가 여기 추가한다.** WORK-001 이 미리 만들지 않는다.
 */
export const queryKeys = {
  /** 연결 확인 화면(SPEC-000 U-1)이 읽는 헬스. WORK-002 가 로그인 화면으로 대체하면 사라진다. */
  health: () => ["health"] as const,
} as const;
