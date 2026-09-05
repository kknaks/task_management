"use client";

/**
 * **쿼리 파싱은 영역 훅 하나**(frontend/README.md §1-2). 컴포넌트가 직접 파싱하지 않는다.
 *
 * 정적 빌드라 **동적 세그먼트를 쓰지 않는다** — 식별은 전부 `?id=` 다(§1-2).
 * WORK-005 가 `view`·필터를 여기에 덧붙인다.
 */

import { useSearchParams } from "next/navigation";

export function useTasksViewParams(): { id: number | null } {
  const params = useSearchParams();
  const raw = params.get("id");
  // id 는 **number** 다(PK 가 bigint — FE §3-6). 숫자가 아니면 「없는 업무」로 흘려보낸다.
  const parsed = raw === null ? Number.NaN : Number(raw);
  return { id: Number.isInteger(parsed) && parsed > 0 ? parsed : null };
}
