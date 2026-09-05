"use client";

/**
 * 전역 Provider 조립 — 루트 레이아웃이 이 하나만 렌더한다.
 *
 * 전역 옵션은 **「설계한 실패만 처리한다」를 클라이언트에 옮긴 것**이다(frontend/README.md §3-2).
 * 전역 상태 라이브러리를 두지 않는다 — 서버 상태는 TanStack Query, UI 상태는 URL 쿼리 + 로컬(§3-1).
 */

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { OverlayProvider } from "@/lib/overlay/OverlayProvider";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // DEC-001 §7 「자동 재시도를 두지 않는다 — 실패를 가린다」.
        retry: false,
        // 데스크톱 앱이라 포커스 전환이 잦다. 자동 저장 중 되감기는 사고다.
        refetchOnWindowFocus: false,
        // 기본은 「열 때마다 새로」. 목록 쿼리만 각자 30초를 얹는다(§3-2).
        staleTime: 0,
        // 에러는 화면이 표면화한다 — ErrorBoundary 로 통째로 날리지 않는다(§3-5).
        throwOnError: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  // 렌더마다 클라이언트를 새로 만들면 캐시가 날아간다.
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <OverlayProvider>{children}</OverlayProvider>
    </QueryClientProvider>
  );
}
