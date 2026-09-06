/**
 * **상단 바 한 자리 — 5상태 + headline**(SPEC-007 U-1 · §7-B · WP Phase 5 검증).
 *
 * - 「기록 중」 바에 **파형·「자동 저장」이 없다** · 경과 시간은 `now − recordingStartedAt` 이고 1초마다 간다
 * - 회색 바 4종 문구(연결 중 · 일시정지 · 마이크 · 서버 · 녹음 파일) + 「다른 창에서 기록 중입니다」
 * - 일시정지 중에도 경과 시간이 멈추지 않는다
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MeetingStatusBar } from "@/features/meetings/components/MeetingStatusBar";

const STARTED = "2026-08-27T00:30:00Z";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-27T00:42:38Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("기록 중", () => {
  it("「기록 중 00:12:38」 — 기준은 `recordingStartedAt`, 파형·「자동 저장」 없음, 1초 뒤 00:12:39", () => {
    render(<MeetingStatusBar variant="live" elapsedFrom={STARTED} />);
    const bar = screen.getByRole("status", { name: "기록 중" });
    expect(bar).toHaveTextContent("기록 중00:12:38");
    expect(bar.textContent).not.toMatch(/자동 저장/);
    expect(bar.querySelectorAll("span").length).toBeLessThan(6);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(bar).toHaveTextContent("00:12:39");
  });
});

describe("회색 바 — 연결 중 · 일시정지 사유", () => {
  it("연결 중", () => {
    render(<MeetingStatusBar variant="connecting" elapsedFrom={STARTED} />);
    expect(screen.getByRole("status", { name: "연결 중" })).toHaveTextContent("연결 중00:12:38");
  });

  it.each([
    ["user", "일시정지"],
    ["mic", "일시정지 · 마이크 연결이 끊겼습니다"],
    ["stream:upstream", "일시정지 · 서버 연결이 끊겼습니다"],
    ["stream:write_failed", "일시정지 · 녹음 파일을 저장하지 못했습니다"],
    ["stream:elsewhere", "다른 창에서 기록 중입니다"],
  ] as const)("%s → 「%s」 + 경과 시간(멈추지 않는다)", (reason, label) => {
    render(<MeetingStatusBar variant="paused" pauseReason={reason} elapsedFrom={STARTED} />);
    const bar = screen.getByRole("status", { name: label });
    expect(bar).toHaveTextContent(`${label}00:12:38`);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(bar).toHaveTextContent("00:12:40");
  });

  it("기준점이 없으면 00:00:00", () => {
    render(<MeetingStatusBar variant="paused" pauseReason="stream:upstream" elapsedFrom={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("00:00:00");
  });
});

describe("WORK-006 변형 그대로", () => {
  it("`waiting` 은 「기록 대기 00:00:00」 + 캡션 · `headline` 은 배지 + 문장 + 카운트", () => {
    const { rerender } = render(<MeetingStatusBar variant="waiting" />);
    expect(screen.getByRole("status", { name: "기록 대기" })).toHaveTextContent("00:00:00");
    rerender(
      <MeetingStatusBar variant="headline" headline="한 문장" summary={{ agendaCount: 3, decisionCount: 2, actionCount: 2, integratedAt: STARTED }} />,
    );
    expect(screen.getByRole("note", { name: "AI 한 줄 요약" })).toHaveTextContent("안건 3 · 결정 2 · 액션 2");
  });
});
