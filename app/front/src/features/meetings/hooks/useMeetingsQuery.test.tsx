/**
 * **프론트가 실제로 보내는 `from`·`to`·`projectId`·`sort`**(SPEC-006 §4 `GET /api/meetings`).
 *
 * 앱 창 항목 「`‹` 로 지난달에 가면 그 달만 보이고 새로고침해도 그 달이다」의 **서버로 나가는 절반**을
 * 여기서 고정한다 — `?month=` → KST 달 경계 → UTC ISO.
 */

import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";

import { useMeetingsQuery } from "@/features/meetings/hooks/useMeetingsQuery";
import { periodOfMonth, periodRange } from "@/lib/datetime";
import { tokenStore } from "@/lib/auth/tokenStore";
import { API_BASE, server } from "@/test/server";

const EMPTY = { items: [], total: 0, projectCounts: [] };

function recordQuery(seen: URLSearchParams[]) {
  server.use(
    http.get(`${API_BASE}/api/meetings`, ({ request }) => {
      seen.push(new URL(request.url).searchParams);
      return HttpResponse.json(EMPTY);
    }),
  );
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  tokenStore.setAccess("A1");
});

afterEach(async () => {
  await tokenStore.clear();
});

describe("월 범위가 그대로 서버로 나간다", () => {
  it("`?month=2026-08` 은 KST 8월 경계 `[from, to)` 를 UTC ISO 로 보낸다", async () => {
    const seen: URLSearchParams[] = [];
    recordQuery(seen);
    const { from, to } = periodRange(periodOfMonth("2026-08"));

    renderHook(() => useMeetingsQuery({ from, to, projectId: null, sort: "latest" }), { wrapper });

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].get("from")).toBe("2026-07-31T15:00:00.000Z");
    // 끝은 **9월 1일 00:00 KST**(배타) — 8월 31일 회의가 빠지지 않는다.
    expect(seen[0].get("to")).toBe("2026-08-31T15:00:00.000Z");
    expect(seen[0].get("sort")).toBe("latest");
    // 전체면 `projectId` 키 자체를 보내지 않는다.
    expect(seen[0].has("projectId")).toBe(false);
  });

  it("「미정」 칩은 `projectId=none`, 프로젝트 칩은 숫자, 「오래된순」은 `sort=oldest`", async () => {
    const seen: URLSearchParams[] = [];
    recordQuery(seen);
    const { from, to } = periodRange(periodOfMonth("2026-08"));

    renderHook(() => useMeetingsQuery({ from, to, projectId: "none", sort: "oldest" }), { wrapper });
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].get("projectId")).toBe("none");
    expect(seen[0].get("sort")).toBe("oldest");

    renderHook(() => useMeetingsQuery({ from, to, projectId: 5, sort: "latest" }), { wrapper });
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[1].get("projectId")).toBe("5");
  });
});
