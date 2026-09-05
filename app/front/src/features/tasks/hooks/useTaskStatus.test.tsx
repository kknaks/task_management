/**
 * **FE §11 필수 테스트 1 — 완료 게이트**와 **세 진입점이 같은 요청을 낸다**는 증명.
 *
 * > `422 task_completion_blocked` 를 받으면 **상태 셀이 바뀌지 않고** 안내 토스트가 뜬다
 * > (낙관적 갱신을 안 하는 것의 증명 — DEC-002 §4).
 *
 * 앱 창 캡처 3장이 「같은 요청」의 실측이라면, 여기는 그 성질이 **코드에 남아 있는지**를 잡는다 —
 * 세 진입점이 훅 하나를 지나므로 **같은 본문**이 나가는 것이 구조적으로 보장된다.
 */

import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";

import { useTaskStatus } from "@/features/tasks/hooks/useTaskStatus";
import { useKanbanDnd } from "@/features/tasks/hooks/useKanbanDnd";
import type { TaskListItem } from "@/features/tasks/types";
import { tokenStore } from "@/lib/auth/tokenStore";
import { API_BASE, server } from "@/test/server";

const TASK: TaskListItem = {
  id: 42,
  title: "게이트 검증",
  status: "in_progress",
  workType: { id: 3, name: "문서·보고", kind: "task", colorToken: "steel", isDeleted: false },
  project: null,
  dueDate: null,
  dueStartTime: null,
  dueEndTime: null,
  dDay: null,
  isOverdue: false,
  overdueDays: null,
  memoCount: 0,
  todoProgress: { done: 0, total: 0 },
  cancelReason: null,
  cancelledAt: null,
};

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useTaskStatus(), { wrapper });
}

/** 서버가 실제로 받은 요청을 기록한다 — 「같은 경로·같은 본문」을 여기서 대조한다. */
function recordStatusCalls(record: { path: string; body: unknown }[], respond: () => Response) {
  server.use(
    http.patch(`${API_BASE}/api/tasks/:id/status`, async ({ request, params }) => {
      record.push({ path: `/api/tasks/${String(params.id)}/status`, body: await request.json() });
      return respond();
    }),
  );
}

const blocked = () =>
  HttpResponse.json(
    { detail: "완료하려면 결과자료 1건 또는 완료 결과가 필요합니다", code: "task_completion_blocked" },
    { status: 422 },
  );

beforeEach(() => {
  tokenStore.setAccess("A1");
});

afterEach(async () => {
  await tokenStore.clear();
});

describe("완료 게이트 — 거부는 정상 경로다", () => {
  it("422 면 **성공이 아니고**, 화면이 옮길 근거를 받지 못한다", async () => {
    const calls: { path: string; body: unknown }[] = [];
    recordStatusCalls(calls, blocked);
    const { result } = setup();

    let ok = true;
    await act(async () => {
      ok = await result.current.setStatus(TASK, { status: "done" });
    });

    // **낙관적으로 옮기지 않으므로** 되돌릴 것이 없다 — 애초에 안 바뀐다.
    expect(ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("전이 그래프 위반(409)도 같은 문을 지난다 — 훅이 하나라 분기가 갈리지 않는다", async () => {
    const calls: { path: string; body: unknown }[] = [];
    recordStatusCalls(calls, () =>
      HttpResponse.json(
        { detail: "이 상태로는 바꿀 수 없습니다", code: "invalid_status_transition" },
        { status: 409 },
      ),
    );
    const { result } = setup();

    let ok = true;
    await act(async () => {
      ok = await result.current.setStatus(TASK, { status: "cancelled" });
    });

    expect(ok).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

describe("세 진입점이 같은 요청을 낸다", () => {
  it("리스트 셀·상세 드롭다운·칸반 드롭이 **같은 경로·같은 본문**을 낸다", async () => {
    const calls: { path: string; body: unknown }[] = [];
    recordStatusCalls(calls, () => HttpResponse.json({ ...TASK, status: "done" }));
    const { result } = setup();

    // 셋 다 같은 훅의 같은 함수를 지난다 — 그것이 「같은 요청」의 근거다.
    await act(async () => {
      await result.current.setStatus(TASK, { status: "done" }); // ① 리스트 상태 셀
      await result.current.setStatus(TASK, { status: "done" }); // ② 상세 헤더 드롭다운
      await result.current.setStatus(TASK, { status: "done" }); // ③ 칸반 DnD
    });

    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((call) => call.path))).toEqual(new Set(["/api/tasks/42/status"]));
    expect(calls.map((call) => call.body)).toEqual([
      { status: "done" },
      { status: "done" },
      { status: "done" },
    ]);
  });

  it("취소는 사유를 싣고 나머지는 싣지 않는다(T-7)", async () => {
    const calls: { path: string; body: unknown }[] = [];
    recordStatusCalls(calls, () => HttpResponse.json({ ...TASK, status: "cancelled" }));
    const { result } = setup();

    await act(async () => {
      await result.current.setStatus(TASK, {
        status: "cancelled",
        cancelReason: "요건 변경",
        logCancelReason: true,
      });
    });

    expect(calls[0].body).toEqual({
      status: "cancelled",
      cancelReason: "요건 변경",
      logCancelReason: true,
    });
  });
});

describe("칸반 DnD — 요청을 내지 않는 경우", () => {
  /** `dragProps`/`columnProps` 가 만드는 이벤트 핸들러를 직접 부른다. */
  function dragEvent() {
    return {
      preventDefault: () => undefined,
      dataTransfer: { effectAllowed: "", dropEffect: "", setData: () => undefined },
    } as unknown as React.DragEvent;
  }

  it("**같은 컬럼에 다시 놓으면 요청이 0건**이다 — 서버는 같은 상태 재전송을 409 로 낸다", () => {
    const dropped: string[] = [];
    const { result } = renderHook(() =>
      useKanbanDnd({ items: [TASK], onDrop: (_task, next) => dropped.push(next) }),
    );

    act(() => {
      result.current.dragProps(TASK).onDragStart(dragEvent());
    });
    act(() => {
      // 잡은 카드가 이미 있던 컬럼(`in_progress`)에 그대로 놓는다.
      result.current.columnProps("in_progress").onDrop(dragEvent());
    });

    expect(dropped).toEqual([]);
  });

  it("전이 그래프가 막는 컬럼에는 **놓이지 않는다** — 완료 → 취소", () => {
    const dropped: string[] = [];
    const done: TaskListItem = { ...TASK, status: "done" };
    const { result } = renderHook(() =>
      useKanbanDnd({ items: [done], onDrop: (_task, next) => dropped.push(next) }),
    );

    act(() => {
      result.current.dragProps(done).onDragStart(dragEvent());
    });
    expect(result.current.blockedReason("cancelled")).toBe(
      "완료는 진행중으로 되돌린 뒤 취소할 수 있습니다",
    );

    act(() => {
      result.current.columnProps("cancelled").onDrop(dragEvent());
    });
    expect(dropped).toEqual([]);
  });

  it("**완료 컬럼은 언제나 열려 있다** — 결과자료 유무를 화면이 미리 판단하지 않는다", () => {
    const dropped: string[] = [];
    const { result } = renderHook(() =>
      useKanbanDnd({ items: [TASK], onDrop: (_task, next) => dropped.push(next) }),
    );

    act(() => {
      result.current.dragProps(TASK).onDragStart(dragEvent());
    });
    // 게이트는 **놓은 뒤 서버가** 판정한다(§5).
    expect(result.current.blockedReason("done")).toBeNull();

    act(() => {
      result.current.columnProps("done").onDrop(dragEvent());
    });
    expect(dropped).toEqual(["done"]);
  });
});
