/**
 * **낙관적 갱신은 세 자리만**(SPEC-003 §5 표 · 검수 W-2)과 **캐시 오염 가드**(검수 F-4).
 *
 * > 할일 체크·메모 추가·인라인 텍스트 — **한다** — 거부할 규칙이 없다.
 * > 기한·유형·프로젝트·첨부 — **하지 않는다** — 겹침·삭제된 항목이 **거부할 수 있다**.
 *
 * 그 구분이 §5 표의 요점이라 **양쪽을 다 본다** — 「한다」쪽은 즉시 반영·롤백을,
 * 「안 한다」쪽은 **응답 전에 값이 안 바뀌는 것**을(그래서 원복이 저절로 된다).
 */

import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";

import { render, screen } from "@testing-library/react";

import { useCollectionSave } from "@/features/tasks/hooks/useTaskFieldSave";
import { useTaskMutations } from "@/features/tasks/hooks/useTaskMutations";
import type { TaskDetail } from "@/features/tasks/types";
import { tokenStore } from "@/lib/auth/tokenStore";
import { API_ERROR_CODE, ApiError, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/queryKeys";
import { API_BASE, server } from "@/test/server";

const TASK: TaskDetail = {
  id: 7,
  title: "낙관 검증",
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
  description: null,
  completionResult: null,
  cancelReason: null,
  todos: [{ id: 11, text: "체크 대상", done: false, dueDate: null }],
  todoProgress: { done: 0, total: 1 },
  memos: [],
  attachments: [],
  relations: [],
  relationTotal: 0,
  logs: [],
  createdAt: "2026-09-06T00:00:00Z",
  updatedAt: "2026-09-06T00:00:00Z",
};

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(queryKeys.taskDetail(TASK.id), TASK);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useTaskMutations(TASK.id), { wrapper });
  const read = () => client.getQueryData<TaskDetail>(queryKeys.taskDetail(TASK.id));
  return { result, read };
}

/** 응답을 우리가 놓아줄 때까지 붙잡는다 — 「응답 전」 상태를 보기 위해서다. */
function pending() {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { gate, release: () => release() };
}

beforeEach(() => {
  tokenStore.setAccess("A1");
});

afterEach(async () => {
  await tokenStore.clear();
});

describe("§5 낙관적 표 — 「한다」 쪽", () => {
  it("할일 체크는 **응답 전에** 진행률이 바뀐다(U-5 「즉시」)", async () => {
    const { gate, release } = pending();
    server.use(
      http.patch(`${API_BASE}/api/tasks/${TASK.id}/todos/11`, async () => {
        await gate;
        return HttpResponse.json({
          ...TASK,
          todos: [{ ...TASK.todos[0], done: true }],
          todoProgress: { done: 1, total: 1 },
        });
      }),
    );
    const { result, read } = setup();

    act(() => {
      void result.current.updateTodo.mutateAsync({ todoId: 11, input: { done: true } });
    });

    // 응답이 아직 오지 않았는데 이미 바뀌어 있다.
    await waitFor(() => expect(read()?.todoProgress).toEqual({ done: 1, total: 1 }));
    expect(read()?.todos[0].done).toBe(true);
    release();
  });

  it("할일 체크가 실패하면 **되돌아간다**", async () => {
    server.use(
      http.patch(`${API_BASE}/api/tasks/${TASK.id}/todos/11`, () =>
        HttpResponse.json({ detail: "서버 오류", code: "internal_error" }, { status: 500 }),
      ),
      http.get(`${API_BASE}/api/tasks/${TASK.id}`, () => HttpResponse.json(TASK)),
    );
    const { result, read } = setup();

    await act(async () => {
      await result.current.updateTodo
        .mutateAsync({ todoId: 11, input: { done: true } })
        .catch(() => undefined);
    });

    expect(read()?.todos[0].done).toBe(false);
    expect(read()?.todoProgress).toEqual({ done: 0, total: 1 });
  });

  it("메모 추가는 **응답 전에** 최상단에 붙고, 실패하면 사라진다", async () => {
    server.use(
      http.post(`${API_BASE}/api/tasks/${TASK.id}/memos`, () =>
        HttpResponse.json({ detail: "서버 오류", code: "internal_error" }, { status: 500 }),
      ),
      http.get(`${API_BASE}/api/tasks/${TASK.id}`, () => HttpResponse.json(TASK)),
    );
    const { result, read } = setup();

    await act(async () => {
      await result.current.addMemo.mutateAsync("첫 메모").catch(() => undefined);
    });

    expect(read()?.memos).toEqual([]);
  });
});

describe("§5 낙관적 표 — 「하지 않는다」 쪽", () => {
  it("기한은 **응답 전에 값이 바뀌지 않는다** — 그래서 거부되면 원복이 저절로 된다", async () => {
    const { gate, release } = pending();
    server.use(
      http.patch(`${API_BASE}/api/tasks/${TASK.id}`, async () => {
        await gate;
        return HttpResponse.json(
          { detail: "그 시간에 다른 일정이 있습니다", code: "schedule_overlap" },
          { status: 409 },
        );
      }),
    );
    const { result, read } = setup();

    act(() => {
      void result.current.update
        .mutateAsync({
          id: TASK.id,
          input: { startDate: "2026-09-08", dueDate: "2026-09-10" },
        })
        .catch(() => undefined);
    });

    // 겹침이 **거부할 수 있는** 변경이라 미리 반영하지 않는다(§5 표).
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(read()?.dueDate).toBeNull();
    release();
  });

  it("인라인 텍스트는 응답 전에 바뀐다 — 같은 `update` 안에서 갈린다", async () => {
    const { gate, release } = pending();
    server.use(
      http.patch(`${API_BASE}/api/tasks/${TASK.id}`, async () => {
        await gate;
        return HttpResponse.json({ ...TASK, description: "왜 하는가" });
      }),
    );
    const { result, read } = setup();

    act(() => {
      void result.current.update.mutateAsync({ id: TASK.id, input: { description: "왜 하는가" } });
    });

    await waitFor(() => expect(read()?.description).toBe("왜 하는가"));
    release();
  });
});

describe("U-7 — 되돌린 뒤에도 **말이 남는다**", () => {
  it("낙관 갱신이 롤백되면 그 행에 실패 표시가 켜지고, 성공하면 꺼진다", async () => {
    const { result } = renderHook(() => useCollectionSave(TASK.id, "할일", false));

    // 실패 — 되돌아가기만 하면 사용자는 체크가 안 눌린 줄 안다.
    await act(async () => {
      await result.current.run("todo:11", () => Promise.reject(new Error("네트워크 오류")));
    });
    expect(result.current.hasFailed("todo:11")).toBe(true);

    render(result.current.notice);
    expect(screen.getByText("할일이 저장되지 않았습니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 저장" })).toBeInTheDocument();

    // 해제 조건은 **성공뿐**이다 — 타이머로 사라지지 않는다.
    await act(async () => {
      await result.current.run("todo:11", () => Promise.resolve());
    });
    expect(result.current.hasFailed("todo:11")).toBe(false);
  });
});

describe("U-7 — 화면이 낡아서 난 실패는 「다시 저장」이 아니다", () => {
  it("없는 연관을 해제해 404 가 나면 **표시를 켜지 않고** 목록 갱신으로 푼다", async () => {
    const refreshed: string[] = [];
    const { result } = renderHook(() => useCollectionSave(TASK.id, "연관업무", false));

    await act(async () => {
      await result.current.run(
        "relation:99",
        () => Promise.reject(new ApiError(404, API_ERROR_CODE.NOT_FOUND, "업무를 찾을 수 없습니다")),
        {
          onStale: (error) => {
            if (!isApiError(error) || error.code !== API_ERROR_CODE.NOT_FOUND) {
              return false;
            }
            refreshed.push("refresh");
            return true;
          },
        },
      );
    });

    // 같은 요청을 다시 보내도 또 404 다 — 「다시 저장」을 붙이지 않는다.
    expect(result.current.hasFailed("relation:99")).toBe(false);
    expect(refreshed).toEqual(["refresh"]);
  });

  it("404 가 아닌 실패는 그대로 표시가 켜진다 — 분기가 **404 에만** 걸린다", async () => {
    const { result } = renderHook(() => useCollectionSave(TASK.id, "연관업무", false));

    await act(async () => {
      await result.current.run(
        "relation:99",
        () => Promise.reject(new ApiError(500, "internal_error", "서버 오류")),
        { onStale: (error) => isApiError(error) && error.code === API_ERROR_CODE.NOT_FOUND },
      );
    });

    expect(result.current.hasFailed("relation:99")).toBe(true);
  });

  it("「다시 저장」은 **정확히 1건**만 보낸다 — 자동 재시도가 없다", async () => {
    let sent = 0;
    const { result } = renderHook(() => useCollectionSave(TASK.id, "참고자료", false));

    await act(async () => {
      await result.current.run("attachment:new", () => {
        sent += 1;
        return Promise.reject(new ApiError(500, "internal_error", "서버 오류"));
      });
    });
    expect(sent).toBe(1);

    // 시간이 지나도 저절로 나가지 않는다.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(sent).toBe(1);
  });
});

describe("F-4 — 상세 캐시에 상세 아닌 것을 쓰지 않는다", () => {
  it("응답 id 가 기대한 업무 id 와 다르면 **즉시 드러난다**", async () => {
    // 서버가 계약을 어기고 자식 한 건을 돌려준 상황(옛 `TodoItem` 응답).
    server.use(
      http.patch(`${API_BASE}/api/tasks/${TASK.id}/todos/11`, () =>
        HttpResponse.json({ id: 11, text: "체크 대상", done: true, dueDate: null }),
      ),
    );
    const { result, read } = setup();

    await act(async () => {
      await result.current.updateTodo
        .mutateAsync({ todoId: 11, input: { done: true } })
        .catch(() => undefined);
    });

    // 캐시가 **오염되지 않았다** — 상세는 여전히 업무 형태다(가드가 없으면 할일 객체가 들어간다).
    expect(read()?.todoProgress).toBeDefined();
    expect(read()?.title).toBe("낙관 검증");
  });
});
