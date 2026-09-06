"use client";

/**
 * **업무 설정 화면** — 「업무 유형」 패널 + 「프로젝트」 패널(SPEC-002 §2 Placement).
 *
 * 패널 간 간격 20. 좌측 메뉴 카드는 `(app)/settings/layout.tsx` 가 이미 그린다(SPEC-001 U-4).
 * 폭은 **유동**이고 `position:absolute` 로 박지 않는다(U-8 · FE-C4).
 */

import { ProjectPanel } from "@/features/settings/components/ProjectPanel";
import { WorkTypePanel } from "@/features/settings/components/WorkTypePanel";

export function WorkSettingsScreen() {
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-page-title text-foreground">업무 설정</h1>
      <WorkTypePanel />
      <ProjectPanel />
    </div>
  );
}
