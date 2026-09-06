/**
 * **회의 일시 — KST 왕복과 드로어 기본값**(SPEC-006 U-2 · U-3 · WP Phase 5 「드로어 기본값」).
 *
 * 앱 창 확인 항목 「일시에 오늘 다음 30분 경계부터 1시간이 미리 들어 있다」를 여기서 고정한다 —
 * 시계는 인자로 넣는다.
 */

import { describe, expect, it } from "vitest";

import {
  currentMonthKey,
  defaultMeetingSlot,
  formatMeetingDate,
  formatMeetingDateTime,
  formatMeetingTimeRange,
  isMonthKey,
  minutesBetweenTimes,
  periodOfMonth,
  splitDateTime,
  toDateTimeIso,
} from "@/lib/datetime";

describe("KST 표시 포맷", () => {
  it("「08월 27일 (목) 09:30」 — UTC 00:30 이 KST 09:30 이다", () => {
    expect(formatMeetingDateTime("2026-08-27T00:30:00Z")).toBe("08월 27일 (목) 09:30");
  });

  it("범위는 「08월 27일 (목) 09:30 – 10:30」 — 같은 날이면 뒤는 시각만", () => {
    expect(formatMeetingTimeRange("2026-08-27T00:30:00Z", "2026-08-27T01:30:00Z")).toBe(
      "08월 27일 (목) 09:30 – 10:30",
    );
  });

  it("드로어 날짜 칸은 「2026.08.27 (목)」", () => {
    expect(formatMeetingDate("2026-08-27")).toBe("2026.08.27 (목)");
  });
});

describe("KST 날짜·시각 ↔ UTC ISO 왕복", () => {
  it("`2026-08-27` + `09:30` → `2026-08-27T00:30:00.000Z`", () => {
    expect(toDateTimeIso("2026-08-27", "09:30")).toBe("2026-08-27T00:30:00.000Z");
  });

  it("되돌리면 같은 날짜·시각이다", () => {
    expect(splitDateTime("2026-08-27T00:30:00Z")).toEqual({ date: "2026-08-27", time: "09:30" });
  });

  it("KST 자정 전후가 날짜를 넘는다 — UTC 15:00 = 다음 날 00:00 KST", () => {
    expect(splitDateTime("2026-08-26T15:00:00Z")).toEqual({ date: "2026-08-27", time: "00:00" });
  });
});

describe("드로어 기본 일시 — 오늘 · 30분 올림 · +1시간(U-3)", () => {
  it("09:12 KST 에 열면 09:30 – 10:30 이다", () => {
    // 2026-09-06 09:12 KST = 2026-09-06 00:12 UTC
    expect(defaultMeetingSlot(new Date("2026-09-06T00:12:00Z"))).toEqual({
      date: "2026-09-06",
      start: "09:30",
      end: "10:30",
    });
  });

  it("정확히 경계(10:00)면 올리지 않는다", () => {
    expect(defaultMeetingSlot(new Date("2026-09-06T01:00:00Z"))).toEqual({
      date: "2026-09-06",
      start: "10:00",
      end: "11:00",
    });
  });

  it("하루 끝(23:40)이면 다음 날 00:00 – 01:00 으로 넘어간다", () => {
    // 2026-09-06 23:40 KST = 2026-09-06 14:40 UTC
    expect(defaultMeetingSlot(new Date("2026-09-06T14:40:00Z"))).toEqual({
      date: "2026-09-07",
      start: "00:00",
      end: "01:00",
    });
  });

  it("23:10 이면 같은 날에 머물도록 22:30 – 23:30 으로 내린다", () => {
    expect(defaultMeetingSlot(new Date("2026-09-06T14:10:00Z"))).toEqual({
      date: "2026-09-06",
      start: "22:30",
      end: "23:30",
    });
  });
});

describe("길이 · 달 키", () => {
  it("09:30 – 10:30 은 60분, 뒤집히면 음수", () => {
    expect(minutesBetweenTimes("09:30", "10:30")).toBe(60);
    expect(minutesBetweenTimes("10:30", "09:30")).toBe(-60);
  });

  it("`?month=2026-08` 은 8월 전체이고 이상한 값은 거른다", () => {
    expect(isMonthKey("2026-08")).toBe(true);
    expect(isMonthKey("2026-13")).toBe(false);
    expect(isMonthKey("2026-8")).toBe(false);
    expect(periodOfMonth("2026-08")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(currentMonthKey(new Date("2026-09-06T00:00:00Z"))).toBe("2026-09");
  });
});
