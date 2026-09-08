/**
 * **프론트가 실제로 보내는 `from`·`to`**(검수 F-1)와 **칸반의 데이터 범위**(F-2).
 *
 * `lib/datetime.test.ts` 가 규칙을 고정한다면, 여기는 **그 값이 그대로 서버로 나가는지**를 본다 —
 * 계산이 맞아도 쿼리 문자열을 만드는 자리에서 다시 어긋날 수 있다.
 */

import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";

import { useTasksQuery } from "@/features/tasks/hooks/useTasksQuery";
import { KANBAN_MAX_SIZE, TASKS_PAGE_SIZE } from "@/features/tasks/hooks/useTasksViewParams";
import { monthOf, periodRange } from "@/lib/datetime";
import { tokenStore } from "@/lib/auth/tokenStore";
import { API_BASE, server } from "@/test/server";

const EMPTY = {
  items: [],
  total: 0,
  page: 1,
  size: TASKS_PAGE_SIZE,
  typeCounts: [],
  statusCounts: { todo: 0, inProgress: 0, done: 0, cancelled: 0 },
  unfilteredTotal: 0,
};

/** 서버가 받은 쿼리를 기록한다 — 「무엇을 보냈나」가 이 테스트의 대상이다. */
function recordQuery(seen: URLSearchParams[]) {
  server.use(
    http.get(`${API_BASE}/api/tasks`, ({ request }) => {
      seen.push(new URL(request.url).searchParams);
      return HttpResponse.json(EMPTY);
    }),
  );
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const base = {
  workTypeId: null,
  status: null,
  projectId: null,
  sort: "due_asc" as const,
  page: 1,
};

beforeEach(() => {
  tokenStore.setAccess("A1");
});

afterEach(async () => {
  await tokenStore.clear();
});

describe("기간 경계가 그대로 서버로 나간다", () => {
  it("**끝이 다음 달 1일**이고 오프셋이 붙은 UTC ISO 다", async () => {
    const seen: URLSearchParams[] = [];
    recordQuery(seen);
    const { from, to } = periodRange(monthOf("2026-09-01"));

    renderHook(() => useTasksQuery({ ...base, from, to, size: TASKS_PAGE_SIZE }), { wrapper });

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].get("from")).toBe("2026-08-31T15:00:00.000Z");
    // 말일(2026-09-30)이 아니라 **다음 달 1일**이다 — 말일 기한이 빠지지 않는다.
    expect(seen[0].get("to")).toBe("2026-09-30T15:00:00.000Z");
  });

  it("값이 없는 조건은 **키 자체를 보내지 않는다** — 서버가 「없음」과 「빈 값」을 구분한다", async () => {
    const seen: URLSearchParams[] = [];
    recordQuery(seen);
    const { from, to } = periodRange(monthOf("2026-09-01"));

    renderHook(() => useTasksQuery({ ...base, from, to, size: TASKS_PAGE_SIZE }), { wrapper });

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].has("workTypeId")).toBe(false);
    expect(seen[0].has("status")).toBe(false);
    expect(seen[0].has("projectId")).toBe(false);
  });
});

describe("칸반은 페이지를 쓰지 않는다(U-2 데이터 범위)", () => {
  it("리스트는 12건, 칸반은 상한 500 을 보낸다 — 13번째 업무가 사라지지 않는다", async () => {
    const seen: URLSearchParams[] = [];
    recordQuery(seen);
    const { from, to } = periodRange(monthOf("2026-09-01"));

    renderHook(() => useTasksQuery({ ...base, from, to, size: TASKS_PAGE_SIZE }), { wrapper });
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].get("size")).toBe(String(TASKS_PAGE_SIZE));

    renderHook(() => useTasksQuery({ ...base, from, to, size: KANBAN_MAX_SIZE }), { wrapper });
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[1].get("size")).toBe("500");
  });
});
