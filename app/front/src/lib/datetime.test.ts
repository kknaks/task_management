/**
 * **기간 경계 — 서버와 같은 규칙인가**(검수 F-1).
 *
 * 이 축에 프론트 테스트가 하나도 없었고, **백엔드 테스트도 못 잡는다** — 백엔드 테스트는
 * 올바른 경계를 스스로 만들어 보내기 때문이다. 그래서 「프론트가 무엇을 보내는가」를
 * 여기서 고정한다.
 *
 * 기준은 서버의 `task_service.current_month_bounds()` 다:
 * **KST 달 경계**를 만들고 **끝은 다음 달 1일(배타)**, **UTC 순간**으로 보낸다.
 */

import { describe, expect, it } from "vitest";

import { currentMonth, formatMonth, formatMonthShort, monthRange, shiftMonth } from "@/lib/datetime";

describe("monthRange — 서버 `current_month_bounds()` 와 같은 규칙", () => {
  it("**끝이 다음 달 1일**이다 — 말일을 보내면 그날 기한이 통째로 빠진다", () => {
    // 서버는 `due_date < to` 로 끝 경계를 **열어 둔다**.
    expect(monthRange("2026-09-01").to).toBe("2026-09-30T15:00:00.000Z");
    // 2026-09-30T15:00Z = 2026-10-01 00:00 KST → 9월 30일 기한이 **범위 안**이다.
  });

  it("**KST 달 경계**다 — UTC 달 경계면 무기한 업무의 생성일 축이 9시간 어긋난다(T-1-a)", () => {
    // 2026-09-01 00:00 KST = 2026-08-31 15:00 UTC
    expect(monthRange("2026-09-01").from).toBe("2026-08-31T15:00:00.000Z");
  });

  it("**오프셋이 붙은 UTC ISO** 다 — 타임존 없는 문자열은 서버가 로컬로 가정한다(G-2)", () => {
    const { from, to } = monthRange("2026-09-01");
    for (const value of [from, to]) {
      expect(value).toMatch(/Z$/);
      expect(value).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("연말을 넘어가도 다음 달 1일이다", () => {
    expect(monthRange("2026-12-01")).toEqual({
      from: "2026-11-30T15:00:00.000Z",
      to: "2026-12-31T15:00:00.000Z",
    });
  });

  it("**말일 기한이 그 달 범위 안**이다 — 하루 뒤는 밖이다", () => {
    const { from, to } = monthRange("2026-09-01");
    /** 서버가 `due_date` 를 KST 달력 날짜로 비교하는 것과 같은 판정. */
    const inRange = (kstDate: string) => {
      const at = new Date(`${kstDate}T00:00:00+09:00`).getTime();
      return at >= new Date(from).getTime() && at < new Date(to).getTime();
    };
    expect(inRange("2026-09-30")).toBe(true); // 말일 — 고치기 전엔 빠졌다
    expect(inRange("2026-09-01")).toBe(true);
    expect(inRange("2026-10-01")).toBe(false);
    expect(inRange("2026-08-31")).toBe(false);
  });
});

describe("currentMonth — 「이번 달」 판정은 KST 다", () => {
  it("디바이스 로컬이 아니라 **KST** 로 자른다 — 서버는 `APP_TIMEZONE` 을 쓴다", () => {
    // 2026-09-30 16:00 UTC = 2026-10-01 01:00 KST → **10월**이다.
    expect(currentMonth(new Date("2026-09-30T16:00:00Z"))).toBe("2026-10-01");
    // 2026-09-30 14:59 UTC = 2026-09-30 23:59 KST → 아직 9월이다.
    expect(currentMonth(new Date("2026-09-30T14:59:00Z"))).toBe("2026-09-01");
  });
});

describe("달 이동·표기", () => {
  it("연도를 넘긴다", () => {
    expect(shiftMonth("2026-12-01", 1)).toBe("2027-01-01");
    expect(shiftMonth("2026-01-01", -1)).toBe("2025-12-01");
  });

  it("「2026년 9월」·「9월」", () => {
    expect(formatMonth("2026-09-01")).toBe("2026년 9월");
    expect(formatMonthShort("2026-09-01")).toBe("9월");
  });
});
