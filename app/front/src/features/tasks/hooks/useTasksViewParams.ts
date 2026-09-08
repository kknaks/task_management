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

import { currentPeriod, isDateKey, type Period } from "@/lib/datetime";
import type { TaskSort, TaskStatus, TasksView } from "@/features/tasks/types";

/** 한 페이지에 12건 — **리스트** 하단 페이지네이션의 단위다(§4 응답 예시). */
export const TASKS_PAGE_SIZE = 12;

/**
 * **칸반은 페이지를 쓰지 않는다**(SPEC-004 U-2 「데이터 범위」, 2026-09-06 확정).
 *
 * 리스트의 페이지 크기를 물려받으면 **13번째 업무부터 화면에 나타날 길이 없다** —
 * 페이지네이션 UI 가 리스트 전용이라 사용자는 그 달 업무가 12건뿐이라고 읽는다(검수 F-2).
 * 상한 500 은 서버가 받는 최대값이고, 넘으면 **조용히 자르지 않고** 보드 하단에 알린다.
 */
export const KANBAN_MAX_SIZE = 500;

const SORTS: readonly TaskSort[] = ["due_asc", "due_desc", "created_desc"];
const STATUSES: readonly TaskStatus[] = ["todo", "in_progress", "done", "cancelled"];

/**
 * **URL 쿼리 키** — 화면이 갈아 끼울 수 있는 것들.
 * `period` 는 값이 하나가 아니라 `from`·`to` 두 키로 나가므로 여기서 갈린다.
 */
type QueryKey = Exclude<keyof TasksViewParams, "period"> | "from" | "to";

export interface TasksViewParams {
  /** 상세 `?id=` — WORK-004 가 쓰던 그대로다. */
  id: number | null;
  view: TasksView;
  /**
   * 보고 있는 **기간**(`?from=`·`?to=`, 둘 다 `YYYY-MM-DD` 이고 **끝날 포함**).
   *
   * 전에는 `?month=` 하나였다. 사용자가 시작일–종료일을 직접 고를 수 있게 되면서
   * **범위가 1급**이 됐고 달은 「범위가 마침 달 경계와 같은 경우」다(E-3).
   * 둘 중 하나라도 없거나 이상하면 **이번 달**로 떨어진다.
   */
  period: Period;
  workTypeId: number | null;
  status: TaskStatus | null;
  projectId: number | null;
  sort: TaskSort;
  page: number;
}

/**
 * `?from=`·`?to=` 가 없거나 이상하면 **이번 달**이다(§4 「기본은 이번 달」).
 * 「이번 달」 판정은 **KST 기준**이고 `lib/datetime.ts` 가 든다(§3-6 · 검수 W-7).
 *
 * 뒤집힌 범위(`from > to`)도 기본으로 떨어뜨린다 — 고쳐서 쓰면 사용자가 손댄 적 없는
 * 기간을 보게 된다.
 */
function parsePeriod(rawFrom: string | null, rawTo: string | null): Period {
  if (isDateKey(rawFrom) && isDateKey(rawTo) && rawFrom <= rawTo) {
    return { from: rawFrom, to: rawTo };
  }
  return currentPeriod();
}

function parseId(raw: string | null): number | null {
  const parsed = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function useTasksViewParams(): TasksViewParams & {
  /**
   * 조건 하나를 갈아 끼운다. **`null` 은 그 조건을 지운다**(쿼리에서 키가 빠진다).
   * 기간은 값이 둘이라 이걸로 못 넣는다 — `setPeriod` 를 쓴다.
   */
  setParams: (next: Partial<Record<QueryKey, string | number | null>>) => void;
  /** 기간을 통째로 바꾼다 — `?from=`·`?to=` 를 함께 쓴다(둘이 늘 짝이라 따로 두지 않는다). */
  setPeriod: (period: Period) => void;
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
  const rawFrom = params.get("from");
  const rawTo = params.get("to");

  const parsed = useMemo<TasksViewParams>(
    () => ({
      id: parseId(params.get("id")),
      view: params.get("view") === "board" ? "board" : "list",
      period: parsePeriod(rawFrom, rawTo),
      workTypeId: parseId(params.get("workTypeId")),
      status: STATUSES.includes(rawStatus as TaskStatus) ? (rawStatus as TaskStatus) : null,
      projectId: parseId(params.get("projectId")),
      sort: SORTS.includes(rawSort as TaskSort) ? (rawSort as TaskSort) : "due_asc",
      page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1,
    }),
    [params, rawFrom, rawPage, rawSort, rawStatus, rawTo],
  );

  /**
   * **뷰 전환만 히스토리를 남긴다**(검수 W-2 · FE §1-2 「쿼리는 … 뒤로가기가 산다」).
   *
   * 전부 `replace` 라 리스트↔칸반을 오간 뒤 뒤로가기를 누르면 **이전 뷰가 아니라 페이지를 떠났다.**
   * 반대로 필터·기간까지 `push` 하면 탭을 몇 번 누른 만큼 히스토리가 쌓여 뒤로가기가 시끄러워진다 —
   * 그래서 **축을 가른다**: 뷰는 「어디를 보고 있나」라 되돌아갈 자리이고, 나머지는 그 안의 조건이다.
   */
  const setParams = useCallback(
    (next: Partial<Record<QueryKey, string | number | null>>) => {
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
      const url = `${pathname}?${search.toString()}`;
      if ("view" in next) {
        router.push(url);
      } else {
        router.replace(url);
      }
    },
    [params, pathname, router],
  );

  const setPeriod = useCallback(
    (period: Period) => setParams({ from: period.from, to: period.to }),
    [setParams],
  );

  const clearFilters = useCallback(
    () => setParams({ workTypeId: null, status: null, projectId: null }),
    [setParams],
  );

  const activeFilterCount =
    (parsed.workTypeId === null ? 0 : 1) +
    (parsed.status === null ? 0 : 1) +
    (parsed.projectId === null ? 0 : 1);

  return { ...parsed, setParams, setPeriod, clearFilters, activeFilterCount };
}

/**
 * 달 경계·달 이동·달 표기는 **`lib/datetime.ts` 하나**가 든다(§3-6 「KST 변환은 그 파일 하나」 ·
 * 검수 W-7). 여기서 다시 내보내지 않는다 — 쓰는 곳이 직접 그 파일에서 가져간다.
 */
