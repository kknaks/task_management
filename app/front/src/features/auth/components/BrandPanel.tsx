"use client";

/**
 * 로그인 좌측 브랜드 패널 — `11-auth-profile.md §로그인` · `로그인 · 계정 · 프로필.dc.html [로그인]`.
 *
 * **그라디언트는 홈 상단과 이 패널에만** 쓴다(`09-design-tokens.md` §그 외 규칙).
 * 값은 `tokens.css` 의 `--tm-brand-gradient` 하나이고 컴포넌트에 hex 가 없다(§11 금지 목록 4).
 *
 * 반응형(SPEC-001 U-8) — **≥1440 에서만 보인다.** 1280~1439 는 패널을 숨기고 폼을 가운데
 * 두므로, 숨김 판단은 부모 레이아웃이 하고 이 컴포넌트는 내용만 갖는다.
 * 폭은 **유동(40% · 최소 480)** 이고 `position:absolute` 로 박지 않는다(FE-C4).
 */

import { BrandMark } from "@/features/auth/components/BrandMark";

/** 디자인 원본의 특징 3줄. 문구를 새로 만들지 않는다. */
const FEATURES = [
  "회의 중 받아쓴 내용을 회의록과 업무로 자동 정리",
  "메일 · 카카오톡 · 슬랙에서 온 요청을 한 화면에서",
  "문서와 첨부는 PARA 구조의 자료함에 그대로 보관",
];

export function BrandPanel() {
  return (
    <aside className="hidden min-h-screen w-[40%] min-w-[480px] shrink-0 flex-col justify-between bg-brand px-[72px] py-16 wide:flex">
      <BrandMark />

      <div className="flex flex-col gap-6">
        <h2 className="text-[44px] font-bold leading-[1.25] tracking-[-0.03em] text-foreground">
          오늘 한 일이
          <br />
          내일의 기록이 되도록
        </h2>
        <p className="text-body text-muted-foreground">
          회의도, 메시지도, 흩어진 메모도 한곳에서.
          <br />
          Managment가 업무로 정리해 드립니다.
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        {FEATURES.map((feature) => (
          <li key={feature} className="text-meta text-fg-meta">
            {feature}
          </li>
        ))}
      </ul>
    </aside>
  );
}
