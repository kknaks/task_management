"use client";

/**
 * **U-1 연결 확인 화면**(SPEC-000 §2). 이 spec 이 만드는 유일한 화면이고,
 * **WORK-002 가 로그인 화면으로 대체한다.**
 *
 * 상태 셋 — 확인 중 / 연결됨 / 실패. **어떤 경우에도 화면이 비지 않는다.**
 * 실패를 빈 화면이나 「정상」으로 대체하지 않는다(DEC-003 §7 승계).
 */

import { Button } from "@/components/ui/button";
import { isApiError } from "@/lib/api/errors";
import { env } from "@/lib/env";
import { useHealthQuery } from "@/features/health/hooks/useHealthQuery";

/** 제품명 — 문서·레포가 쓰는 이름 그대로. 브랜드 표기를 새로 만들지 않는다. */
const PRODUCT_NAME = "task-management";

/**
 * 실패 사유 한 줄 — **SPEC-000 §4 Case Matrix 그대로**다.
 * `code` 로 갈리고 `detail` 문구로 갈리지 않는다(FE §3-5).
 */
function failureReason(error: unknown): string {
  if (!isApiError(error)) {
    return "알 수 없는 오류입니다";
  }
  // 서버가 응답하지 못한 실패(네트워크·CORS)는 client.ts 가 만든 문구를 그대로 쓴다.
  if (error.status === 0) {
    return error.detail;
  }
  // 우리가 설계한 실패는 백엔드 `detail` 이 정본이다.
  if (error.code === "db_unavailable") {
    return error.detail;
  }
  // 그 밖 4xx·5xx — 상태코드만 드러낸다.
  return `HTTP ${error.status}`;
}

export function ConnectionCheckScreen() {
  const { data, error, isFetching, refetch } = useHealthQuery();

  return (
    <main className="flex min-h-screen w-full items-center justify-center px-gutter py-16">
      <section className="flex w-full max-w-[560px] flex-col items-start gap-3 rounded-card bg-surface p-10 shadow-card">
        <h1 className="text-page-title text-foreground">{PRODUCT_NAME}</h1>

        {isFetching ? (
          // 확인 중 — 버튼 없음
          <p className="text-body text-muted-foreground">서버 연결 확인 중…</p>
        ) : error ? (
          <>
            <p className="text-panel text-destructive">서버에 연결하지 못했습니다</p>
            <dl className="flex flex-col gap-1">
              <div className="flex gap-2">
                <dt className="text-meta text-fg-caption">대상 주소</dt>
                <dd className="text-meta text-fg-meta">{env.apiBase}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-meta text-fg-caption">사유</dt>
                <dd className="text-meta text-fg-meta">{failureReason(error)}</dd>
              </div>
            </dl>
            {/* 「다시 확인」은 요청을 한 번만 보낸다 — 자동 재시도 없음(FE §3-2) */}
            <Button className="mt-3" onClick={() => void refetch()}>
              다시 확인
            </Button>
          </>
        ) : data ? (
          <>
            <p className="text-panel text-foreground">서버에 연결되었습니다</p>
            <dl className="flex flex-col gap-1">
              <div className="flex gap-2">
                <dt className="text-meta text-fg-caption">대상 주소</dt>
                <dd className="text-meta text-fg-meta">{env.apiBase}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-meta text-fg-caption">버전</dt>
                <dd className="text-meta text-fg-meta">{data.version}</dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="text-body text-muted-foreground">서버 연결 확인 중…</p>
        )}
      </section>
    </main>
  );
}
