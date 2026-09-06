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
 * 기한 한 줄 — `08.29`(SPEC-003 U-3).
 *
 * **기한이 없으면 「기한 없음」** 을 돌려준다 — 빈칸으로 두지 않는다(같은 절).
 */
export function formatDue(dueDate: string | null): string {
  return dueDate ? formatDueDate(dueDate) : "기한 없음";
}

/**
 * **계획 기간 한 줄** — `08.26 – 08.27`(시안 288줄, REDRAW-05 F-3).
 *
 * 일정이 `startDate`·`dueDate` 둘로 돌아오면서(A-4 번복) 카드·목록이 같은 표기를 쓴다.
 * **한쪽만 있으면 그것만** 적고, **둘 다 없으면 「미정」**이다 — 빈칸으로 두면
 * 「기한을 안 정했다」와 「값을 못 읽었다」가 구분되지 않는다.
 */
export function formatSchedule(startDate: string | null, dueDate: string | null): string {
  if (startDate && dueDate) {
    return `${formatDueDate(startDate)} – ${formatDueDate(dueDate)}`;
  }
  if (dueDate) {
    return formatDueDate(dueDate);
  }
  if (startDate) {
    return `${formatDueDate(startDate)} –`;
  }
  return "미정";
}

/**
 * **완료 카드의 계획 대비 차이** — `dueDate` ↔ `completedAt`(REDRAW-05 F-3 · DEC-002).
 *
 * 「정시」 / 「N일 늦음」 / 「N일 빠름」. 기한이 없거나 완료 시각이 없으면 `null` 이고
 * 그때는 호출부가 「미정」으로 떨어뜨린다.
 *
 * **날짜만 비교한다** — `completedAt` 은 순간(UTC ISO)이라 KST 달력 날짜로 내린 뒤 뺀다.
 * 시각까지 재면 「기한 당일 23시 완료」가 「1일 늦음」으로 보인다.
 */
export function completionDelta(
  dueDate: string | null,
  completedAt: string | null,
): { label: string; tone: "ontime" | "late" | "early" } | null {
  if (!dueDate || !completedAt) {
    return null;
  }
  const doneKey = currentDate(new Date(completedAt));
  const days = Math.round(
    (new Date(`${doneKey}T00:00:00Z`).getTime() - new Date(`${dueDate}T00:00:00Z`).getTime()) /
      86_400_000,
  );
  if (days === 0) {
    return { label: "정시", tone: "ontime" };
  }
  return days > 0
    ? { label: `${days}일 늦음`, tone: "late" }
    : { label: `${-days}일 빠름`, tone: "early" };
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

/**
 * **KST 는 서머타임이 없다** — 고정 +9시간이라 오프셋 산술이 정확하다.
 * `Intl` 로 매번 파싱하지 않고 이 상수 하나로 앞뒤 변환을 한다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/* ── 기간(Period) ────────────────────────────────────────────────────────
 *
 * **기간은 달이 아니라 날짜 범위다**(REDRAW-02 E-3, 사용자 확정).
 *
 * 전에는 `?month=` 하나였고 화면이 달 경계로만 움직였다. 이제 사용자가 시작일–종료일을
 * 직접 고를 수 있으므로 **범위가 1급**이고, 달은 「범위가 마침 달 경계와 같은 경우」다.
 *
 * **서버 계약은 그대로다**(SPEC-004 §4) — `from`·`to` 는 원래 날짜였고, 프론트가 달 경계로만
 * 채워 보냈을 뿐이다. 새 파라미터를 만들지 않는다.
 *
 * 여기서 다루는 `DateKey` 는 **KST 달력 날짜**(`YYYY-MM-DD`)이고 `to` 는 **포함**이다.
 * 서버로 나갈 때만 `periodRange()` 가 배타 경계(다음 날 00:00 KST)로 바꾼다.
 */

/** `YYYY-MM-DD` — KST 달력 날짜. 시간대 변환을 하지 않는다(G-2-e). */
export type DateKey = string;

/** 시작·종료가 **둘 다 포함**인 기간. */
export interface Period {
  from: DateKey;
  to: DateKey;
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function toKey(date: Date): DateKey {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** 달력 날짜를 **UTC 자정에 놓인 Date** 로 — 날짜 산술만 하므로 시간대를 섞지 않는다. */
function fromKey(key: DateKey): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function isDateKey(raw: string | null): raw is DateKey {
  return raw !== null && DATE_KEY.test(raw) && !Number.isNaN(fromKey(raw).getTime());
}

/** 날짜를 앞뒤로 옮긴다. */
export function shiftDate(key: DateKey, days: number): DateKey {
  const moved = fromKey(key);
  moved.setUTCDate(moved.getUTCDate() + days);
  return toKey(moved);
}

/** 두 날짜 사이의 **일수(양끝 포함)**. */
function dayCount({ from, to }: Period): number {
  return Math.round((fromKey(to).getTime() - fromKey(from).getTime()) / 86_400_000) + 1;
}

/** 그 날짜가 속한 **달 전체**(1일 ~ 말일). */
export function monthOf(key: DateKey): Period {
  const d = fromKey(key);
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { from: toKey(first), to: toKey(last) };
}

/** 그 날짜가 속한 **주**(월요일 시작 ~ 일요일). */
export function weekOf(key: DateKey): Period {
  const d = fromKey(key);
  // `getUTCDay()` 는 일요일이 0 이다 — 월요일 시작으로 옮긴다.
  const offset = (d.getUTCDay() + 6) % 7;
  const from = shiftDate(key, -offset);
  return { from, to: shiftDate(from, 6) };
}

/** **오늘(KST)**. */
export function currentDate(now: Date = new Date()): DateKey {
  return toKey(new Date(now.getTime() + KST_OFFSET_MS));
}

/**
 * 기본 기간 — **오늘 하루**(DEC-002 §「2026-09-06 조회 단위 전환」, 사용자 확정).
 *
 * 「내 업무」는 **오늘 업무**다. 들어가면 오늘 기준으로 뜨고, 스테퍼는 하루씩 움직인다
 * (범위 길이만큼 옮기는 규칙에 하루를 넣으면 저절로 그렇게 된다 — `shiftPeriod`).
 *
 * ⚠ **기한 없는 업무·지연 업무가 매일 오늘에 뜨는 것은 서버 조회 규칙이다.**
 * 지금 서버는 기한 범위로만 거르므로 그 둘은 오늘 범위에서 안 보인다 — **화면에서
 * 클라이언트 필터로 메우지 않는다.** 응답을 그대로 그리고 서버 수정을 기다린다.
 */
export function currentPeriod(now: Date = new Date()): Period {
  const today = currentDate(now);
  return { from: today, to: today };
}

/** 하루짜리 기간인가 — 라벨이 「2026년 9월 6일」로 갈린다. */
export function isSingleDay({ from, to }: Period): boolean {
  return from === to;
}

/** 기간이 **달 경계와 정확히 같은가** — 라벨과 이동 단위가 여기서 갈린다. */
export function isMonthAligned(period: Period): boolean {
  const month = monthOf(period.from);
  return month.from === period.from && month.to === period.to;
}

/**
 * `GET /api/tasks` 의 `from`·`to`.
 *
 * **검수 F-1 이 고정한 규칙 그대로다** — 끝은 **다음 날 00:00(배타)**이고 경계는
 * **KST**, 형식은 **오프셋이 붙은 UTC ISO** 다. 달이 아니라 임의 범위를 받을 뿐이다.
 */
export function periodRange({ from, to }: Period): { from: string; to: string } {
  const start = fromKey(from);
  const end = fromKey(to);
  return {
    from: new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()) - KST_OFFSET_MS,
    ).toISOString(),
    // **포함 종료일 + 1일** — 서버가 `due_date < to` 로 끝을 열어 두므로 그날이 통째로 빠진다
    to: new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() + 1) - KST_OFFSET_MS,
    ).toISOString(),
  };
}

/**
 * 기간을 앞뒤로 옮긴다 — `‹`·`›`.
 *
 * **달 경계면 달 단위**로(길이가 달마다 달라 일수로 옮기면 28일 달에서 어긋난다),
 * 그 밖에는 **고른 범위와 같은 길이**만큼 옮긴다(E-3).
 */
export function shiftPeriod(period: Period, delta: number): Period {
  if (isMonthAligned(period)) {
    const d = fromKey(period.from);
    return monthOf(toKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1))));
  }
  const span = dayCount(period);
  return {
    from: shiftDate(period.from, span * delta),
    to: shiftDate(period.to, span * delta),
  };
}

/**
 * 스테퍼 라벨·하단 요약·칸반 캡션이 같이 쓰는 표기. **세 갈래**다(사용자 확정):
 * | 기간 | 라벨 |
 * |---|---|
 * | 하루 | 「2026년 9월 6일」 |
 * | 한 달 경계와 정확히 같음 | 「2026년 9월」 |
 * | 그 밖의 범위 | 「09.01 – 09.15」 |
 */
export function formatPeriod(period: Period): string {
  if (isSingleDay(period)) {
    const d = fromKey(period.from);
    return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
  }
  if (isMonthAligned(period)) {
    const d = fromKey(period.from);
    return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월`;
  }
  return `${formatDueDate(period.from)} – ${formatDueDate(period.to)}`;
}

/** 「09.06」·「9월」·「09.01–09.15」 — 칸반 완료 컬럼 헤더처럼 **좁은 자리**. */
export function formatPeriodShort(period: Period): string {
  if (isSingleDay(period)) {
    return formatDueDate(period.from);
  }
  if (isMonthAligned(period)) {
    return `${fromKey(period.from).getUTCMonth() + 1}월`;
  }
  return `${formatDueDate(period.from)}–${formatDueDate(period.to)}`;
}
