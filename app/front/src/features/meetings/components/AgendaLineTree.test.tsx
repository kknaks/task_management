/**
 * **트랙 무관 트리 한 벌**(WP Phase 5 검증 · SPEC-007 U-2 · U-4).
 *
 * - 같은 `AgendaLineTree` 에 사람 트랙·AI 트랙 데이터를 넣어 **분기 없이** 두 탭 모양이 나온다(컴포넌트 안 `track ===` 0 — 정적 검사)
 * - 배지는 호출자가 정한다 — 회의 중 「논의 중」/「완료」/「**대기**」 · AI 신설 안건 「AI 안건」 캡션
 * - **줄에 시각이 없다**(WORK-011 · MF-9) — 안건 헤더의 첫 줄 시각만 남는다
 * - `expandable` 일 때만 화살표 · 펼치면 상세 + 「HH:MM – HH:MM」 칩(`recordingStartedAt` 기준 벽시계)
 * - 사람 「업무」 줄은 라벨만(`#5F6470`) — 배지·버튼 없음 · 사람 줄에 편집·삭제 어포던스 없음
 * - AI 「업무」 줄은 라벨 옆에 `task.workType` 유형 배지(U-4 · 검수 F-1)
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AgendaLineTree, type AgendaBadge } from "@/features/meetings/components/AgendaLineTree";
import type { AgendaState, MeetingAgenda, MeetingLine } from "@/features/meetings/types";

const STARTED = "2026-08-27T00:30:00Z"; // KST 09:30

function line(partial: Partial<MeetingLine> & Pick<MeetingLine, "id" | "agendaId" | "track" | "kind" | "content">): MeetingLine {
  return {
    detail: null,
    evidence: [],
    orderIndex: partial.id,
    taskId: null,
    payload: null,
    task: null,
    createdAt: "2026-08-27T00:34:00Z",
    ...partial,
  };
}

const HUMAN: MeetingAgenda[] = [
  {
    id: 301, track: "human", title: "개정 대상 섹션 확정", orderIndex: 0, state: "done", sourceAgendaId: null,
    lines: [
      line({ id: 1, agendaId: 301, track: "human", kind: "discussion", content: "도입 사례 분량이 과다" }),
      line({ id: 2, agendaId: 301, track: "human", kind: "decision", content: "3건만 유지한다", createdAt: "2026-08-27T00:36:00Z" }),
      line({ id: 3, agendaId: 301, track: "human", kind: "task", content: "소개서 v2 문구 정리", createdAt: "2026-08-27T00:37:00Z" }),
    ],
  },
  { id: 302, track: "human", title: "디자인 반영 일정", orderIndex: 1, state: "active", sourceAgendaId: null, lines: [line({ id: 4, agendaId: 302, track: "human", kind: "action", content: "검수 일정 잡기" })] },
  { id: 303, track: "human", title: "가격 표기", orderIndex: 2, state: "next", sourceAgendaId: null, lines: [] },
];

const AI: MeetingAgenda[] = [
  {
    id: 40, track: "ai", title: "개정 대상 섹션 확정", orderIndex: 0, state: null, sourceAgendaId: 301,
    lines: [
      line({
        id: 620, agendaId: 40, track: "ai", kind: "decision", content: "도입 사례는 3건만 유지",
        detail: "유사 사례가 분량만 늘린다는 지적.", evidence: [{ fromMs: 240_000, toMs: 360_000 }], createdAt: "2026-08-27T00:41:02Z",
      }),
      line({ id: 621, agendaId: 40, track: "ai", kind: "action", content: "분리 초안", createdAt: "2026-08-27T00:41:03Z" }),
      line({
        id: 622, agendaId: 40, track: "ai", kind: "task", content: "소개서 v2 문구 정리 기한을 당긴다", taskId: 45, createdAt: "2026-08-27T00:41:04Z",
        task: { id: 45, title: "소개서 v2 문구 정리", status: "todo", dueDate: null, isDeleted: false, workType: { id: 3, name: "문서·보고", colorToken: "steel", isDeleted: false } },
      }),
    ],
  },
  { id: 41, track: "ai", title: "경쟁사 요금제 비교", orderIndex: 5, state: null, sourceAgendaId: null, lines: [] },
];

const LIVE_BADGE: Record<AgendaState, Exclude<AgendaBadge, null>> = {
  active: { tone: "active", label: "논의 중" },
  done: { tone: "done", label: "완료" },
  next: { tone: "next", label: "대기" },
};
const humanBadge = (agenda: MeetingAgenda): AgendaBadge => (agenda.state ? LIVE_BADGE[agenda.state] : null);
const aiBadge = (agenda: MeetingAgenda): AgendaBadge => {
  if (agenda.sourceAgendaId === null) return { tone: "caption", label: "AI 안건" };
  const source = HUMAN.find((h) => h.id === agenda.sourceAgendaId);
  return source?.state ? LIVE_BADGE[source.state] : null;
};

describe("회의록 탭 — 사람 트랙", () => {
  it("배지 「완료」·「논의 중」·「**대기**」, 줄 4종 라벨, 빈 안건 「아직 기록 없음」, 첫 줄 시각", () => {
    render(<AgendaLineTree agendas={HUMAN} activeAgendaId={302} expandable={false} onToggleDone={vi.fn()} badgeFor={humanBadge} recordingStartedAt={STARTED} empty={<p>없음</p>} />);

    expect(screen.getByText("완료")).toBeInTheDocument();
    expect(screen.getByText("논의 중")).toBeInTheDocument();
    expect(screen.getByText("대기")).toBeInTheDocument();
    expect(screen.queryByText("다음 논의로")).not.toBeInTheDocument();
    expect(screen.getByText("아직 기록 없음")).toBeInTheDocument();

    for (const label of ["논의", "결정", "업무", "액션"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // 「업무」 줄 — 라벨 색만, 배지·버튼 없음(U-3 · DEC-003 §1 표)
    const taskRow = screen.getByText("소개서 v2 문구 정리").closest("[data-line-kind]");
    expect(taskRow).toHaveAttribute("data-line-kind", "task");
    expect(within(taskRow as HTMLElement).getByText("업무")).toHaveClass("text-muted-foreground");
    expect(within(taskRow as HTMLElement).queryByRole("button")).not.toBeInTheDocument();
    expect((taskRow as HTMLElement).querySelector("[data-color-token]")).toBeNull();

    // **줄에 시각이 없다**(MF-9) — `HH:MM` 은 안건 헤더(안건 1·2 의 첫 줄 09:34)에만 있고 줄의 09:36 · 09:37 은 그리지 않는다
    expect(screen.getAllByText("09:34")).toHaveLength(2);
    expect(screen.queryByText("09:36")).not.toBeInTheDocument();
    expect(screen.queryByText("09:37")).not.toBeInTheDocument();
    const rows = [...document.querySelectorAll("[data-line-id]")];
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.textContent).not.toMatch(/\d\d:\d\d/);
    }

    // 안건 헤더 체크는 버튼(사람 트랙) · **삭제·제목 수정 어포던스 없음**
    expect(screen.getByRole("button", { name: "안건 1 완료 해제" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "안건 2 완료" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /제거/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    // 펼침 화살표 없음
    expect(screen.queryByRole("button", { name: "펼치기" })).not.toBeInTheDocument();
  });

  it("체크 클릭이 그 안건으로 `onToggleDone` 을 부른다", async () => {
    const onToggleDone = vi.fn();
    render(<AgendaLineTree agendas={HUMAN} expandable={false} onToggleDone={onToggleDone} badgeFor={humanBadge} recordingStartedAt={STARTED} empty={null} />);
    await userEvent.click(screen.getByRole("button", { name: "안건 2 완료" }));
    expect(onToggleDone).toHaveBeenCalledWith(HUMAN[1]);
  });
});

describe("AI 탭 — 같은 컴포넌트 · `track='ai'` 데이터", () => {
  it("미러 안건은 원본 배지 「완료」, 신설 안건은 「AI 안건」 캡션, 체크는 버튼이 아니다", () => {
    render(<AgendaLineTree agendas={AI} expandable onChipClick={() => true} badgeFor={aiBadge} recordingStartedAt={STARTED} empty={null} />);
    expect(screen.getByText("완료")).toBeInTheDocument();
    expect(screen.getByText("AI 안건")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /완료/ })).not.toBeInTheDocument();
    // 번호는 orderIndex + 1
    expect(screen.getByText("안건 6")).toBeInTheDocument();
  });

  it("AI 「업무」 줄은 라벨 옆에 `task.workType` 유형 배지를 단다(U-4 · 검수 F-1) — 색은 `data-color-token` 으로만", () => {
    render(<AgendaLineTree agendas={AI} expandable onChipClick={() => true} badgeFor={aiBadge} recordingStartedAt={STARTED} empty={null} />);
    const taskRow = screen.getByText("소개서 v2 문구 정리 기한을 당긴다").closest("[data-line-kind]") as HTMLElement;
    expect(taskRow).toHaveAttribute("data-line-kind", "task");
    const badge = within(taskRow).getByText("문서·보고");
    expect(badge).toHaveAttribute("data-color-token", "steel");
    expect(badge).toHaveClass("bg-palette-bg", "text-palette-fg");
    // 배지는 업무 줄에만 — 결정·액션 줄에는 없다
    expect(screen.getByText("도입 사례는 3건만 유지").closest("[data-line-kind]")?.querySelector("[data-color-token]")).toBeNull();
  });

  it("줄 화살표를 펼치면 상세 + 「HH:MM – HH:MM」 칩이 `recordingStartedAt` 기준 벽시계로 찍히고, 클릭이 `onChipClick(fromMs,toMs)` 로 간다", async () => {
    const onChipClick = vi.fn(() => true);
    render(<AgendaLineTree agendas={AI} expandable onChipClick={onChipClick} badgeFor={aiBadge} recordingStartedAt={STARTED} empty={null} />);
    const arrows = screen.getAllByRole("button", { name: "펼치기" });
    expect(arrows).toHaveLength(3);
    expect(screen.queryByText("유사 사례가 분량만 늘린다는 지적.")).not.toBeInTheDocument();

    await userEvent.click(arrows[0]);
    expect(screen.getByText("유사 사례가 분량만 늘린다는 지적.")).toBeInTheDocument();
    // 09:30 + 240s = 09:34 · + 360s = 09:36
    const chip = screen.getByRole("button", { name: "근거 구간 09:34 – 09:36" });
    await userEvent.click(chip);
    expect(onChipClick).toHaveBeenCalledWith(240_000, 360_000);
    expect(screen.getByText("칩을 누르면 해당 구간 스크립트로 이동합니다")).toBeInTheDocument();

    // 근거 없는 줄은 「근거 없음」(아직 접힌 줄 중 첫째 — 「분리 초안」)
    await userEvent.click(screen.getAllByRole("button", { name: "펼치기" })[0]);
    expect(screen.getByText("근거 없음")).toBeInTheDocument();
  });

  it("대상이 없으면(`onChipClick` 이 false) 칩 옆에 「해당 구간의 발화가 없습니다」", async () => {
    render(<AgendaLineTree agendas={AI} expandable onChipClick={() => false} badgeFor={aiBadge} recordingStartedAt={STARTED} empty={null} />);
    await userEvent.click(screen.getAllByRole("button", { name: "펼치기" })[0]);
    await userEvent.click(screen.getByRole("button", { name: "근거 구간 09:34 – 09:36" }));
    expect(await screen.findByText("해당 구간의 발화가 없습니다")).toBeInTheDocument();
  });

  it("안건이 없으면 `empty` 를 그린다", () => {
    render(<AgendaLineTree agendas={[]} expandable badgeFor={aiBadge} recordingStartedAt={STARTED} empty={<p>기록이 쌓이면 요약이 생성됩니다</p>} />);
    expect(screen.getByText("기록이 쌓이면 요약이 생성됩니다")).toBeInTheDocument();
  });
});

describe("density — 미리보기는 compact(WORK-014 · FE §2 규칙 7)", () => {
  it("**같은 컴포넌트**가 글자 · 여백 · 라벨 폭만 줄인다 — 구조 · 배지 · 펼침 규칙은 하나다", async () => {
    const { unmount } = render(
      <AgendaLineTree agendas={AI} expandable badgeFor={() => ({ tone: "caption", label: "AI 안건" })} recordingStartedAt={STARTED} empty={null} />,
    );
    const defaultRows = [...document.querySelectorAll("[data-line-id]")].map((row) => row.className);
    const defaultLabel = (document.querySelector("[data-line-id] span") as HTMLElement).className;
    const defaultStructure = document.querySelectorAll("[data-agenda-id], [data-line-id]").length;
    const defaultBadges = screen.getAllByText("AI 안건").length;
    const defaultArrows = screen.getAllByRole("button", { name: "펼치기" }).length;
    unmount();

    render(
      <AgendaLineTree agendas={AI} expandable density="compact" badgeFor={() => ({ tone: "caption", label: "AI 안건" })} recordingStartedAt={STARTED} empty={null} />,
    );
    const tree = document.querySelector("[data-density]") as HTMLElement;
    expect(tree).toHaveAttribute("data-density", "compact");

    // **구조가 같다** — 안건 · 줄 수, 배지, 펼침 화살표가 그대로다
    expect(document.querySelectorAll("[data-agenda-id], [data-line-id]").length).toBe(defaultStructure);
    expect(screen.getAllByText("AI 안건")).toHaveLength(defaultBadges);
    expect(screen.getAllByRole("button", { name: "펼치기" })).toHaveLength(defaultArrows);

    // **달라진 것은 글자 · 여백 · 라벨 폭뿐**이다
    const compactRows = [...document.querySelectorAll("[data-line-id]")].map((row) => row.className);
    expect(compactRows[0]).not.toBe(defaultRows[0]);
    expect(compactRows[0]).toContain("py-1");
    const compactLabel = (document.querySelector("[data-line-id] span") as HTMLElement).className;
    expect(defaultLabel).toContain("w-[34px]");
    expect(compactLabel).toContain("w-[26px]");
    expect(compactLabel).toContain("text-badge");
  });

  it("`density` 를 안 주면 상세 밀도(`default`)다 — 기존 화면이 그대로다", () => {
    render(<AgendaLineTree agendas={AI} expandable badgeFor={() => null} recordingStartedAt={STARTED} empty={null} />);
    expect(document.querySelector("[data-density]")).toHaveAttribute("data-density", "default");
  });
});

