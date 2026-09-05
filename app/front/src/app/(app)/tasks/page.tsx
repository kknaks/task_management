"use client";

/**
 * **로그인 후 기본 진입**(FE §1 · SPEC-001 U-1 기대 결과).
 *
 * 이 배치에서는 **셸만** 있고 본문은 비어 있다 — 리스트·칸반은 내 업무 그룹이 채운다
 * (SPEC-001 U-3 기대 결과 · WORK-002 Scope 「`/tasks` 본문 제외」).
 */

export default function Page() {
  return <h1 className="text-page-title text-foreground">내 업무</h1>;
}
