import type { Metadata, Viewport } from "next";

import { MinWidthGuard } from "@/components/shared/MinWidthGuard";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "@/app/providers";
import "@/styles/globals.css";

/**
 * 루트 레이아웃 — 폰트 · 토큰 CSS 변수 · QueryClientProvider · OverlayProvider · Toaster
 * (frontend/README.md §1 라우트 트리).
 *
 * 폰트는 `globals.css` 가 **번들에 포함된 Pretendard** 를 싣는다 — 외부 origin 요청이 없다
 * (CDN 금지 — SPEC-000 §5 · SYS-3).
 *
 * 세션 가드는 여기가 아니라 `(app)/layout.tsx` 다(§4-3). WORK-002 가 만든다.
 */
export const metadata: Metadata = {
  title: "task-management",
  description: "개인 업무 관리",
};

export const viewport: Viewport = {
  // 데스크톱 전용이다 — 최소 폭은 안내 화면(P-02)이 막는다(§7-2).
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <Providers>
          <MinWidthGuard>{children}</MinWidthGuard>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
