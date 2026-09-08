/**
 * **U-8 필터 칩 3 · 카운트 「n건 중 m」**(SPEC-003 §4 `scope` 표 · U-8).
 *
 * 이 파일이 지키는 것 셋.
 * 1. 칩 3 이 `scope` 와 **1:1** 이고 **누르면 서버 질의가 실제로 달라진다** — 안 그러면
 *    화면이 「전체 정렬본」을 세 번 똑같이 보여준다(그게 계약을 늘린 이유다)
 * 2. 카운트의 `n` 은 응답 **`total`**, `m` 은 `items.length` — **`total` 을 `items.length` 로
 *    대신하지 않는다**(20건을 넘으면 갈린다)
 * 3. **기준 프로젝트가 없으면** 「이 프로젝트」는 **비활성**이고 기본이 **「전체」**다
 */

import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RelationPopover } from "@/features/tasks/components/RelationPopover";
import { Button } from "@/components/ui/button";
import { tokenStore } from "@/lib/auth/tokenStore";
import { API_BASE, server } from "@/test/server";

/** scope 별로 **다른 목록·다른 total** 을 준다 — 칩이 실제로 먹는지 보려면 달라야 한다. */
const BY_SCOPE = {
  project: { total: 2, titles: ["같은 프로젝트 A", "같은 프로젝트 B"] },
  recent30: { total: 3, titles: ["최근 1", "최근 2", "최근 3"] },
  // `total`(25) > `items.length`(2) — 20건 상한을 넘긴 상황이다.
  all: { total: 25, titles: ["전체 1", "전체 2"] },
} as const;

/** 서버가 받은 `scope` 를 기록한다 — 질의가 실제로 갈리는지의 증거다. */
function stubCandidates() {
  const scopes: string[] = [];
  server.use(
    http.get(`${API_BASE}/api/tasks/relations/candidates`, ({ request }) => {
      const scope = (new URL(request.url).searchParams.get("scope") ??
        "project") as keyof typeof BY_SCOPE;
      scopes.push(scope);
      const fixture = BY_SCOPE[scope];
      return HttpResponse.json({
        total: fixture.total,
        items: fixture.titles.map((title, index) => ({
          id: index + 1,
          title,
          status: "todo",
          projectName: null,
          dueDate: null,
        })),
      });
    }),
  );
  return scopes;
}

function renderPopover(hasBaseProject: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RelationPopover
        excludeId={11}
        hasBaseProject={hasBaseProject}
        selectedIds={[]}
        onChange={() => undefined}
        trigger={<Button type="button">업무 연결</Button>}
      />
    </QueryClientProvider>,
  );
}

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

beforeEach(() => {
  tokenStore.setAccess("A1");
});

afterEach(async () => {
  await tokenStore.clear();
});

describe("U-8 필터 칩 3 ↔ scope", () => {
  it("기준 프로젝트가 있으면 「이 프로젝트」가 **기본 선택**이고 그 scope 로 질의한다", async () => {
    const scopes = stubCandidates();
    renderPopover(true);

    await user().click(screen.getByRole("button", { name: "업무 연결" }));

    const chip = await screen.findByRole("button", { name: "이 프로젝트" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(scopes).toContain("project"));
    expect(await screen.findByText("같은 프로젝트 A")).toBeInTheDocument();
  });

  it("칩을 바꾸면 **질의도 목록도 실제로 달라진다**", async () => {
    const scopes = stubCandidates();
    renderPopover(true);

    await user().click(screen.getByRole("button", { name: "업무 연결" }));
    expect(await screen.findByText("같은 프로젝트 A")).toBeInTheDocument();

    await user().click(screen.getByRole("button", { name: "최근 30일" }));
    expect(await screen.findByText("최근 1")).toBeInTheDocument();
    expect(screen.queryByText("같은 프로젝트 A")).not.toBeInTheDocument();

    await user().click(screen.getByRole("button", { name: "전체" }));
    expect(await screen.findByText("전체 1")).toBeInTheDocument();

    // 세 칩이 **서로 다른 scope** 로 나갔다 — 같으면 붙지 않은 것이다.
    expect(new Set(scopes)).toEqual(new Set(["project", "recent30", "all"]));
  });

  it("카운트의 `n` 은 응답 `total` 이다 — `items.length` 로 대신하지 않는다", async () => {
    stubCandidates();
    renderPopover(true);

    await user().click(screen.getByRole("button", { name: "업무 연결" }));
    await user().click(await screen.findByRole("button", { name: "전체" }));

    // total 25 · items 2 — 20건 상한을 넘긴 상황이라 둘이 갈린다.
    expect(await screen.findByText("25건 중 2")).toBeInTheDocument();
  });

  it("기준 프로젝트가 없으면 「이 프로젝트」가 **비활성**이고 기본이 **「전체」**다", async () => {
    const scopes = stubCandidates();
    renderPopover(false);

    await user().click(screen.getByRole("button", { name: "업무 연결" }));

    const chip = await screen.findByRole("button", { name: "이 프로젝트" });
    expect(chip).toBeDisabled();
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "전체" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(scopes).toContain("all"));
  });

  it("결과가 0건이면 빈 결과 문구가 뜬다", async () => {
    server.use(
      http.get(`${API_BASE}/api/tasks/relations/candidates`, () =>
        HttpResponse.json({ total: 0, items: [] }),
      ),
    );
    renderPopover(true);

    await user().click(screen.getByRole("button", { name: "업무 연결" }));

    expect(await screen.findByText("검색 결과가 없습니다")).toBeInTheDocument();
    expect(screen.getByText("다른 검색어나 필터를 써 보세요")).toBeInTheDocument();
    expect(screen.getByText("0건 중 0")).toBeInTheDocument();
  });
});
