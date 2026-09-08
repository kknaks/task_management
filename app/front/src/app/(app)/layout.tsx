"use client";

/**
 * **세션 가드 + 앱 셸**(SPEC-001 U-3 · frontend/README.md §4-3).
 *
 * 미들웨어를 쓸 수 없으므로(FE-C1) 가드는 **레이아웃 컴포넌트**다. 서버가 최종 판정이고
 * 이 가드는 화면 경로만 막는다 — 우회해 들어가도 데이터는 오지 않는다(SPEC-001 §5 인가).
 *
 * 순서가 계약이다.
 * 1. 보관된 refresh 가 있는지 본다(키체인 1회 읽기). **없으면 요청을 하나도 보내지 않고**
 *    로그인 화면으로 간다 — 「유지」 미체크 재시작이 이 경로이고 **만료 토스트가 없다**(U-7)
 * 2. 있으면 `GET /api/auth/session` 으로 확인한다. 그 과정에서 access 가 없으면
 *    `client.ts` 가 갱신 1회를 먼저 태운다(§4-2)
 * 3. **확인 중에는 로그인 화면을 깜빡 보여주지 않는다** — 셸을 그리고 본문만 로딩이다(U-3)
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { AppShell } from "@/components/shared/AppShell";
import { queryKeys } from "@/lib/api/queryKeys";
import { isApiError } from "@/lib/api/errors";
import { fetchSession, restoreSession } from "@/lib/auth/session";
import { setSessionEndHandler } from "@/lib/auth/sessionEvents";

const LOGIN_ROUTE = "/login/";

/** 세션 만료 토스트 — 문구 하나뿐이다. **잠김·재시도 횟수 문구를 두지 않는다**(U-7). */
const EXPIRED_MESSAGE = "로그인이 만료되었습니다. 다시 로그인해 주세요.";

type Bootstrap = "checking" | "has-token" | "no-token";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [bootstrap, setBootstrap] = useState<Bootstrap>("checking");

  // 갱신이 끝내 실패하면 `client.ts` 가 여기로 통지한다. 라우팅은 훅만 할 수 있다(§4-3).
  useEffect(() => {
    setSessionEndHandler((reason) => {
      // 남은 쿼리가 다시 나가지 않게 캐시를 비운다 — 로그아웃한 refresh 를 다시 보내면
      // 재사용 감지가 걸려 그 계정 세션이 전부 끊긴다(A-7).
      queryClient.clear();
      if (reason === "expired") {
        toast(EXPIRED_MESSAGE, { id: "session-expired" });
      }
      router.replace(LOGIN_ROUTE);
    });
    return () => setSessionEndHandler(null);
  }, [queryClient, router]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const restored = await restoreSession();
        if (cancelled) {
          return;
        }
        setBootstrap(restored ? "has-token" : "no-token");
        if (!restored) {
          router.replace(LOGIN_ROUTE);
        }
      } catch (error) {
        // 키체인 읽기 실패를 「로그인 안 됨」으로 조용히 뭉개지 않는다(DEC-003 §7).
        if (cancelled) {
          return;
        }
        setBootstrap("no-token");
        toast.error(
          error instanceof Error ? error.message : "저장된 로그인 정보를 읽지 못했습니다",
        );
        router.replace(LOGIN_ROUTE);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const sessionQuery = useQuery({
    queryKey: queryKeys.session(),
    queryFn: fetchSession,
    enabled: bootstrap === "has-token",
    staleTime: 0,
  });

  // 토큰이 없다 — 이미 로그인으로 보냈다. **로그인 화면을 여기서 그리지 않는다.**
  if (bootstrap === "no-token") {
    return null;
  }

  const account = sessionQuery.data?.account;

  return (
    <AppShell account={account}>
      {sessionQuery.isError ? (
        // 401 은 client 가 이미 로그인으로 보냈다. 그 밖의 실패는 가리지 않고 드러낸다(§3-5).
        <p className="text-body text-destructive">
          {isApiError(sessionQuery.error)
            ? sessionQuery.error.detail
            : "세션을 확인하지 못했습니다"}
        </p>
      ) : account ? (
        children
      ) : (
        // *세션 확인 중* — 본문 자리에 로딩 표시(U-3)
        <p className="text-body text-muted-foreground">세션 확인 중…</p>
      )}
    </AppShell>
  );
}
