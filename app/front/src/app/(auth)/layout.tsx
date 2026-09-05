"use client";

/**
 * 인증 영역 레이아웃 — **셸이 없다**(F-1 · frontend/README.md §1 라우트 트리).
 * 로그인 화면만 앱 셸 밖이고, 그 밖은 전부 `(app)` 아래에 있다.
 *
 * 브랜드 패널·폼 배치는 화면 컴포넌트가 갖는다(U-8 세 구간) — 여기는 껍데기만이다.
 */

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-card">{children}</div>;
}
