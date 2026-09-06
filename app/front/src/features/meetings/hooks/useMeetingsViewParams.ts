"use client";

/**
 * **쿼리 파싱은 영역 훅 하나**(frontend/README.md §1-2). 컴포넌트가 직접 파싱하지 않는다.
 *
 * 정적 빌드라 **동적 세그먼트를 쓰지 않는다** — 식별은 전부 `?id=` 다(§1-2).
 *
 * ## 조건은 전부 `?` 에 남는다(SPEC-006 U-1·U-2)
 *
 * - `?month=YYYY-MM` — 보고 있는 달. 없거나 이상하면 **이번 달**(KST). 뒤로가기·새로고침에서 산다
 * - `?projectId=` — 숫자 또는 `none`(「미정」). 없으면 전체
 * - `?sort=` — `latest`(기본) · `oldest`
 * - `?id=` — 목록에서 **선택한 행** / 상세 라우트의 회의
 */

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { MeetingProjectFilter, MeetingSort } from "@/features/meetings/types";
import {
  currentMonthKey,
  isMonthKey,
  periodOfMonth,
  type MonthKey,
  type Period,
} from "@/lib/datetime";

const SORTS: readonly MeetingSort[] = ["latest", "oldest"];

export interface MeetingsViewParams {
  id: number | null;
  month: MonthKey;
  /** `month` 가 가리키는 달 전체 — 스테퍼 라벨·서버 경계의 입력. */
  period: Period;
  projectId: MeetingProjectFilter;
  sort: MeetingSort;
}

function parseId(raw: string | null): number | null {
  const parsed = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseProject(raw: string | null): MeetingProjectFilter {
  if (raw === "none") {
    return "none";
  }
  return parseId(raw);
}

export function useMeetingsViewParams(): MeetingsViewParams & {
  /** 조건 하나를 갈아 끼운다. **`null` 은 그 조건을 지운다**(쿼리에서 키가 빠진다). */
  setParams: (next: Partial<Record<"id" | "month" | "projectId" | "sort", string | number | null>>) => void;
} {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const rawMonth = params.get("month");
  const rawSort = params.get("sort");
  const rawProject = params.get("projectId");
  const rawId = params.get("id");

  const parsed = useMemo<MeetingsViewParams>(() => {
    const month = isMonthKey(rawMonth) ? rawMonth : currentMonthKey();
    return {
      id: parseId(rawId),
      month,
      period: periodOfMonth(month),
      projectId: parseProject(rawProject),
      sort: SORTS.includes(rawSort as MeetingSort) ? (rawSort as MeetingSort) : "latest",
    };
  }, [rawId, rawMonth, rawProject, rawSort]);

  /** 전부 `replace` 다 — 달·필터·선택은 「그 안의 조건」이라 히스토리를 쌓지 않는다(검수 W-2 와 같은 축). */
  const setParams = useCallback(
    (next: Partial<Record<"id" | "month" | "projectId" | "sort", string | number | null>>) => {
      const search = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(next)) {
        if (value === null || value === "") {
          search.delete(key);
        } else {
          search.set(key, String(value));
        }
      }
      const query = search.toString();
      router.replace(query.length > 0 ? `${pathname}?${query}` : pathname);
    },
    [params, pathname, router],
  );

  return { ...parsed, setParams };
}
