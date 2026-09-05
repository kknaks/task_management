"use client";

/**
 * 루트는 **진입 지점 하나**다 — 화면을 갖지 않고 `/tasks` 로 넘긴다
 * (로그인 후 기본 진입 — FE §1 · SPEC-001 U-1).
 *
 * 세션 판정은 여기서 하지 않는다. `(app)/layout.tsx` 의 가드가 토큰을 보고
 * 없으면 로그인 화면으로 보낸다(§4-3) — 판단하는 자리를 둘로 나누지 않는다.
 *
 * WORK-001 의 연결 확인 화면(SPEC-000 U-1)이 있던 자리다. 로그인 화면이 앱의 첫 화면이
 * 되면서 대체됐다(WORK-002 Rollback 「함께 되돌린다」).
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Page() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/tasks/");
  }, [router]);

  return null;
}
