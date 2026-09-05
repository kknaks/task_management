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
