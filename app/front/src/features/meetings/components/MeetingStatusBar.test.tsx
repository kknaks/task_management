/**
 * **상단 바 한 자리 — 5상태 + headline**(SPEC-007 U-1 · §7-B · WP Phase 5 검증).
 *
 * - 「기록 중」 바에 **파형·「자동 저장」이 없다** · 경과 시간은 `now − recordingStartedAt` 이고 1초마다 간다
 * - 회색 바 4종 문구(연결 중 · 일시정지 · 마이크 · 서버 · 녹음 파일) + 「다른 창에서 기록 중입니다」
 * - 일시정지 중에도 경과 시간이 멈추지 않는다
 * - **WORK-012** — `generating` 단계 문구 둘(`transcription` → `final`) + 「다시 시도 중 (n/2)」 ·
 *   `failed` 배너 「다시 시도」 + 사유 툴팁 둘 · `headline` 카운트 **다섯**
 */

import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MeetingStatusBar } from "@/features/meetings/components/MeetingStatusBar";
import type { JobErrorCode, JobPhase } from "@/features/meetings/types";

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
      <MeetingStatusBar
        variant="headline"
        headline="한 문장"
        summary={{ agendaCount: 3, discussionCount: 5, decisionCount: 2, actionCount: 2, taskCount: 1 }}
      />,
    );
    expect(screen.getByRole("note", { name: "AI 한 줄 요약" })).toHaveTextContent(
      "안건 3 · 논의 5 · 결정 2 · 액션 2 · 업무 1",
    );
  });

  it("`headline` 바의 카운트는 **다섯**이고 「MM.DD HH:mm 생성」이 없다 · `summary` 가 `null` 이면 문장만", () => {
    const { rerender } = render(
      <MeetingStatusBar
        variant="headline"
        headline="한 문장"
        summary={{ agendaCount: 4, discussionCount: 2, decisionCount: 1, actionCount: 1, taskCount: 1 }}
        layout="stacked"
      />,
    );
    const stacked = screen.getByRole("note", { name: "AI 한 줄 요약" });
    expect(stacked).toHaveAttribute("data-layout", "stacked");
    // 드로어(U-4)도 **같은 값 다섯**이고 다른 것은 줄 나눔뿐이다
    expect(stacked).toHaveTextContent("안건 4 · 논의 2 · 결정 1 · 액션 1 · 업무 1");
    expect(stacked.textContent).not.toMatch(/생성/);

    rerender(<MeetingStatusBar variant="headline" headline="한 문장" summary={null} />);
    expect(screen.getByRole("note", { name: "AI 한 줄 요약" })).toHaveTextContent("한 문장");
    expect(screen.getByRole("note").textContent).not.toMatch(/안건/);
  });
});

describe("WORK-012 — 생성중 단계 문구 · 실패 배너", () => {
  const generating = (phase: JobPhase | null, attempt: number) => (
    <MeetingStatusBar variant="generating" phase={phase} attempt={attempt} elapsedFromMs={null} pollFailed={false} onRecheck={vi.fn()} />
  );

  it("① `transcription` → 「녹음을 다시 받아쓰고 있습니다」 · 첫 폴링 전(`null`)도 ① 문구 · 예상 시간을 적지 않는다", () => {
    const { rerender } = render(generating("transcription", 0));
    const bar = screen.getByRole("status", { name: "회의록 생성중" });
    expect(bar).toHaveTextContent("녹음을 다시 받아쓰고 있습니다");
    expect(bar.textContent).not.toMatch(/분|초|예상/);

    rerender(generating(null, 0));
    expect(screen.getByRole("status", { name: "회의록 생성중" })).toHaveTextContent("녹음을 다시 받아쓰고 있습니다");
  });

  it("② `final` → 「회의록을 정리하고 있습니다」 · `attempt` 2·3 이면 「· 다시 시도 중 (1/2)」·「(2/2)」", () => {
    const { rerender } = render(generating("final", 1));
    expect(screen.getByRole("status", { name: "회의록 생성중" })).toHaveTextContent("회의록을 정리하고 있습니다");
    expect(screen.getByRole("status").textContent).not.toMatch(/다시 시도 중/);

    rerender(generating("final", 2));
    expect(screen.getByRole("status")).toHaveTextContent("회의록을 정리하고 있습니다 · 다시 시도 중 (1/2)");
    rerender(generating("final", 3));
    expect(screen.getByRole("status")).toHaveTextContent("회의록을 정리하고 있습니다 · 다시 시도 중 (2/2)");
  });

  it("폴링 실패면 스피너는 그대로 두고 「상태를 확인하지 못했습니다 · 다시 확인」 — 실패로 꾸미지 않는다", async () => {
    const onRecheck = vi.fn();
    render(
      <MeetingStatusBar variant="generating" phase="transcription" attempt={0} elapsedFromMs={null} pollFailed onRecheck={onRecheck} />,
    );
    const bar = screen.getByRole("status", { name: "회의록 생성중" });
    expect(bar).toHaveTextContent("상태를 확인하지 못했습니다");
    expect(bar).toHaveTextContent("녹음을 다시 받아쓰고 있습니다");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    screen.getByRole("button", { name: "다시 확인" }).click();
    expect(onRecheck).toHaveBeenCalledTimes(1);
  });

  it("`failed` 배너는 **하나**이고 버튼은 「다시 시도」 · 사유는 툴팁으로만 갈린다(①/②) · 사유를 모르면 툴팁 없음", () => {
    const onRetry = vi.fn();
    const banner = (errorCode: JobErrorCode | null) => (
      <MeetingStatusBar variant="failed" onRetry={onRetry} retrying={false} errorCode={errorCode} />
    );
    const { rerender } = render(banner("transcription_failed"));
    const alert = screen.getByRole("alert", { name: "회의록 생성 실패" });
    expect(alert).toHaveTextContent("회의록 생성 실패 · 회의록 탭에 회의 중 작성한 원본을 보여 드립니다");
    expect(within(alert).getByTitle("녹음을 다시 받아쓰지 못했습니다")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "다시 시도" });
    expect(button).toHaveAttribute("title", "녹음을 다시 받아쓰고 회의록을 다시 정리합니다 · 원본은 바뀌지 않습니다");
    expect(screen.queryByRole("button", { name: "다시 생성" })).not.toBeInTheDocument();

    for (const code of ["final_failed", "final_timeout", "job_timeout"] as const) {
      rerender(banner(code));
      expect(within(screen.getByRole("alert")).getByTitle("회의록을 정리하지 못했습니다")).toBeInTheDocument();
    }
    rerender(banner("transcription_timeout"));
    expect(within(screen.getByRole("alert")).getByTitle("녹음을 다시 받아쓰지 못했습니다")).toBeInTheDocument();

    rerender(banner(null));
    expect(screen.getByRole("alert").querySelector("span[title]")).toBeNull();
  });
});
