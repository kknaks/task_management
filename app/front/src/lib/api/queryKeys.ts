/**
 * 캐시 키를 만드는 **유일한 곳**(frontend/README.md §3-3).
 * 컴포넌트가 배열 리터럴을 직접 쓰지 않는다.
 *
 * §3-3 의 나머지 키(`tasks`·`meetings`·`schedules`·`workTypes` …)는 **그 영역을 만드는
 * work 가 여기 추가한다.**
 */
export const queryKeys = {
  /** 연결 확인 화면(SPEC-000 U-1)이 읽는 헬스. */
  health: () => ["health"] as const,
  /** `GET /api/auth/session` — 세션 가드와 사이드바 계정 캡션이 함께 읽는다. */
  session: () => ["session"] as const,

  /** `GET /api/work-types` — 업무 설정과 이후 유형 셀렉터가 함께 읽는다. */
  workTypes: () => ["workTypes"] as const,
  /** `GET /api/projects` */
  projects: () => ["projects"] as const,

  /**
   * 업무. 유형·프로젝트가 바뀌면 **배지 이름·색이 딸려 있어** 이 키도 무효화한다(§3-3 표) —
   * WORK-003 이 그 무효화를 이미 걸어 두었고 WORK-004 가 읽는 화면을 붙였다.
   */
  tasks: () => ["tasks"] as const,
  taskDetail: (id: number) => ["tasks", "detail", id] as const,

  /**
   * **아직 아무도 읽지 않는 키.** 회의 화면이 생기면 그 work 가 붙인다.
   * 기한이 바뀌면 `['schedules']` 도 무효화한다(§3-3 표) — 캘린더 work 가 읽는다.
   */
  meetings: () => ["meetings"] as const,
  schedules: () => ["schedules"] as const,
} as const;
