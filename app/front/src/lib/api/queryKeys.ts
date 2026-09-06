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
   * `GET /api/tasks` — 리스트와 칸반이 **같은 키·같은 응답**을 본다(WP Phase 2).
   * 조건이 전부 키에 들어가므로 기간·필터를 바꾸면 새 쿼리이고, `placeholderData` 로
   * **이전 결과를 유지한 채** 진행 표시만 띄운다(SPEC-004 U-11).
   */
  tasksList: (query: Record<string, string | number | null>) => ["tasks", "list", query] as const,
  /**
   * 연관업무 후보 검색(U-8). `['tasks', …]` 로 시작해 **업무 무효화에 함께 걸린다**.
   * 컴포넌트가 배열 리터럴을 직접 만들지 않는다(§3-3).
   */
  relationCandidates: (params: {
    excludeId: number | null;
    projectId: number | null;
    dueDate: string | null;
    keyword: string;
    scope: string;
  }) => ["tasks", "relationCandidates", params] as const,

  /**
   * 회의록 — `['meetings', 'list', {…}]` · `['meetings', 'detail', id]`(§3-3 · WORK-006).
   * 생성·수정·삭제·시작 → `['meetings']` 전부 + **일시가 바뀌었으면 `['schedules']`**.
   * 미리보기 패널과 상세 페이지가 **같은 detail 키**를 본다(SPEC-006 U-8 기대 결과).
   */
  meetings: () => ["meetings"] as const,
  meetingsList: (query: Record<string, string | number | null>) =>
    ["meetings", "list", query] as const,
  meetingDetail: (id: number) => ["meetings", "detail", id] as const,
  /**
   * 확정 발화 블록(SPEC-007) — 진입 시 `GET …/transcript` 1회 + WS `transcript.final` 로 append.
   * `['meetings', …]` 아래라 회의 무효화에 함께 걸린다.
   */
  meetingTranscript: (id: number) => ["meetings", "transcript", id] as const,
  /**
   * **「회의 시작」을 이 세션에서 눌렀다** 는 표지(SPEC-007 S-1). `/start` 성공이 세우고 회의 중 화면이
   * 한 번 읽고 지운다 — 그때만 WS 를 바로 연다. 새로고침·재실행에는 없으므로 `paused/stream` 으로
   * 시작한다(State/Lifecycle). 서버 상태가 아니라 세션 의도라 쿼리 함수가 없다.
   */
  meetingStartIntent: (id: number) => ["meetings", "startIntent", id] as const,
  /** 캘린더 work 가 읽는다. 여기서는 **무효화로만** 건드린다(§3-3 「직접 쓰지 않는다」). */
  schedules: () => ["schedules"] as const,
} as const;
