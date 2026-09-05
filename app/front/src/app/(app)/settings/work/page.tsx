"use client";

/**
 * **모든 `page.tsx` 는 `'use client'` 다**(frontend/README.md §1-3).
 * 라우트 파일은 껍데기고 화면 컴포넌트 하나를 렌더한다(§2 규칙 1).
 */

import { WorkSettingsScreen } from "@/features/settings/components/WorkSettingsScreen";

export default function Page() {
  return <WorkSettingsScreen />;
}
