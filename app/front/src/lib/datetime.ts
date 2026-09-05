/**
 * 시각 표시 포맷 **한 곳**(frontend/README.md §3-6 · G-2).
 *
 * > 시각은 UTC ISO 문자열로 오고 **KST 변환은 `lib/datetime.ts` 하나**가 한다.
 * > 컴포넌트가 직접 `new Date()` 로 포맷하지 않는다(§11 금지 목록 8).
 *
 * **D-day·지연은 여기서 계산하지 않는다** — `dDay`·`isOverdue`·`overdueDays` 는 서버가
 * 계산해 내려주는 파생값이고 화면은 그대로 그린다(SPEC-003 §4 · WORK-004 Internal Interface
 * Contract 파생값 행). 여기 있는 것은 **표시 포맷**뿐이다.
 */

/** 앱이 사는 시간대. 서버 `APP_TIMEZONE` 과 같은 값이다. */
const APP_TIME_ZONE = "Asia/Seoul";

function formatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: APP_TIME_ZONE, ...options });
}

/** `2026-08-29` → `08.29`. 달력 날짜라 시간대 변환을 하지 않는다(G-2-e). */
export function formatDueDate(dueDate: string): string {
  const [, month, day] = dueDate.split("-");
  return `${month}.${day}`;
}

/** `14:00:00` · `14:00` → `14:00`. 서버가 초를 실어 보내도 화면은 분까지만 쓴다. */
export function formatTime(time: string): string {
  return time.slice(0, 5);
}

/**
 * 기한 한 줄 — `08.29` 또는 `08.29 14:00–15:00`(SPEC-003 U-3).
 *
 * **기한이 없으면 「기한 없음」** 을 돌려준다 — 빈칸으로 두지 않는다(같은 절).
 */
export function formatDue(
  dueDate: string | null,
  dueStartTime: string | null,
  dueEndTime: string | null,
): string {
  if (!dueDate) {
    return "기한 없음";
  }
  const date = formatDueDate(dueDate);
  if (!dueStartTime || !dueEndTime) {
    return date;
  }
  return `${date} ${formatTime(dueStartTime)}–${formatTime(dueEndTime)}`;
}

/**
 * 메모·로그의 시각 — **당일이면 「오늘 09:12」, 아니면 「08.28 16:40」**(SPEC-003 U-9).
 *
 * 「오늘」 판정에 필요한 현재 시각은 **인자로 받는다** — 테스트가 시계를 흔들지 않아도 되고,
 * 같은 화면 안의 여러 줄이 서로 다른 「지금」을 보지 않는다.
 */
export function formatTimestamp(isoString: string, now: Date = new Date()): string {
  const at = new Date(isoString);
  const dayKey = formatter({ year: "numeric", month: "2-digit", day: "2-digit" });
  const clock = formatter({ hour: "2-digit", minute: "2-digit", hour12: false }).format(at);

  if (dayKey.format(at) === dayKey.format(now)) {
    return `오늘 ${clock}`;
  }

  const [, month, day] = dayKey.format(at).split(". ");
  return `${month}.${day} ${clock}`;
}

// --- 달 경계 (SPEC-004 §4 · G-2) --------------------------------------------

/**
 * **KST 는 서머타임이 없다** — 고정 +9시간이라 오프셋 산술이 정확하다.
 * `Intl` 로 매번 파싱하지 않고 이 상수 하나로 앞뒤 변환을 한다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 「2026-09」 같은 **KST 기준 달 키**. 쿼리에는 이 값이 `?month=` 로 남는다. */
export type MonthKey = string;

/**
 * **이번 달(KST)** — 서버 `current_month_bounds()` 와 같은 기준이다.
 *
 * 전에는 `getFullYear()`/`getMonth()` 로 **디바이스 로컬**을 읽어, KST 가 아닌 기기에서
 * 「이번 달」 판정이 서버와 갈렸다(검수 W-7). 시각 변환은 이 파일 하나가 한다(§3-6).
 */
export function currentMonth(now: Date = new Date()): MonthKey {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** 달 키를 KST 의 연·월로 쪼갠다. 형식이 어긋나면 **이번 달**로 떨어진다. */
function parseMonthKey(month: MonthKey): { year: number; month: number } {
  if (!/^\d{4}-\d{2}-01$/.test(month)) {
    return parseMonthKey(currentMonth());
  }
  const [year, mon] = month.split("-").map(Number);
  return { year, month: mon };
}

/** KST 의 `year-month-1 00:00` 이 가리키는 **UTC 순간**. */
function kstMonthStart(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1) - KST_OFFSET_MS);
}

/**
 * `GET /api/tasks` 의 `from`·`to`.
 *
 * **서버의 `current_month_bounds()` 와 같은 규칙**이어야 한다(검수 F-1) —
 * 셋 다 어긋나 있어 **말일이 기한인 업무가 그 달 어디에도 없었다.**
 *
 * 1. **끝은 다음 달 1일(배타)** — 서버가 `due_date < to` 로 끝 경계를 **열어 둔다**.
 *    말일을 보내면 그날 기한이 통째로 빠진다
 * 2. **KST 달 경계** — UTC 달 경계를 보내면 기한 없는 업무의 `created_at` 축이 9시간 어긋나
 *    그 달 1일 00:00~09:00 KST 에 만든 무기한 업무가 빠진다(T-1-a)
 * 3. **오프셋이 붙은 UTC ISO** — 타임존 없는 날짜 문자열은 서버가 naive 로 파싱해
 *    `.astimezone()` 이 **컨테이너 로컬**을 가정한다(G-2)
 */
export function monthRange(month: MonthKey): { from: string; to: string } {
  const { year, month: mon } = parseMonthKey(month);
  return {
    from: kstMonthStart(year, mon).toISOString(),
    to: kstMonthStart(year, mon + 1).toISOString(),
  };
}

/** 달을 앞뒤로 옮긴다 — 기간 스테퍼의 `‹`·`›`. 연도 넘김은 `Date.UTC` 가 처리한다. */
export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const { year, month: mon } = parseMonthKey(month);
  const moved = new Date(Date.UTC(year, mon - 1 + delta, 1));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** 「2026년 9월」 — 기간 스테퍼·하단 카운트·칸반 캡션이 같은 문구를 쓴다. */
export function formatMonth(month: MonthKey): string {
  const { year, month: mon } = parseMonthKey(month);
  return `${year}년 ${mon}월`;
}

/** 「9월」 — 완료 컬럼 헤더의 「8월 12」 자리. */
export function formatMonthShort(month: MonthKey): string {
  return `${parseMonthKey(month).month}월`;
}
