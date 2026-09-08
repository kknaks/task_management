/**
 * **목록 패널 — 앱 창 확인 항목의 테스트 판**(WORK-006 Phase 4 검증).
 *
 * - 「미정 n」을 누르면 무소속만 남고 **칩 숫자는 바뀌지 않으며** 헤더 「n건」은 바뀐다
 * - 시드로 `recording`·`generating`·`ended+failed` 행을 두면 각각 「기록 중」 dot · 「생성중」 · 「통합 실패」,
 *   `ended` 정상 행은 **아무 표기가 없다**
 * - 셋째 줄 — `headline` ?? 안건 제목 「 · 」 ?? 「안건 없음」
 * - 취소 행 · 「· 회의실 A」 · 문단 요약이 **없다**
 * - 정렬은 즉시 반영(「적용」 없음) · 실패는 빈 목록이 아니라 「다시 시도」
 * - 컨텍스트 메뉴: `recording` 행에서 「삭제」 **비활성**
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MeetingContextMenu } from "@/features/meetings/components/MeetingContextMenu";
import { MeetingListPanel } from "@/features/meetings/components/MeetingListPanel";
import { meetingThirdLine } from "@/features/meetings/components/MeetingRow";
import { SEED_LIST, listItem } from "@/features/meetings/testUtils";
import type { MeetingProjectFilter } from "@/features/meetings/types";
import { periodOfMonth } from "@/lib/datetime";

function renderPanel(overrides: Partial<React.ComponentProps<typeof MeetingListPanel>> = {}) {
  const props: React.ComponentProps<typeof MeetingListPanel> = {
    period: periodOfMonth("2026-08"),
    data: SEED_LIST,
    isPending: false,
    isFetching: false,
    isError: false,
    projectId: null,
    sort: "latest",
    selectedId: 21,
    onSelect: vi.fn(),
    onOpen: vi.fn(),
    onContextMenu: vi.fn(),
    onProjectChange: vi.fn(),
    onSortChange: vi.fn(),
    onRetry: vi.fn(),
    onCreate: vi.fn(),
    onPrevMonth: vi.fn(),
    ...overrides,
  };
  return { ...render(<MeetingListPanel {...props} />), props };
}

describe("헤더 · 필터 칩", () => {
  it("헤더는 「8월 회의록 · n건」이고 칩은 전체·미정·프로젝트별이다", () => {
    renderPanel();
    expect(screen.getByText("8월 회의록")).toBeInTheDocument();
    expect(screen.getByText("5건")).toBeInTheDocument();
    const chips = within(screen.getByRole("group", { name: "프로젝트 필터" }));
    expect(chips.getByRole("button", { name: "전체 5" })).toHaveAttribute("aria-pressed", "true");
    expect(chips.getByRole("button", { name: "미정 2" })).toBeInTheDocument();
    expect(chips.getByRole("button", { name: "소개서 개정 3" })).toBeInTheDocument();
  });

  it("「미정」 필터가 걸려도 **칩 숫자는 그대로**이고 헤더 「n건」만 바뀐다(`projectCounts` 는 필터 전)", async () => {
    const { props } = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "미정 2" }));
    expect(props.onProjectChange).toHaveBeenCalledWith("none");

    // 서버가 필터 적용 후 응답을 준 상태 — `total` 만 바뀌고 `projectCounts` 는 같다.
    const filtered = {
      ...SEED_LIST,
      items: SEED_LIST.items.filter((item) => item.project === null),
      total: 2,
    };
    renderPanel({ data: filtered, projectId: "none" as MeetingProjectFilter });
    const panels = screen.getAllByRole("group", { name: "프로젝트 필터" });
    const chips = within(panels[panels.length - 1]);
    expect(chips.getByRole("button", { name: "전체 5" })).toBeInTheDocument();
    expect(chips.getByRole("button", { name: "미정 2" })).toHaveAttribute("aria-pressed", "true");
    expect(chips.getByRole("button", { name: "소개서 개정 3" })).toBeInTheDocument();
    expect(screen.getByText("2건")).toBeInTheDocument();
  });

  it("정렬은 고르는 즉시 반영된다 — 「적용」 버튼이 없다", async () => {
    const { props } = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "정렬" }));
    await userEvent.click(screen.getByRole("button", { name: "오래된순" }));
    expect(props.onSortChange).toHaveBeenCalledWith("oldest");
    expect(screen.queryByRole("button", { name: "적용" })).not.toBeInTheDocument();
  });
});

describe("행 — 상태 표기 4종 · 셋째 줄", () => {
  it("`recording` 「기록 중」 · `generating` 「생성중」 · `ended+failed` 「통합 실패」 · `scheduled` 「예정」 · `ended` 정상은 없음", () => {
    renderPanel();
    const row = (title: string) => within(screen.getByRole("button", { name: title }));
    expect(row("제품 소개서 리뷰").getByText("예정")).toBeInTheDocument();
    expect(row("고객 인터뷰 4차").getByText("기록 중")).toBeInTheDocument();
    expect(row("디자인 싱크").getByText("생성중")).toBeInTheDocument();
    expect(row("온보딩 킥오프").getByText("통합 실패")).toBeInTheDocument();
    const ok = row("주간 제품 스크럼");
    expect(ok.queryByText("예정")).not.toBeInTheDocument();
    expect(ok.queryByText("기록 중")).not.toBeInTheDocument();
    expect(ok.queryByText("통합 실패")).not.toBeInTheDocument();
  });

  it("셋째 줄은 `headline` → 안건 제목 「 · 」 → 「안건 없음」 순이다", () => {
    expect(meetingThirdLine(listItem({ headline: "한 줄", agendaTitles: ["a"] }))).toEqual({ text: "한 줄", muted: false });
    expect(meetingThirdLine(listItem({ headline: null, agendaTitles: ["a", "b"] }))).toEqual({ text: "a · b", muted: false });
    expect(meetingThirdLine(listItem({ headline: null, agendaTitles: [] }))).toEqual({ text: "안건 없음", muted: true });

    renderPanel();
    expect(screen.getAllByText("개정 대상 섹션 확정 · 디자인 반영 일정과 검수 방식").length).toBeGreaterThan(0);
    expect(screen.getByText("안건 없음")).toBeInTheDocument();
    expect(
      screen.getByText("소개서 개정 범위를 4개 섹션으로 확정했고, 디자인 반영본은 8월 29일까지 받기로 했습니다."),
    ).toBeInTheDocument();
  });

  it("일시는 KST 「08월 27일 (목) 09:30」이고 유형 배지가 붙는다 · 취소 행·회의실·문단 요약이 없다", () => {
    renderPanel();
    expect(screen.getByText("08월 27일 (목) 09:30")).toBeInTheDocument();
    expect(screen.getAllByText("미팅·회의").length).toBeGreaterThan(0);
    expect(screen.queryByText("취소")).not.toBeInTheDocument();
    expect(screen.queryByText(/회의실/)).not.toBeInTheDocument();
    expect(screen.queryByText("AI 생성")).not.toBeInTheDocument();
    expect(screen.queryByText("요약")).not.toBeInTheDocument();
  });

  it("행 클릭은 **선택**이고 더블클릭이 상세다", async () => {
    const { props } = renderPanel();
    const row = screen.getByRole("button", { name: "디자인 싱크" });
    await userEvent.click(row);
    expect(props.onSelect).toHaveBeenCalledWith(23);
    expect(props.onOpen).not.toHaveBeenCalled();
    await userEvent.dblClick(row);
    expect(props.onOpen).toHaveBeenCalledWith(23);
  });
});

describe("로딩 · 실패 · 빈 상태", () => {
  it("첫 로딩은 스켈레톤, 달·필터 변경은 **이전 결과 유지 + 진행 표시**", () => {
    renderPanel({ isPending: true, data: undefined });
    expect(screen.getByLabelText("불러오는 중")).toBeInTheDocument();

    renderPanel({ isFetching: true });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "제품 소개서 리뷰" })).toBeInTheDocument();
  });

  it("조회 실패는 빈 목록이 아니라 실패 표시 + 「다시 시도」(한 번만)", async () => {
    const { props } = renderPanel({ isError: true, data: undefined });
    expect(screen.getByText("회의록을 불러오지 못했습니다")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });

  it("이번 달 없음 → 「새 회의록」 + 「이전 달 보기」 / 필터 결과 없음 → 「필터 지우기」 + n건", async () => {
    const empty = { items: [], total: 0, projectCounts: [] };
    const { props } = renderPanel({ data: empty });
    expect(screen.getByText("2026년 8월에 회의록이 없습니다")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "이전 달 보기" }));
    expect(props.onPrevMonth).toHaveBeenCalled();

    const filtered = { ...SEED_LIST, items: [], total: 0 };
    const second = renderPanel({ data: filtered, projectId: 8 });
    expect(screen.getByText("이 프로젝트의 회의록이 없습니다")).toBeInTheDocument();
    expect(screen.getByText("필터를 지우면 5건이 보입니다")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "필터 지우기" }));
    expect(second.props.onProjectChange).toHaveBeenCalledWith(null);
  });
});

describe("컨텍스트 메뉴 220", () => {
  it("「열기」 / 「삭제」 — `recording` 행에서는 「삭제」가 비활성이다", async () => {
    const onDelete = vi.fn();
    render(
      <MeetingContextMenu
        target={{ id: 22, title: "고객 인터뷰 4차", status: "recording", x: 10, y: 10 }}
        onClose={vi.fn()}
        onOpen={vi.fn()}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByRole("button", { name: "열기" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "삭제" })).toBeDisabled();
  });

  it("`scheduled` 행에서는 「삭제」가 활성이고 대상이 그대로 넘어간다", async () => {
    const onDelete = vi.fn();
    const target = { id: 21, title: "제품 소개서 리뷰", status: "scheduled" as const, x: 10, y: 10 };
    render(<MeetingContextMenu target={target} onClose={vi.fn()} onOpen={vi.fn()} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(onDelete).toHaveBeenCalledWith(target);
  });
});
