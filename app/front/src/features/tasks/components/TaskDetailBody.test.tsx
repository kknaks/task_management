/**
 * **U-7 자동 저장 실패가 상세에서도 같은 규격인지**(SPEC-002 U-7 · SPEC-003 U-2).
 *
 * > 실패 응답에 **토스트 + 그 필드의 실패 표시**가 **함께** 뜨고 **재시도가 나가지 않는다**
 * > (`frontend/README.md` §11 3).
 *
 * WORK-003 이 세운 규격을 **새로 만들지 않고 그대로 쓰는지**가 이 파일의 관심사다 —
 * 컨트롤은 테두리만 바꾸고 캡션·「다시 저장」은 **인라인 자리 하나**가 그린다.
 */

import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Toaster } from "@/components/ui/sonner";
import { TaskDetailBody } from "@/features/tasks/components/TaskDetailBody";
import type { TaskDetail } from "@/features/tasks/types";
import { tokenStore } from "@/lib/auth/tokenStore";
import { API_BASE, server } from "@/test/server";

const TASK: TaskDetail = {
  id: 12,
  title: "제품 소개서 내용 업데이트",
  status: "todo",
  workType: { id: 3, name: "문서·보고", kind: "task", colorToken: "steel", isDeleted: false },
  project: null,
  startDate: null,
  dueDate: null,
  startedAt: null,
  completedAt: null,
  cancelledAt: null,
  dDay: null,
  isOverdue: false,
  description: "",
  completionResult: null,
  cancelReason: null,
  todos: [],
  todoProgress: { done: 0, total: 0 },
  memos: [],
  attachments: [],
  relations: [],
  relationTotal: 0,
  logs: [],
  createdAt: "2026-09-06T00:00:00Z",
  updatedAt: "2026-09-06T00:00:00Z",
};

const TOAST = "저장하지 못했습니다 · 설명";
const NOTICE = "설명이 저장되지 않았습니다";

function renderBody() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TaskDetailBody task={TASK} />
      <Toaster />
    </QueryClientProvider>,
  );
}

/** PATCH 를 막고 **들어온 요청 수**를 센다 — 「자동 재시도 없음」의 증거다. */
function blockPatch() {
  const calls: unknown[] = [];
  server.use(
    http.patch(`${API_BASE}/api/tasks/${TASK.id}`, async ({ request }) => {
      calls.push(await request.json());
      return HttpResponse.json({ detail: "서버 오류", code: "internal_error" }, { status: 500 });
    }),
  );
  return calls;
}

beforeEach(() => {
  tokenStore.setAccess("A1");
});

afterEach(async () => {
  await tokenStore.clear();
});

describe("U-7 — 상세의 자동 저장 실패도 같은 규격이다", () => {
  it("설명 저장이 실패하면 토스트와 인라인 표시가 **함께** 뜬다", async () => {
    const calls = blockPatch();
    renderBody();

    const field = screen.getByLabelText("설명");
    await userEvent.type(field, "왜 하는가");
    await userEvent.tab();

    expect(await screen.findByText(TOAST)).toBeInTheDocument();
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    // 실패한 컨트롤 자신에 테두리 실패색(U-7)
    expect(screen.getByLabelText("설명")).toHaveAttribute("aria-invalid", "true");
    expect(calls).toHaveLength(1);
  });

  it("**자동 재시도가 없다** — 가만히 두어도 요청이 늘지 않는다", async () => {
    const calls = blockPatch();
    renderBody();

    // 배경·목표가 **설명 한 칸**으로 합쳐졌다(DEC-002) — 같은 필드로 재시도 없음을 본다
    await userEvent.type(screen.getByLabelText("설명"), "무엇이 되면 끝인가");
    await userEvent.tab();
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(calls).toHaveLength(1);
  });

  it("「다시 저장」은 **정확히 1건**만 내고, 성공하면 그 줄이 사라진다", async () => {
    const calls = blockPatch();
    renderBody();

    await userEvent.type(screen.getByLabelText("설명"), "왜 하는가");
    await userEvent.tab();
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    expect(calls).toHaveLength(1);

    // 서버가 살아났다.
    server.use(
      http.patch(`${API_BASE}/api/tasks/${TASK.id}`, async ({ request }) => {
        calls.push(await request.json());
        return HttpResponse.json({ ...TASK, description: "왜 하는가" });
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: "다시 저장" }));

    await waitFor(() => expect(screen.queryByText(NOTICE)).not.toBeInTheDocument());
    // 처음 1건 + 「다시 저장」 1건. **누른 만큼만** 나갔다.
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ description: "왜 하는가" });
  });

  it("상태를 바꾸는 컨트롤이 **본문에 없다** — 전이는 WORK-005 몫이다", () => {
    renderBody();

    expect(screen.queryByRole("button", { name: "완료 처리" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "상태 변경" })).not.toBeInTheDocument();
  });
});
