"use client";

/**
 * **쿼리 파싱은 영역 훅 하나**(frontend/README.md §1-2). 컴포넌트가 직접 파싱하지 않는다.
 *
 * 정적 빌드라 **동적 세그먼트를 쓰지 않는다** — 식별은 전부 `?id=` 다(§1-2).
 *
 * ## 조건은 전부 `?` 에 남는다(SPEC-004 §5 · U-12)
 *
 * 기간·유형·상태·프로젝트·정렬·뷰가 전부 쿼리에 있다. **컴포넌트가 자체 상태로 들지 않는다** —
 * `useState` 로 두면 새로고침·뒤로가기에서 잃고, **뷰를 바꿀 때 기간·유형이 날아간다.**
 * 뷰 토글이 조건을 유지하는 것도 여기서 저절로 따라온다(같은 쿼리에 `view` 만 갈아 끼운다).
 */

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { TaskSort, TaskStatus, TasksView } from "@/features/tasks/types";

/** 한 페이지에 12건 — 리스트 하단 페이지네이션의 단위다(§4 응답 예시). */
export const TASKS_PAGE_SIZE = 12;

const SORTS: readonly TaskSort[] = ["due_asc", "due_desc", "created_desc"];
const STATUSES: readonly TaskStatus[] = ["todo", "in_progress", "done", "cancelled"];

export interface TasksViewParams {
  /** 상세 `?id=` — WORK-004 가 쓰던 그대로다. */
  id: number | null;
  view: TasksView;
  /** 기준 달의 **첫날**(`YYYY-MM-01`). 기간 스테퍼가 이 값 하나만 움직인다. */
  month: string;
  workTypeId: number | null;
  status: TaskStatus | null;
  projectId: number | null;
  sort: TaskSort;
  page: number;
}

/** `?month=` 이 없거나 이상하면 **이번 달**이다(§4 「기본은 이번 달」). */
function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function parseMonth(raw: string | null): string {
  if (raw !== null && /^\d{4}-\d{2}-01$/.test(raw)) {
    return raw;
  }
  return currentMonth();
}

function parseId(raw: string | null): number | null {
  const parsed = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function useTasksViewParams(): TasksViewParams & {
  /** 조건 하나를 갈아 끼운다. **`null` 은 그 조건을 지운다**(쿼리에서 키가 빠진다). */
  setParams: (next: Partial<Record<keyof TasksViewParams, string | number | null>>) => void;
  /** 유형·상태·프로젝트를 한꺼번에 지운다 — 빈 상태의 「필터 지우기」. */
  clearFilters: () => void;
  /** 활성 필터 수 — 타이틀 옆 「필터 n ✕」. **기간·정렬·뷰는 세지 않는다**(항상 값이 있다). */
  activeFilterCount: number;
} {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const rawStatus = params.get("status");
  const rawSort = params.get("sort");
  const rawPage = Number(params.get("page"));

  const parsed = useMemo<TasksViewParams>(
    () => ({
      id: parseId(params.get("id")),
      view: params.get("view") === "board" ? "board" : "list",
      month: parseMonth(params.get("month")),
      workTypeId: parseId(params.get("workTypeId")),
      status: STATUSES.includes(rawStatus as TaskStatus) ? (rawStatus as TaskStatus) : null,
      projectId: parseId(params.get("projectId")),
      sort: SORTS.includes(rawSort as TaskSort) ? (rawSort as TaskSort) : "due_asc",
      page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1,
    }),
    [params, rawPage, rawSort, rawStatus],
  );

  const setParams = useCallback(
    (next: Partial<Record<keyof TasksViewParams, string | number | null>>) => {
      const search = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(next)) {
        if (value === null || value === "") {
          search.delete(key);
        } else {
          search.set(key, String(value));
        }
      }
      // 조건이 바뀌면 **1페이지로 돌아간다** — 3페이지를 보다 필터를 걸면 빈 화면이 된다.
      if (!("page" in next)) {
        search.delete("page");
      }
      router.replace(`${pathname}?${search.toString()}`);
    },
    [params, pathname, router],
  );

  const clearFilters = useCallback(
    () => setParams({ workTypeId: null, status: null, projectId: null }),
    [setParams],
  );

  const activeFilterCount =
    (parsed.workTypeId === null ? 0 : 1) +
    (parsed.status === null ? 0 : 1) +
    (parsed.projectId === null ? 0 : 1);

  return { ...parsed, setParams, clearFilters, activeFilterCount };
}

/**
 * 달의 경계를 **UTC 로** 만든다(G-2 — 「기간 조회는 UTC 경계로 보낸다」).
 * 서버가 `from`·`to` 를 함께 받으므로 화면이 한 곳에서만 변환한다.
 */
export function monthRange(month: string): { from: string; to: string } {
  const [year, mon] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, mon - 1, 1));
  const last = new Date(Date.UTC(year, mon, 0));
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  return { from: iso(first), to: iso(last) };
}

/** 달을 앞뒤로 옮긴다. 기간 스테퍼의 `‹`·`›` 가 부른다. */
export function shiftMonth(month: string, delta: number): string {
  const [year, mon] = month.split("-").map(Number);
  const moved = new Date(Date.UTC(year, mon - 1 + delta, 1));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** 「2026년 8월」 — 기간 스테퍼와 하단 카운트가 같은 문구를 쓴다. */
export function formatMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  return `${year}년 ${mon}월`;
}
