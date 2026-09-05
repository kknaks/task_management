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
   * **아직 아무도 읽지 않는 키.** 유형·프로젝트가 바뀌면 배지 이름·색이 딸려 있어
   * 이 둘도 무효화해야 한다(§3-3 무효화 표). 그 화면이 없는 지금은 **키만 등록**해 두고
   * 무효화 연결은 소비 그룹이 한다(WORK-003 Internal Interface Contract).
   */
  tasks: () => ["tasks"] as const,
  meetings: () => ["meetings"] as const,
} as const;
