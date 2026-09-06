/**
 * **미리보기 패널 · 상단 바 · 안건 목록 — 앱 창 확인 항목의 테스트 판**(WORK-006 Phase 4).
 *
 * - `ai_headline` 을 채운 종료 회의를 고르면 본문 맨 위에 **「AI 한 줄 요약」 바 한 개**, 비어 있으면 **없다**
 * - `ended + succeeded` 는 요약 바 아래 **통합본(`merged`) 트리** — 상세 본문과 같은 `AgendaLineTree` 를 읽기 전용으로(SPEC-006 §7 L728 ·
 *   WORK-008 검수 W-1). 편집 입력 · 「제거」 · 줄 버튼이 없고, 사람 원본·AI 트랙의 줄은 그리지 않는다
 * - 문단 요약 · 「AI 생성」 배지 · 「· 회의실 A」 가 **없다**
 * - `scheduled` 는 안건 목록(읽기 전용) + 첨부 행, `recording` 「기록 중입니다」, `generating` 「회의록 생성중」,
 *   `ended+failed` 는 요약 바 없이 「통합 정리 실패」
 * - 안건 `next` 배지 문구는 **「다음 논의로」**(DEC-003 §1 표 — 목록·미리보기·시작 전·종료 후 어휘)
 * - 상단 바(`MeetingStatusBar`) 변형이 **한 파일**이다 — WORK-007 이 `MeetingTopBar` 를 흡수했다
 */

import { readdirSync } from "node:fs";
import path from "node:path";

import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { MeetingAgendaList } from "@/features/meetings/components/MeetingAgendaList";
import { MeetingPreviewPanel } from "@/features/meetings/components/MeetingPreviewPanel";
import { MeetingStatusBar } from "@/features/meetings/components/MeetingStatusBar";
import { AI, HUMAN, MERGED, endedSucceeded } from "@/features/meetings/closeFixtures";
import { meetingDetail, renderWithProviders } from "@/features/meetings/testUtils";
import type { MeetingDetail } from "@/features/meetings/types";
import { tokenStore } from "@/lib/auth/tokenStore";
import { API_BASE, server } from "@/test/server";

function serve(detail: MeetingDetail) {
  server.use(http.get(`${API_BASE}/api/meetings/${detail.id}`, () => HttpResponse.json(detail)));
}

beforeEach(() => {
  tokenStore.setAccess("A1");
});

afterEach(async () => {
  await tokenStore.clear();
});

describe("AI 한 줄 요약 바(U-8)", () => {
  it("`headline` 이 있는 종료 회의 — 바가 **한 개** 뜨고 문장이 그대로다 · 문단 요약은 없다", async () => {
    const headline = "소개서 개정 범위를 4개 섹션으로 확정했고, 디자인 반영본은 8월 29일까지 받기로 했습니다.";
    serve(
      meetingDetail({
        status: "ended",
        integrationState: "succeeded",
        headline,
        mergedSummary: { agendaCount: 3, decisionCount: 2, actionCount: 2, integratedAt: "2026-08-27T01:42:00Z" },
      }),
    );
    renderWithProviders(<MeetingPreviewPanel meetingId={21} />);

    const bars = await screen.findAllByRole("note", { name: "AI 한 줄 요약" });
    expect(bars).toHaveLength(1);
    expect(within(bars[0]).getByText(headline)).toBeInTheDocument();
    expect(within(bars[0]).getByText("안건 3 · 결정 2 · 액션 2")).toBeInTheDocument();
    expect(screen.queryByText("AI 생성")).not.toBeInTheDocument();
    expect(screen.queryByText(/회의실/)).not.toBeInTheDocument();
  });

  it("`headline` 이 `null` 이면 바가 **없다** — 빈 바를 두지 않는다", async () => {
    serve(endedSucceeded({ headline: null }));
    renderWithProviders(<MeetingPreviewPanel meetingId={21} />);

    // 바가 없어도 통합본 트리는 그대로 — 첫 안건 제목으로 렌더를 기다린다
    expect(await screen.findByText(MERGED[0].title)).toBeInTheDocument();
    expect(screen.queryByRole("note", { name: "AI 한 줄 요약" })).not.toBeInTheDocument();
  });

  it("`ended + succeeded` — 요약 바 아래 **통합본 트리**를 읽기 전용으로 그린다(상세 본문과 같은 `AgendaLineTree` · 플레이스홀더 0)", async () => {
    serve(endedSucceeded());
    renderWithProviders(<MeetingPreviewPanel meetingId={21} />);

    // 통합본 안건 넷 · 배지 어휘는 종료 후 것(「완료」 · 「다음 논의로」 · AI 신설 안건 「AI 안건」)
    for (const agenda of MERGED) {
      // 「경쟁사 요금제 비교」는 첨부 링크 이름과도 같다 — 하나 이상이면 된다
      expect((await screen.findAllByText(agenda.title)).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("다음 논의로")).toBeInTheDocument();
    expect(screen.getByText("AI 안건")).toBeInTheDocument();
    expect(screen.queryByText("대기")).not.toBeInTheDocument();
    // 통합본 줄 본문 — 사람 문장 글자 그대로 + AI 에만 있던 줄
    expect(screen.getByText("도입 사례는 3건만 유지하고 나머지는 별도 페이지로 분리한다.")).toBeInTheDocument();
    expect(screen.getByText("AI: 경쟁사 요금제를 비교했다")).toBeInTheDocument();
    // 사람 원본 · AI 트랙에만 있는 줄은 그리지 않는다(통합본 한 트랙만)
    const onlyInOtherTracks = [...HUMAN, ...AI]
      .flatMap((agenda) => agenda.lines)
      .filter((line) => !MERGED.some((agenda) => agenda.lines.some((merged) => merged.content === line.content)));
    expect(onlyInOtherTracks.length).toBeGreaterThan(0);
    for (const line of onlyInOtherTracks) {
      expect(screen.queryByText(line.content)).not.toBeInTheDocument();
    }
    // 읽기 전용 — 편집 입력 · 「제거」 · 업무 생성/갱신 버튼 · 플레이스홀더 문구가 없다
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /제거/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /업무 (생성|갱신)/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/WORK-008 에서 만든다/)).not.toBeInTheDocument();
  });

  it("`ended + failed` 는 요약 바 없이 사람 원본 + 「통합 정리 실패」", async () => {
    serve(meetingDetail({ status: "ended", integrationState: "failed", headline: null }));
    renderWithProviders(<MeetingPreviewPanel meetingId={21} />);

    expect(await screen.findByText("통합 정리 실패")).toBeInTheDocument();
    expect(screen.getByText("개정 대상 섹션 확정")).toBeInTheDocument();
    expect(screen.queryByRole("note", { name: "AI 한 줄 요약" })).not.toBeInTheDocument();
  });
});

describe("상태별 본문", () => {
  it("`scheduled` — 헤더 일시 범위 · 안건 목록(편집 없음) · 첨부 행 · 「상세보기」 링크", async () => {
    serve(meetingDetail());
    renderWithProviders(<MeetingPreviewPanel meetingId={21} />);

    expect(await screen.findByText("08월 27일 (목) 09:30 – 10:30")).toBeInTheDocument();
    expect(screen.getByText("안건 1")).toBeInTheDocument();
    expect(screen.getByText("디자인 반영 일정과 검수 방식")).toBeInTheDocument();
    // 읽기 전용 — 인라인 편집 입력·「제거」가 없다.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /제거/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "경쟁사 요금제 비교" })).toHaveAttribute("href", "https://example.com/pricing");
    // Next `Link` 가 뒤 슬래시를 정규화한다 — 라우트·쿼리만 본다.
    expect(screen.getByRole("link", { name: "상세보기" }).getAttribute("href")).toMatch(/^\/meetings\/detail\/?\?id=21$/);
  });

  it("`recording` 은 「기록 중입니다」, `generating` 은 「회의록 생성중」 — 스트림을 열지 않는다", async () => {
    serve(meetingDetail({ status: "recording" }));
    renderWithProviders(<MeetingPreviewPanel meetingId={21} />);
    expect(await screen.findByText("기록 중입니다")).toBeInTheDocument();

    serve(meetingDetail({ id: 23, status: "generating" }));
    renderWithProviders(<MeetingPreviewPanel meetingId={23} />);
    expect(await screen.findByText("회의록 생성중")).toBeInTheDocument();
  });

  it("선택이 없으면 「회의록을 고르면 여기에 보입니다」", () => {
    renderWithProviders(<MeetingPreviewPanel meetingId={null} />);
    expect(screen.getByText("회의록을 고르면 여기에 보입니다")).toBeInTheDocument();
  });
});

describe("안건 `next` 배지 · 상단 바", () => {
  it("`state='next'` 는 「다음 논의로」로 그린다 — 「대기」가 아니다", () => {
    render(
      <MeetingAgendaList
        readOnly
        empty={null}
        agendas={[
          { id: 1, track: "merged", title: "가격 표기 문구 처리 방향", orderIndex: 0, state: "next", sourceAgendaId: null, lines: [] },
          { id: 2, track: "merged", title: "개정 대상 섹션 확정", orderIndex: 1, state: "done", sourceAgendaId: null, lines: [] },
        ]}
      />,
    );
    expect(screen.getByText("다음 논의로")).toBeInTheDocument();
    expect(screen.getByText("완료")).toBeInTheDocument();
    expect(screen.queryByText("대기")).not.toBeInTheDocument();
    expect(screen.queryByText("다음으로")).not.toBeInTheDocument();
  });

  it("`waiting` 변형은 「기록 대기 00:00:00」 + 캡션, `headline` 변형은 배지 + 문장", () => {
    const { rerender } = render(<MeetingStatusBar variant="waiting" />);
    expect(screen.getByRole("status", { name: "기록 대기" })).toHaveTextContent("기록 대기");
    expect(screen.getByText("00:00:00")).toBeInTheDocument();
    expect(screen.getByText("회의 시작을 누르면 녹음과 스크립트가 함께 켜집니다")).toBeInTheDocument();

    rerender(<MeetingStatusBar variant="headline" headline="한 문장" summary={null} />);
    expect(screen.getByText("AI 한 줄 요약")).toBeInTheDocument();
    expect(screen.getByText("한 문장")).toBeInTheDocument();
  });

  it("상단 바 컴포넌트는 **파일 하나**다 — WORK-007 이 `MeetingTopBar` 를 `MeetingStatusBar` 로 흡수했고 WORK-008 이 같은 파일에 변형을 더한다", () => {
    const dir = path.resolve(__dirname);
    const files = readdirSync(dir).filter((file) => /(TopBar|StatusBar)/i.test(file) && !file.endsWith(".test.tsx"));
    expect(files).toEqual(["MeetingStatusBar.tsx"]);
  });
});
