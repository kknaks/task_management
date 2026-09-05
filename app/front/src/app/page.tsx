"use client";

/**
 * **모든 `page.tsx` 는 `'use client'` 다**(frontend/README.md §1-3).
 * 라우트 파일은 껍데기고 화면 컴포넌트 하나를 렌더한다(§2 규칙 1).
 *
 * 이 자리는 **WORK-002 가 로그인 리다이렉트로 대체한다**(SPEC-000 §2 U-1).
 */

import { ConnectionCheckScreen } from "@/features/health/components/ConnectionCheckScreen";

export default function Page() {
  return <ConnectionCheckScreen />;
}
